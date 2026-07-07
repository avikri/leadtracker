import { test, expect, orgs, leadRow } from './support/fixtures';

/**
 * The lead lifecycle driven from the "All leads" table:
 *   New → Contacted → Responded → (Converted | Lost)
 * Convert captures an outcome via the app dialog; Lost is a confirmed manual action.
 */
test.describe('Status lifecycle', () => {
  test('advances New → Contacted → Responded → Converted with an outcome', async ({
    seed,
    loginAsPrimary,
    page,
  }) => {
    await seed.seedLead(orgs.A, { source: 'new', name: 'Lifecycle Convert', status: 'New' });
    await loginAsPrimary();

    const row = leadRow(page, 'Lifecycle Convert');
    await expect(row).toHaveAttribute('data-status', 'New');

    // New → Contacted
    await row.getByTestId('row-advance').click();
    await expect(row).toHaveAttribute('data-status', 'Contacted');

    // Contacted → Responded
    await row.getByTestId('row-advance').click();
    await expect(row).toHaveAttribute('data-status', 'Responded');

    // Responded → Converted (dialog captures the outcome)
    await row.getByTestId('row-convert').click();
    await expect(page.getByTestId('dialog')).toBeVisible();
    await page.getByTestId('dialog-input').fill('Bought a membership');
    await page.getByTestId('dialog-confirm').click();

    await expect(row).toHaveAttribute('data-status', 'Converted');
  });

  test('marks a Responded lead as Lost after confirming', async ({
    seed,
    loginAsPrimary,
    page,
  }) => {
    await seed.seedLead(orgs.A, { source: 'new', name: 'Lifecycle Lost', status: 'Responded' });
    await loginAsPrimary();

    const row = leadRow(page, 'Lifecycle Lost');
    await expect(row).toHaveAttribute('data-status', 'Responded');

    await row.getByTestId('row-lost').click();
    await expect(page.getByTestId('dialog')).toBeVisible();
    await page.getByTestId('dialog-confirm').click();

    await expect(row).toHaveAttribute('data-status', 'Lost');
  });

  test('cancelling the Lost confirmation leaves the lead Responded', async ({
    seed,
    loginAsPrimary,
    page,
  }) => {
    await seed.seedLead(orgs.A, { source: 'new', name: 'Lost Cancelled', status: 'Responded' });
    await loginAsPrimary();

    const row = leadRow(page, 'Lost Cancelled');
    await row.getByTestId('row-lost').click();
    await page.getByTestId('dialog-cancel').click();

    await expect(page.getByTestId('dialog')).toBeHidden();
    await expect(row).toHaveAttribute('data-status', 'Responded');
  });

  test('marks a trial check-in done from the expanded row', async ({
    seed,
    loginAsPrimary,
    page,
  }) => {
    await seed.seedLead(orgs.A, { source: 'trial', name: 'Trial Rows', status: 'New' });
    await loginAsPrimary();

    const row = leadRow(page, 'Trial Rows');
    await row.getByTestId('row-expand').click();
    // The first outstanding touchpoint offers a "Mark done" button.
    await page.getByTestId('touchpoint-mark-firstServiceContact').click();
    // Row reloads; the button for that touchpoint is gone (now recorded).
    await expect(page.getByTestId('touchpoint-mark-firstServiceContact')).toHaveCount(0);
  });
});
