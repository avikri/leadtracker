// Deletes every seeded fake lead from the LIVE DB via the Admin SDK.
//
//   node cleanup-seed.mjs           # prints how many match, deletes nothing
//   node cleanup-seed.mjs --confirm # actually deletes them
//
// Matches on `seedTag == SEED_TAG` (falls back to `seeded == true`). The Admin SDK
// bypasses the `allow delete: if false` rule that blocks the client SDK.

import { initAdmin, SEED_TAG } from './_admin.mjs';

const confirm = process.argv.includes('--confirm');
const db = initAdmin();

let snap = await db.collection('leads').where('seedTag', '==', SEED_TAG).get();
if (snap.empty) {
  // Fallback for any docs tagged before seedTag existed.
  snap = await db.collection('leads').where('seeded', '==', true).get();
}

console.log(`\nMatched ${snap.size} seeded lead(s).`);
if (snap.empty) process.exit(0);

if (!confirm) {
  console.log('Dry run — pass --confirm to delete them. Sample:');
  snap.docs.slice(0, 3).forEach((d) => console.log(`  ${d.id}  ${d.get('name')}  (${d.get('status')})`));
  process.exit(0);
}

let deleted = 0;
const docs = snap.docs;
const CHUNK = 400;
for (let i = 0; i < docs.length; i += CHUNK) {
  const batch = db.batch();
  for (const d of docs.slice(i, i + CHUNK)) batch.delete(d.ref);
  await batch.commit();
  deleted += Math.min(CHUNK, docs.length - i);
  console.log(`  deleted ${deleted}/${docs.length}`);
}

console.log(`\nDone. Deleted ${deleted} seeded lead(s).`);
process.exit(0);
