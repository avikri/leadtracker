// Backfill (or change) an organisation's `slug` — the key that maps it to its brand
// logo folder. The web app serves the logo from `assets/{slug}/logo.jpg`, so the slug
// MUST match the folder name under the repo's `assets/` directory (e.g. `remuera`).
//
//   node set-org-slug.mjs remuera            # sets the single org's slug to "remuera"
//   node set-org-slug.mjs remuera --dry-run  # prints what would change, writes nothing
//   node set-org-slug.mjs remuera <orgId>    # target a specific org when several exist
//
// migrate-to-orgs.mjs already stamps a slug on a fresh migration; this exists to set it
// on an org that was created before the slug field existed.

import { initAdmin, resolveOrganization } from './_admin.mjs';

const args = process.argv.slice(2).filter((a) => a !== '--dry-run');
const dryRun = process.argv.includes('--dry-run');
const [slug, orgIdArg] = args;

if (!slug) {
  console.error('Usage: node set-org-slug.mjs <slug> [orgId] [--dry-run]');
  process.exit(1);
}
if (!/^[a-z0-9-]+$/.test(slug)) {
  console.error(`Refusing: slug "${slug}" must be lowercase letters, digits and hyphens only.`);
  process.exit(1);
}

const db = initAdmin();

// Resolve the target org: an explicit id wins; otherwise fall back to the single-org lookup.
let orgId;
let orgName;
if (orgIdArg) {
  const snap = await db.collection('organizations').doc(orgIdArg).get();
  if (!snap.exists) {
    console.error(`No organizations doc with id "${orgIdArg}".`);
    process.exit(1);
  }
  orgId = snap.id;
  orgName = snap.get('name');
} else {
  const org = await resolveOrganization(db); // throws if 0 or >1 orgs
  orgId = org.id;
  orgName = org.name;
}

console.log(`\nOrg: ${orgName} (${orgId})`);
console.log(`Set slug -> "${slug}"  (logo will resolve to assets/${slug}/logo.jpg)`);

if (dryRun) {
  console.log('\n[dry-run] nothing written.');
  process.exit(0);
}

await db.collection('organizations').doc(orgId).update({ slug });
console.log('\nDone. Slug updated.');
process.exit(0);
