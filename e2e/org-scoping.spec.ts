import { test, expect, orgs, users, leadRow, queueCard } from './support/fixtures';

/**
 * Multi-tenancy: a lead belongs to exactly one org, and the Firestore rules only surface
 * leads whose organizationId matches the signed-in user's. A lead seeded into ORG_A must be
 * invisible to ORG_B's user and visible to ORG_A's user.
 */
test.describe('Org scoping', () => {
  test("a lead in another org is not visible to this org's user", async ({
    seed,
    login,
    page,
  }) => {
    await seed.seedLead(orgs.A, { source: 'new', name: 'Alpha Secret', status: 'New' });

    await login(users.B.email, users.B.password);

    // ORG_B's user sees an empty book — not ORG_A's lead, in table or queue.
    await expect(leadRow(page, 'Alpha Secret')).toHaveCount(0);
    await expect(queueCard(page, 'Alpha Secret')).toHaveCount(0);
    await expect(page.getByTestId('table-summary')).toContainText('No leads');
  });

  test("the owning org's user does see the lead", async ({ seed, login, page }) => {
    await seed.seedLead(orgs.A, { source: 'new', name: 'Alpha Secret', status: 'New' });

    await login(users.A.email, users.A.password);

    await expect(leadRow(page, 'Alpha Secret')).toBeVisible();
    await expect(queueCard(page, 'Alpha Secret')).toBeVisible();
  });
});
