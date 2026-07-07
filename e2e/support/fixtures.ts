import { test as base, expect, type Page } from '@playwright/test';
import * as emu from './emulator';

/**
 * Shared test harness.
 *
 * The `seed` fixture resets and re-provisions the emulator before EVERY test, so each test
 * starts from the two known tenants (see emulator.ts) and nothing else. Because it wipes the
 * shared emulator, tests must run serially (workers: 1 in playwright.config.ts).
 *
 * The `login` fixture drives the real sign-in form and waits for the dashboard, so auth is
 * exercised as a side effect of every test that needs a signed-in user.
 */

type Fixtures = {
  /** Emulator helpers, with the reset + baseline seed already applied for this test. */
  seed: typeof emu;
  /** Sign in through the UI and land on the dashboard. */
  login: (email: string, password: string) => Promise<void>;
  /** Sign in as the primary tenant's front-desk user (USER_A / ORG_A). */
  loginAsPrimary: () => Promise<void>;
};

export const test = base.extend<Fixtures>({
  seed: async ({}, use) => {
    await emu.resetEmulators();
    await emu.seedBaseline();
    await use(emu);
  },

  login: async ({ page }, use) => {
    await use((email: string, password: string) => signIn(page, email, password));
  },

  loginAsPrimary: async ({ page }, use) => {
    await use(() => signIn(page, emu.USER_A.email, emu.USER_A.password));
  },
});

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
  // Landed on the dashboard (route '') — the Add lead button only exists there.
  await expect(page.getByTestId('add-lead')).toBeVisible();
}

export { expect };
export const orgs = { A: emu.ORG_A_ID, B: emu.ORG_B_ID };
export const users = { A: emu.USER_A, B: emu.USER_B };

/** The "All leads" table row for a lead, by name (rows carry data-lead-name). */
export function leadRow(page: Page, name: string) {
  return page.locator(`tr[data-testid="lead-row"][data-lead-name="${name}"]`);
}

/** The follow-up queue card for a lead, by name. */
export function queueCard(page: Page, name: string) {
  return page.locator(`[data-testid="queue-card"][data-lead-name="${name}"]`);
}
