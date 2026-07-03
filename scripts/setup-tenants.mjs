// Provisions the two tenants for the current build via the Admin SDK:
//
//   • Demo Studio  <- demo@user.com               — seeded with sample leads (customer demo)
//   • O-Studio Remuera <- hello.remuera@ostudio.co.nz — empty, real brand logo (slug=remuera)
//
//   node setup-tenants.mjs --dry-run   # prints what it would do, writes nothing
//   node setup-tenants.mjs             # provisions for real
//
// Safe to re-run: it looks each org up by name and each user by uid, and only creates
// what is missing. Seeding is skipped if the org already has leads. It does NOT delete
// anything. Auth users must already exist (created in the Firebase console).
//
// The demo leads reuse the shared generator in seed-data.mjs but drop the visible
// "[SEED]" note prefix so the data reads cleanly in front of a prospect. They still carry
// `seeded: true` + seedTag, so cleanup-seed.mjs can remove them later if needed.

import { getAuth } from 'firebase-admin/auth';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

import { initAdmin } from './_admin.mjs';
import { buildSeedLeads } from './seed-data.mjs';

const dryRun = process.argv.includes('--dry-run');

const TENANTS = [
  {
    email: 'demo@user.com',
    org: { name: 'Demo Studio' }, // no slug -> generic mark, no brand logo
    seed: true,
  },
  {
    email: 'hello.remuera@ostudio.co.nz',
    org: { name: 'O-Studio Remuera', slug: 'remuera' }, // logo: assets/remuera/logo.jpg
    seed: false,
  },
];

const db = initAdmin();
const auth = getAuth();

/** Find an org by exact name, or create it. Returns { id, name, created }. */
async function ensureOrg({ name, slug }) {
  const existing = await db.collection('organizations').where('name', '==', name).limit(1).get();
  if (!existing.empty) {
    const d = existing.docs[0];
    return { id: d.id, name, created: false };
  }
  if (dryRun) return { id: '(new)', name, created: true };
  const data = { name, createdAt: FieldValue.serverTimestamp() };
  if (slug) data.slug = slug;
  const ref = await db.collection('organizations').add(data);
  return { id: ref.id, name, created: true };
}

/** Link an Auth user to an org via users/{uid}. Returns whether it created the join. */
async function ensureUserLink(user, organizationId) {
  const ref = db.collection('users').doc(user.uid);
  const snap = await ref.get();
  if (snap.exists) {
    const current = snap.get('organizationId');
    if (current === organizationId) return false;
    if (!dryRun) await ref.update({ organizationId });
    return 'repointed';
  }
  if (!dryRun) {
    await ref.set({
      uid: user.uid,
      organizationId,
      email: user.email ?? null,
      displayName: user.displayName ?? null,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  return true;
}

/** Seed the demo org's leads (skips if it already has any). */
async function seedLeads(organizationId) {
  const already = await db.collection('leads').where('organizationId', '==', organizationId).limit(1).get();
  if (!already.empty) {
    console.log('    leads: org already has data — skipping seed');
    return 0;
  }
  const leads = buildSeedLeads(Timestamp).map((lead) => ({
    ...lead,
    // Drop the visible "[SEED] " prefix so notes read cleanly in a demo.
    notes: typeof lead.notes === 'string' ? lead.notes.replace(/^\[SEED\]\s*/, '') : lead.notes,
    organizationId,
  }));
  if (dryRun) {
    console.log(`    leads: would seed ${leads.length}`);
    return leads.length;
  }
  const CHUNK = 400;
  const col = db.collection('leads');
  for (let i = 0; i < leads.length; i += CHUNK) {
    const batch = db.batch();
    for (const lead of leads.slice(i, i + CHUNK)) batch.set(col.doc(), lead);
    await batch.commit();
  }
  console.log(`    leads: seeded ${leads.length}`);
  return leads.length;
}

console.log(`\n${dryRun ? '[dry-run] ' : ''}Provisioning ${TENANTS.length} tenant(s)…\n`);

for (const tenant of TENANTS) {
  let user;
  try {
    user = await auth.getUserByEmail(tenant.email);
  } catch (e) {
    console.error(`  ${tenant.email}: Auth user NOT FOUND (${e.code}). Create it in the console first. Skipping.`);
    continue;
  }

  const org = await ensureOrg(tenant.org);
  const link = await ensureUserLink(user, org.id);

  console.log(`  ${tenant.email}  (uid=${user.uid})`);
  console.log(`    org:  "${org.name}" ${org.id}  ${org.created ? '[created]' : '[existing]'}`);
  console.log(
    `    link: ${link === true ? '[created]' : link === 'repointed' ? '[re-pointed to this org]' : '[already linked]'}`,
  );
  if (tenant.seed) await seedLeads(org.id);
  console.log('');
}

console.log(dryRun ? '[dry-run] nothing written.\n' : 'Done.\n');
process.exit(0);
