import { test, expect, orgs, queueCard } from './support/fixtures';

/**
 * The "To contact today" queue: New non-trial leads past their rest day, plus trials whose
 * next incomplete check-in is due (Day 1 / 4 / 7 from trialStartDate), and how they drop out
 * once actioned. Leads are seeded BEFORE sign-in so the live queue picks them up.
 *
 * Seeds omit `followUpFrom` unless a test is about the rest period — an absent field means
 * "due now", exactly like the leads that predate the rest period.
 */

/** N whole calendar days ago at noon, so day-boundary math can't flake around midnight. */
function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(12, 0, 0, 0);
  return d;
}

/** Midnight tonight — the rest day stamped on a lead entered today. */
function startOfTomorrow(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return d;
}
test.describe('Follow-up queue', () => {
  test('a New lead appears and leaves once marked contacted', async ({
    seed,
    loginAsPrimary,
    page,
  }) => {
    await seed.seedLead(orgs.A, { source: 'new', name: 'Queue New', status: 'New' });
    await loginAsPrimary();

    const card = queueCard(page, 'Queue New');
    await expect(card).toBeVisible();

    await card.getByTestId('queue-action').click();
    // markContacted flips status off "New" → the live queue drops the card.
    await expect(card).toHaveCount(0);
  });

  test('only New non-trial leads are queued (Contacted/Converted are not)', async ({
    seed,
    loginAsPrimary,
    page,
  }) => {
    await seed.seedLead(orgs.A, { source: 'new', name: 'Q Waiting', status: 'New' });
    await seed.seedLead(orgs.A, { source: 'new', name: 'Q Already Contacted', status: 'Contacted' });
    await seed.seedLead(orgs.A, { source: 'quiz', name: 'Q Converted', status: 'Converted' });
    await loginAsPrimary();

    await expect(queueCard(page, 'Q Waiting')).toBeVisible();
    await expect(queueCard(page, 'Q Already Contacted')).toHaveCount(0);
    await expect(queueCard(page, 'Q Converted')).toHaveCount(0);
    await expect(page.getByTestId('queue-count')).toHaveText('1');
  });

  test('a lead entered today rests out of the queue until tomorrow', async ({
    seed,
    loginAsPrimary,
    page,
  }) => {
    // Entered today → rest day is midnight tonight → held back, and counted as resting.
    await seed.seedLead(orgs.A, {
      source: 'new',
      name: 'Entered Today',
      status: 'New',
      followUpFrom: startOfTomorrow(),
    });
    // Entered yesterday → its rest day is behind us → due now.
    await seed.seedLead(orgs.A, {
      source: 'new',
      name: 'Entered Yesterday',
      status: 'New',
      createdAt: daysAgo(1),
      followUpFrom: daysAgo(1), // noon yesterday: safely in the past whenever the test runs
    });
    // Leads written before the rest period existed have no stamp → due now, as they were.
    await seed.seedLead(orgs.A, { source: 'new', name: 'Legacy Lead', status: 'New' });
    await loginAsPrimary();

    await expect(queueCard(page, 'Entered Yesterday')).toBeVisible();
    await expect(queueCard(page, 'Legacy Lead')).toBeVisible();
    await expect(queueCard(page, 'Entered Today')).toHaveCount(0);
    await expect(page.getByTestId('queue-count')).toHaveText('2');
    await expect(page.getByTestId('queue-resting')).toContainText('1 lead entered today');
  });

  test('a trial with a DUE check-in is queued and leaves when it is done', async ({
    seed,
    loginAsPrimary,
    page,
  }) => {
    // Day 7 of the trial with only the final call outstanding → due today.
    await seed.seedLead(orgs.A, {
      source: 'trial',
      name: 'Queue Trial',
      status: 'New',
      trialStartDate: daysAgo(6),
      touchpointsDone: ['firstServiceContact', 'midTrialCheck'],
    });
    await loginAsPrimary();

    const card = queueCard(page, 'Queue Trial');
    await expect(card).toBeVisible();

    await card.getByTestId('queue-action').click();
    // Final touchpoint done → no outstanding check-ins → card leaves the queue.
    await expect(card).toHaveCount(0);
  });

  test('trials only surface when their next check-in is due (Day 1 / 4 / 7)', async ({
    seed,
    loginAsPrimary,
    page,
  }) => {
    // Day 1, nothing done → first-visit follow-up due today.
    await seed.seedLead(orgs.A, {
      source: 'trial',
      name: 'Trial Day One',
      status: 'New',
      trialStartDate: daysAgo(0),
    });
    // Day 2 with the first check-in done → mid-trial check not due until Day 4.
    await seed.seedLead(orgs.A, {
      source: 'trial',
      name: 'Trial Between Days',
      status: 'New',
      trialStartDate: daysAgo(1),
      touchpointsDone: ['firstServiceContact'],
    });
    // Day 5 with the mid-trial check still open → overdue, must stay visible.
    await seed.seedLead(orgs.A, {
      source: 'trial',
      name: 'Trial Overdue',
      status: 'New',
      trialStartDate: daysAgo(4),
      touchpointsDone: ['firstServiceContact'],
    });
    // Legacy trial without a start date → falls back to createdAt (today) = Day 1.
    await seed.seedLead(orgs.A, { source: 'trial', name: 'Trial Legacy', status: 'New' });
    await loginAsPrimary();

    await expect(queueCard(page, 'Trial Day One')).toBeVisible();
    await expect(queueCard(page, 'Trial Overdue')).toBeVisible();
    await expect(queueCard(page, 'Trial Legacy')).toBeVisible();
    await expect(queueCard(page, 'Trial Between Days')).toHaveCount(0);

    // Completing the due Day-1 check-in removes the card — the mid-trial check does NOT
    // surface immediately; it waits for Day 4.
    await queueCard(page, 'Trial Day One').getByTestId('queue-action').click();
    await expect(queueCard(page, 'Trial Day One')).toHaveCount(0);
  });

  test('a quiz lead is shown as a call, filterable by contact method', async ({
    seed,
    loginAsPrimary,
    page,
  }) => {
    await seed.seedLead(orgs.A, { source: 'quiz', name: 'Quiz Caller', status: 'New' });
    await seed.seedLead(orgs.A, { source: 'new', name: 'Text Me', status: 'New' });
    await loginAsPrimary();

    await expect(queueCard(page, 'Quiz Caller')).toBeVisible();
    await expect(queueCard(page, 'Text Me')).toBeVisible();

    // Filter the queue to calls only → the quiz lead stays, the texted lead drops.
    await page.getByTestId('queue-filter-method').selectOption('call');
    await expect(queueCard(page, 'Quiz Caller')).toBeVisible();
    await expect(queueCard(page, 'Text Me')).toHaveCount(0);
  });
});
