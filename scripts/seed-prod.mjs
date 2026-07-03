// Seeds the LIVE Firestore DB with 50 tagged fake leads via the Admin SDK.
//
//   node seed-prod.mjs           # writes the 50 leads
//   node seed-prod.mjs --dry-run # prints a summary, writes nothing
//
// Every doc is tagged `seeded: true` + seedTag so cleanup-seed.mjs can remove them.
// This writes into the single production DB (leadtracker-d1420) — deletes are blocked
// for the client SDK, so cleanup MUST go through cleanup-seed.mjs (Admin bypasses rules).

import { Timestamp } from 'firebase-admin/firestore';

import { initAdmin, resolveOrganization, SEED_TAG } from './_admin.mjs';
import { buildSeedLeads } from './seed-data.mjs';

const dryRun = process.argv.includes('--dry-run');
const leads = buildSeedLeads(Timestamp);

// Summary so you can eyeball the mix before it lands.
const by = (key) => leads.reduce((m, l) => ((m[l[key]] = (m[l[key]] || 0) + 1), m), {});
console.log(`\n${leads.length} leads to seed  (tag=${SEED_TAG})`);
console.log('  by source:', by('source'));
console.log('  by status:', by('status'));

if (dryRun) {
  console.log('\n[dry-run] nothing written (organizationId stamped at write time). Sample doc:');
  console.dir(leads[0], { depth: 4 });
  process.exit(0);
}

const db = initAdmin();
const org = await resolveOrganization(db);
console.log(`  organization: ${org.name} (${org.id})`);
const col = db.collection('leads');

// Firestore batches cap at 500 writes; 50 fits in one, but chunk anyway for safety.
const CHUNK = 400;
let written = 0;
for (let i = 0; i < leads.length; i += CHUNK) {
  const batch = db.batch();
  for (const lead of leads.slice(i, i + CHUNK)) {
    batch.set(col.doc(), { ...lead, organizationId: org.id });
  }
  await batch.commit();
  written += Math.min(CHUNK, leads.length - i);
  console.log(`  committed ${written}/${leads.length}`);
}

console.log(`\nDone. Seeded ${written} leads. Remove them later with: node cleanup-seed.mjs`);
process.exit(0);
