import { ContactMethod, LeadSource, LeadStatus } from './lead.model';

/** Human-readable labels + small bits of source/status logic, kept in one place. */

export const LEAD_SOURCES: LeadSource[] = ['new', 'trial', 'quiz', 'promo'];

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
};

/** What "follow up" is trying to achieve, per source. Shown as helper text. */
export const SOURCE_GOAL: Record<LeadSource, string> = {
  new: 'Get them to come back',
  trial: 'Convert to a membership',
  quiz: 'Get them in the door — book a visit',
  promo: 'Convert to a pack or membership',
};

/**
 * Contact method is driven by source, not hard-coded per call site.
 * Quiz leads are phoned; everyone else is texted.
 */
export function defaultContactMethod(source: LeadSource): ContactMethod {
  return source === 'quiz' ? 'call' : 'text';
}

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
};

export const STATUS_COLOR: Record<LeadStatus, string> = {
  New: '#b45309', // amber
  Contacted: '#1d4ed8', // blue
  Responded: '#7c3aed', // violet
  Converted: '#15803d', // green
  Lost: '#6b7280', // grey
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
