/**
 * E2E test environment (Playwright).
 *
 * Swapped in for the `test` build/serve configuration via the `fileReplacements` in
 * angular.json, so `npm run start:test` runs the app against the local Firebase Emulator
 * Suite instead of the real project.
 *
 * The projectId is deliberately a `demo-` id: the Firebase emulators treat any project
 * whose id starts with `demo-` as a throwaway sandbox that never needs real credentials,
 * so tests can never touch the live `leadtracker-d1420` data. Keep it in sync with the
 * PROJECT_ID in e2e/support/emulator.ts.
 */
export const environment = {
  production: false,

  firebase: {
    apiKey: 'fake-api-key',
    authDomain: 'localhost',
    projectId: 'demo-leadtracker-test',
    storageBucket: 'demo-leadtracker-test.appspot.com',
    messagingSenderId: 'fake-sender-id',
    appId: 'demo-app-id',
  },

  /** Auth is enforced so the sign-in flow is exercised end-to-end. */
  requireAuth: true,

  /** Tests seed their own deterministic data — never auto-seed on startup. */
  seedOnStartup: false,

  /** Connect Auth + Firestore to the local emulators (see app.config.ts). */
  useEmulators: true,
};
