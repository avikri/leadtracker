import { test, expect, leadRow } from './support/fixtures';

/**
 * Adding leads through the shared modal — one case per source, verifying the source-specific
 * field set appears and the new lead lands in the "All leads" table (which refreshes on add).
 */
test.describe('Add lead', () => {
  test.beforeEach(async ({ seed, loginAsPrimary }) => {
    await loginAsPrimary();
  });

  const cases = [
    { source: 'new', extraField: 'field-leadDate' },
    { source: 'trial', extraField: 'field-trialStartDate' },
    { source: 'quiz', extraField: null },
    { source: 'promo', extraField: 'field-promoName' },
    { source: 'deal99', extraField: 'field-dealName' },
  ] as const;

  for (const c of cases) {
    test(`adds a ${c.source} lead and it appears in the table`, async ({ page }) => {
      const name = `Add ${c.source} ${Date.now()}`;

      await page.getByTestId('add-lead').click();
      await expect(page.getByTestId('lead-modal')).toBeVisible();

      await page.getByTestId(`source-chip-${c.source}`).click();
      if (c.extraField) {
        await expect(page.getByTestId(c.extraField)).toBeVisible();
      }
      // Every source captures an (optional) email — including trials.
      await expect(page.getByTestId('field-email')).toBeVisible();
      // The trial date pair defaults to today → today + 7, end auto-follows the start.
      if (c.source === 'trial') {
        await expect(page.getByTestId('field-trialStartDate')).not.toHaveValue('');
        await expect(page.getByTestId('field-trialEndDate')).not.toHaveValue('');
      }

      await page.getByTestId('field-name').fill(name);
      await page.getByTestId('field-phone').fill('021555000');
      await page.getByTestId('modal-save').click();

      await expect(page.getByTestId('lead-modal')).toBeHidden();
      await expect(leadRow(page, name)).toBeVisible();
      await expect(leadRow(page, name)).toHaveAttribute('data-source', c.source);
    });
  }

  test('requires a name and phone before saving', async ({ page }) => {
    await page.getByTestId('add-lead').click();
    // Save is disabled until both required fields are filled.
    await expect(page.getByTestId('modal-save')).toBeDisabled();
    await page.getByTestId('field-name').fill('Only a name');
    await expect(page.getByTestId('modal-save')).toBeDisabled();
    await page.getByTestId('field-phone').fill('021999000');
    await expect(page.getByTestId('modal-save')).toBeEnabled();
  });

  test('reopening the Add Lead modal always starts blank on the default source', async ({
    page,
  }) => {
    // Type into the form on a non-default source, then cancel without saving.
    await page.getByTestId('add-lead').click();
    await page.getByTestId('source-chip-promo').click();
    await page.getByTestId('field-name').fill('Should Not Persist');
    await page.getByTestId('field-promoName').fill('Stale Promo');
    await page.getByTestId('modal-cancel').click();
    await expect(page.getByTestId('lead-modal')).toBeHidden();

    // Reopen: every field is blank again and the source is back to the default.
    await page.getByTestId('add-lead').click();
    await expect(page.getByTestId('field-name')).toHaveValue('');
    await expect(page.getByTestId('source-chip-new')).toHaveClass(/active/);
    await expect(page.getByTestId('field-promoName')).toHaveCount(0);
  });
});
