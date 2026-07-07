import { test, expect, orgs, leadRow } from './support/fixtures';

/**
 * The "All leads" table filters (source, status, name search) and cursor pagination. All
 * filters AND together and reset to page 1; the row set is fetched Firestore-side.
 */
test.describe('Table filters & pagination', () => {
  test('filters by source, status and name search', async ({ seed, loginAsPrimary, page }) => {
    await seed.seedLead(orgs.A, { source: 'new', name: 'Alice New', status: 'New' });
    await seed.seedLead(orgs.A, { source: 'new', name: 'Bob New', status: 'Contacted' });
    await seed.seedLead(orgs.A, { source: 'quiz', name: 'Carol Quiz', status: 'New' });
    await seed.seedLead(orgs.A, { source: 'quiz', name: 'Dan Quiz', status: 'New' });
    await loginAsPrimary();

    const rows = page.getByTestId('lead-row');
    await expect(rows).toHaveCount(4);

    // Source = quiz → 2 rows.
    await page.getByTestId('table-filter-source').selectOption('quiz');
    await expect(rows).toHaveCount(2);
    await expect(leadRow(page, 'Carol Quiz')).toBeVisible();
    await expect(leadRow(page, 'Alice New')).toHaveCount(0);

    // Add a name search on top → 1 row (filters AND together).
    await page.getByTestId('table-search').fill('Carol');
    await expect(rows).toHaveCount(1);
    await expect(leadRow(page, 'Carol Quiz')).toBeVisible();

    // Clear all filters → back to 4.
    await page.getByTestId('table-clear-filters').click();
    await expect(rows).toHaveCount(4);

    // Status = Contacted → only Bob.
    await page.getByTestId('table-filter-status').selectOption('Contacted');
    await expect(rows).toHaveCount(1);
    await expect(leadRow(page, 'Bob New')).toBeVisible();
  });

  test('date range matches the backdated leadDate, not the entry timestamp', async ({
    seed,
    loginAsPrimary,
    page,
  }) => {
    const day = 86_400_000;
    const toInput = (d: Date) =>
      `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
    const tenDaysAgo = new Date(Date.now() - 10 * day);

    // Entered today but backdated ten days — the business date is what staff filter by.
    await seed.seedLead(orgs.A, {
      source: 'new',
      name: 'Backdated Betty',
      status: 'New',
      leadDate: tenDaysAgo,
    });
    await seed.seedLead(orgs.A, { source: 'new', name: 'Today Tom', status: 'New' });
    await loginAsPrimary();

    const rows = page.getByTestId('lead-row');
    await expect(rows).toHaveCount(2);

    // Filter to a window around the backdated date → only Betty matches.
    await page.getByTestId('table-date-from').fill(toInput(new Date(Date.now() - 11 * day)));
    await page.getByTestId('table-date-to').fill(toInput(new Date(Date.now() - 9 * day)));
    await expect(rows).toHaveCount(1);
    await expect(leadRow(page, 'Backdated Betty')).toBeVisible();
    await expect(leadRow(page, 'Today Tom')).toHaveCount(0);
  });

  test('pages forward and back with the cursor pager', async ({ seed, loginAsPrimary, page }) => {
    // 21 leads → page 1 shows 20 (pageSize), page 2 shows the last 1.
    for (let i = 0; i < 21; i++) {
      await seed.seedLead(orgs.A, {
        source: 'new',
        name: `Page Lead ${String(i).padStart(2, '0')}`,
        status: 'New',
        // Stagger createdAt so ordering is deterministic (newest first).
        createdAt: new Date(Date.now() - i * 60_000),
      });
    }
    await loginAsPrimary();

    const rows = page.getByTestId('lead-row');
    await expect(rows).toHaveCount(20);
    await expect(page.getByTestId('table-page')).toContainText('Page 1');
    await expect(page.getByTestId('table-prev')).toBeDisabled();
    await expect(page.getByTestId('table-next')).toBeEnabled();

    await page.getByTestId('table-next').click();
    await expect(page.getByTestId('table-page')).toContainText('Page 2');
    await expect(rows).toHaveCount(1);
    await expect(page.getByTestId('table-next')).toBeDisabled();

    await page.getByTestId('table-prev').click();
    await expect(page.getByTestId('table-page')).toContainText('Page 1');
    await expect(rows).toHaveCount(20);
  });
});
