import { ContactMethod, Lead, LeadSource, LeadStatus } from './lead.model';

/** Human-readable labels + small bits of source/status logic, kept in one place. */

export const LEAD_SOURCES: LeadSource[] = ['new', 'trial', 'quiz', 'promo', 'deal99'];

export const LEAD_STATUSES: LeadStatus[] = [
  'New',
  'Contacted',
  'Responded',
  'Converted',
  'Lost',
];

export const SOURCE_LABEL: Record<LeadSource, string> = {
  new: 'New client',
  trial: '7-day trial',
  quiz: 'Quiz lead',
  promo: 'Promo',
  deal99: '$99 Deals',
};

/** What "follow up" is trying to achieve, per source. Shown as helper text. */
export const SOURCE_GOAL: Record<LeadSource, string> = {
  new: 'Get them to come back',
  trial: 'Convert to a membership',
  quiz: 'Get them in the door — book a visit',
  promo: 'Convert to a pack or membership',
  deal99: 'Convert to a pack or membership',
};

/**
 * Contact method is driven by source, not hard-coded per call site.
 * Quiz leads are phoned; everyone else is texted.
 */
export function defaultContactMethod(source: LeadSource): ContactMethod {
  return source === 'quiz' ? 'call' : 'text';
}

export const CONTACT_METHODS: ContactMethod[] = ['text', 'call'];

export const CONTACT_METHOD_LABEL: Record<ContactMethod, string> = {
  text: 'Text',
  call: 'Call',
};

/** Verb used on the "advance from New" action + queue label, e.g. "Mark texted". */
export function contactActionLabel(method: ContactMethod): string {
  return method === 'call' ? 'Mark called' : 'Mark texted';
}

export function contactVerbPast(method: ContactMethod): string {
  return method === 'call' ? 'Called' : 'Texted';
}

/**
 * How long a newly entered lead RESTS before the follow-up queue asks the front desk to
 * contact it: leads entered today are worked tomorrow. Trials are exempt — their queue
 * timing is the Day 1 / 4 / 7 check-in schedule.
 */
export const FOLLOW_UP_REST_DAYS = 1;

/**
 * When a lead whose effective date is `on` becomes due to contact: the START of the calendar
 * day `FOLLOW_UP_REST_DAYS` later. Whole calendar days, not 24h from entry, so a lead typed
 * in at 5pm is in the queue for the next morning's shift rather than appearing mid-afternoon.
 *
 * Callers pass the EFFECTIVE date — `leadDate` when staff backdated the entry, else the
 * moment of entry — so a lead backdated to last week is already past its rest day and
 * surfaces immediately.
 */
export function followUpFromDate(on: Date): Date {
  return new Date(on.getFullYear(), on.getMonth(), on.getDate() + FOLLOW_UP_REST_DAYS);
}

/**
 * Whether a lead's rest period is over, i.e. it may appear in the follow-up queue today.
 *
 * An ABSENT `followUpFrom` means due now. That covers both exempt trials and every lead
 * written before the rest period existed, so introducing it changed nothing about leads
 * already in the book.
 */
export function followUpDue(lead: Lead, now: number = Date.now()): boolean {
  const from = lead.followUpFrom?.toMillis();
  return from == null || from <= now;
}

/** Suggested wording for what a conversion means, per source (free-text, editable). */
export const CONVERSION_PROMPT: Record<LeadSource, string> = {
  new: 'Returned / re-booked',
  trial: 'Bought a membership',
  quiz: 'Booked a visit / came in',
  promo: 'Bought a pack or membership',
  deal99: 'Bought a pack or membership',
};

/** Maps status → pill class; colours live in styles.css next to the brand tokens. */
export const STATUS_PILL_CLASS: Record<LeadStatus, string> = {
  New: 'pill-new',
  Contacted: 'pill-contacted',
  Responded: 'pill-responded',
  Converted: 'pill-converted',
  Lost: 'pill-lost',
};

export const TRIAL_TOUCHPOINT_LABEL: Record<string, string> = {
  firstServiceContact: 'First service contact',
  midTrialCheck: 'Mid-trial check',
  finalTrialCall: 'Final trial call',
};

/** Ordered keys so the "next outstanding touchpoint" is deterministic. */
export const TRIAL_TOUCHPOINT_ORDER = [
  'firstServiceContact',
  'midTrialCheck',
  'finalTrialCall',
] as const;
export type TrialTouchpointKey = (typeof TRIAL_TOUCHPOINT_ORDER)[number];

/**
 * The next outstanding trial check-in for a lead, or null when it isn't a trial or every
 * check-in is already done. Single source of truth for "which touchpoint is next" — shared
 * by the queue card action, the queue "Next:" label, and the trial check-in filter, so the
 * button a card shows and the filter it matches can never disagree.
 */
export function nextOutstandingTouchpointKey(lead: Lead): TrialTouchpointKey | null {
  if (lead.source !== 'trial') return null;
  const tp = lead.touchpoints;
  return TRIAL_TOUCHPOINT_ORDER.find((k) => !tp || !tp[k].done) ?? null;
}

/** Queue action button verb for marking a specific trial touchpoint done. */
export const TRIAL_TOUCHPOINT_ACTION_LABEL: Record<TrialTouchpointKey, string> = {
  firstServiceContact: 'Mark first contact done',
  midTrialCheck: 'Mark mid-trial check done',
  finalTrialCall: 'Mark final call done',
};

/**
 * The trial day each check-in becomes due (Day 1 = trialStartDate): first-visit follow-up
 * on Day 1, mid-trial check on Day 4, final trial call on Day 7. A trial sits in the
 * follow-up queue only while its next outstanding touchpoint is due (see LeadService).
 */
export const TRIAL_TOUCHPOINT_DUE_DAY: Record<TrialTouchpointKey, number> = {
  firstServiceContact: 1,
  midTrialCheck: 4,
  finalTrialCall: 7,
};

const MS_PER_DAY = 86_400_000;

/**
 * Which trial day the lead is on TODAY, derived client-side (never a Firestore query —
 * `createdAt` must keep the single range-filter slot). Day 1 = the start date's calendar
 * day. Legacy trials without a `trialStartDate` fall back to `createdAt` as Day 1, so they
 * keep flowing through the queue instead of breaking or vanishing.
 */
export function trialDayNumber(lead: Lead): number {
  // A just-created lead's serverTimestamp is briefly null — treat as "today" (Day 1).
  const start = (lead.trialStartDate ?? lead.createdAt)?.toDate() ?? new Date();
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  // Round absorbs DST hour shifts in the calendar-day difference.
  return Math.round((today - startDay) / MS_PER_DAY) + 1;
}
