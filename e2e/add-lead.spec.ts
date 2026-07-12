import { test, expect, leadRow, queueCard } from './support/fixtures';

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

  /** Fill the modal's required fields for `source` and save. */
  async function addLead(page: import('@playwright/test').Page, source: string, name: string) {
    await page.getByTestId('add-lead').click();
    await page.getByTestId(`source-chip-${source}`).click();
    await page.getByTestId('field-name').fill(name);
    await page.getByTestId('field-phone').fill('021555000');
    await page.getByTestId('modal-save').click();
    await expect(page.getByTestId('lead-modal')).toBeHidden();
  }

  test('a lead added today is in the table but rests out of the queue until tomorrow', async ({
    page,
  }) => {
    const name = `Rest ${Date.now()}`;
    await addLead(page, 'new', name);

    await expect(leadRow(page, name)).toBeVisible();
    await expect(queueCard(page, name)).toHaveCount(0);
    await expect(page.getByTestId('queue-resting')).toContainText('1 lead entered today');
  });

  test('a trial added today is exempt from the rest period — its Day 1 check-in is due now', async ({
    page,
  }) => {
    // The trial start date defaults to today → Day 1 → first check-in due immediately.
    const name = `Trial Now ${Date.now()}`;
    await addLead(page, 'trial', name);

    await expect(queueCard(page, name)).toBeVisible();
    await expect(page.getByTestId('queue-resting')).toHaveCount(0);
  });

  test('backdating the lead date on entry skips the rest period', async ({ page }) => {
    const name = `Backdated ${Date.now()}`;
    // Local calendar date, not toISOString() — a UTC slice lands on the wrong day in NZ.
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const value = `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;

    await page.getByTestId('add-lead').click();
    await page.getByTestId('source-chip-new').click();
    await page.getByTestId('field-leadDate').fill(value);
    await page.getByTestId('field-name').fill(name);
    await page.getByTestId('field-phone').fill('021555000');
    await page.getByTestId('modal-save').click();
    await expect(page.getByTestId('lead-modal')).toBeHidden();

    // Dated yesterday → its rest day has already passed → straight into the queue.
    await expect(queueCard(page, name)).toBeVisible();
  });

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
