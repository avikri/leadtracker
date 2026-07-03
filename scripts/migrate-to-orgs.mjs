// ONE-SHOT migration to the multi-organisation data model. Run ONCE against the
// current dataset, BEFORE deploying the org-scoped firestore.rules — it is not built
// to be re-run (a second run would create a second org and trip the multi-org guard
// in resolveOrganization()).
//
//   node migrate-to-orgs.mjs --dry-run # prints what would change, writes nothing
//   node migrate-to-orgs.mjs           # migrates for real
//
// What it does:
//   1. Creates the first `organizations` doc ("O-Studio Remuera").
//   2. Rewrites every `leads` doc: locationId → organizationId = the new org's id
//      (whatever placeholder value locationId held is discarded).
//   3. Creates a `users/{uid}` doc for every existing Firebase Auth user, pointing
//      at that same org — this is the join the new rules gate everything on.

import { getAuth } from 'firebase-admin/auth';
import { FieldValue } from 'firebase-admin/firestore';

import { initAdmin } from './_admin.mjs';

const ORG_NAME = 'O-Studio Remuera';
// URL-safe key for the org's asset folder: the brand logo is served from
// `assets/{slug}/logo.jpg` by the web app (see OrgService.logoUrl).
const ORG_SLUG = 'remuera';
const dryRun = process.argv.includes('--dry-run');

const db = initAdmin();

// Refuse to run twice: an existing org means the migration already happened.
const existingOrgs = await db.collection('organizations').limit(1).get();
if (!existingOrgs.empty) {
  console.error(
    `\nAborting: an organizations doc already exists (${existingOrgs.docs[0].id}). ` +
      'This migration is one-shot and has already run.',
  );
  process.exit(1);
}

const leadsSnap = await db.collection('leads').get();
const authUsers = [];
let pageToken;
do {
  const page = await getAuth().listUsers(1000, pageToken);
  authUsers.push(...page.users);
  pageToken = page.pageToken;
} while (pageToken);

console.log(`\nWill create org "${ORG_NAME}", re-point ${leadsSnap.size} lead(s), link ${authUsers.length} auth user(s).`);
if (dryRun) {
  authUsers.forEach((u) => console.log(`  user: ${u.uid}  ${u.email ?? '(no email)'}`));
  console.log('\n[dry-run] nothing written.');
  process.exit(0);
}

// 1. The organisation.
const orgRef = await db.collection('organizations').add({
  name: ORG_NAME,
  slug: ORG_SLUG,
  createdAt: FieldValue.serverTimestamp(),
});

// 2. Every lead: organizationId in, locationId out. Chunked under the 500-write batch cap.
const CHUNK = 400;
let leadsUpdated = 0;
for (let i = 0; i < leadsSnap.docs.length; i += CHUNK) {
  const batch = db.batch();
  for (const d of leadsSnap.docs.slice(i, i + CHUNK)) {
    batch.update(d.ref, {
      organizationId: orgRef.id,
      locationId: FieldValue.delete(),
    });
  }
  await batch.commit();
  leadsUpdated += Math.min(CHUNK, leadsSnap.docs.length - i);
  console.log(`  leads updated ${leadsUpdated}/${leadsSnap.size}`);
}

// 3. A users/{uid} join doc per Auth user, all pointing at the one org.
let usersLinked = 0;
for (let i = 0; i < authUsers.length; i += CHUNK) {
  const batch = db.batch();
  for (const u of authUsers.slice(i, i + CHUNK)) {
    batch.set(db.collection('users').doc(u.uid), {
      uid: u.uid,
      organizationId: orgRef.id,
      email: u.email ?? null,
      displayName: u.displayName ?? null,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
  usersLinked += Math.min(CHUNK, authUsers.length - i);
}

console.log(`\nDone.`);
console.log(`  organization created: ${orgRef.id}  ("${ORG_NAME}")`);
console.log(`  leads updated:        ${leadsUpdated}`);
console.log(`  users linked:         ${usersLinked}`);
console.log('\nNow deploy the new rules + indexes: firebase deploy --only firestore');
process.exit(0);
