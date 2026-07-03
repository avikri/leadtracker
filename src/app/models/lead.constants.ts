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
