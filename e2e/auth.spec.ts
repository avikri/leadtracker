import { test, expect, users } from './support/fixtures';

/**
 * Auth gating (environment.test.ts sets requireAuth=true, so the guard is enforced).
 */
test.describe('Authentication', () => {
  test('redirects an anonymous visitor to /login', async ({ seed, page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByTestId('login-form')).toBeVisible();
  });

  test('shows a friendly error on wrong credentials', async ({ seed, page }) => {
    await page.goto('/login');
    await page.getByTestId('login-email').fill(users.A.email);
    await page.getByTestId('login-password').fill('wrong-password');
    await page.getByTestId('login-submit').click();

    await expect(page.getByTestId('login-error')).toHaveText('Incorrect email or password.');
    // Still on the login screen.
    await expect(page.getByTestId('login-form')).toBeVisible();
  });

  test('signs in and lands on the dashboard', async ({ seed, loginAsPrimary, page }) => {
    await loginAsPrimary();
    await expect(page.getByTestId('add-lead')).toBeVisible();
    await expect(page.getByTestId('current-user')).toContainText(users.A.email);
  });

  test('bounces to login then returns to the dashboard after signing in', async ({
    seed,
    login,
    page,
  }) => {
    // Deep-link while signed out → guard redirects to /login with ?returnUrl.
    await page.goto('/');
    await expect(page).toHaveURL(/\/login\?returnUrl/);

    await login(users.A.email, users.A.password);
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByTestId('leads-table')).toBeVisible();
  });

  test('sign out returns to the login screen', async ({ seed, loginAsPrimary, page }) => {
    await loginAsPrimary();
    await page.getByTestId('sign-out').click();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByTestId('login-form')).toBeVisible();
  });
});
