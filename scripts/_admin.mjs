// Shared Admin SDK bootstrap for the maintenance scripts.
//
// Credentials are resolved in this order:
//   1. GOOGLE_APPLICATION_CREDENTIALS pointing at a service-account JSON, OR
//   2. a `serviceAccountKey.json` file sitting next to this script.
//
// Get a key from: Firebase console -> Project settings -> Service accounts ->
// "Generate new private key". Keep it OUT of git (see scripts/.gitignore).
//
// The Admin SDK bypasses Firestore security rules, so it can both write seed data
// AND delete it later (the client SDK cannot — `allow delete: if false`).

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const here = dirname(fileURLToPath(import.meta.url));

export const EXPECTED_PROJECT_ID = 'leadtracker-d1420';
export const LOCATION_ID = 'auckland-studio';

/** Marker written on every seeded doc so cleanup can find them precisely. */
export const SEED_TAG = 'fake-seed-2026-07-01';

function resolveCredential() {
  const keyPath = join(here, 'serviceAccountKey.json');
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return { credential: applicationDefault(), source: 'GOOGLE_APPLICATION_CREDENTIALS' };
  }
  if (existsSync(keyPath)) {
    const sa = JSON.parse(readFileSync(keyPath, 'utf8'));
    if (sa.project_id !== EXPECTED_PROJECT_ID) {
      throw new Error(
        `serviceAccountKey.json is for project "${sa.project_id}", expected "${EXPECTED_PROJECT_ID}". Refusing to run against the wrong project.`,
      );
    }
    return { credential: cert(sa), source: `serviceAccountKey.json (${sa.client_email})` };
  }
  throw new Error(
    'No credentials found. Set GOOGLE_APPLICATION_CREDENTIALS, or drop a serviceAccountKey.json into the scripts/ folder. See scripts/README.md.',
  );
}

export function initAdmin() {
  const { credential, source } = resolveCredential();
  initializeApp({ credential, projectId: EXPECTED_PROJECT_ID });
  console.log(`[admin] project=${EXPECTED_PROJECT_ID}  creds=${source}`);
  return getFirestore();
}
