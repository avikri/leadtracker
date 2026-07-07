import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E config for the front-desk lead tracker.
 *
 * The suite runs the Angular app against the local Firebase Emulator Suite (Auth +
 * Firestore) so real security rules and org scoping are exercised without ever touching the
 * live `leadtracker-d1420` project. Two web servers are started automatically:
 *
 *   1. `npm run emulators` — Auth (9099) + Firestore (8080) emulators. Readiness is polled
 *      on the Firestore emulator root, which returns 200 once it is accepting traffic.
 *   2. `npm run start:test` — `ng serve --configuration test`, which swaps in
 *      environment.test.ts (useEmulators=true, requireAuth=true, seedOnStartup=false).
 *
 * Tests reset + seed the emulators between runs (see e2e/support/emulator.ts), so they run
 * serially — a shared emulator can't be safely reset underneath parallel workers.
 */

const CI = !!process.env['CI'];
const BASE_URL = 'http://127.0.0.1:4200';

export default defineConfig({
  testDir: './e2e',
  // Serial: every test resets the shared emulator, which would clobber parallel workers.
  fullyParallel: false,
  workers: 1,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: [['html', { open: 'never' }], ['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: [
    {
      command: 'npm run emulators',
      // Firestore emulator root replies 200 ("Ok") once it is up.
      url: 'http://127.0.0.1:8080',
      reuseExistingServer: !CI,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'npm run start:test',
      url: BASE_URL,
      reuseExistingServer: !CI,
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
