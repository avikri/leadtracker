import { Timestamp } from '@angular/fire/firestore';

/**
 * Domain model for a single lead.
 *
 * One Firestore collection: `leads`. Every document conforms to this interface.
 * Source-specific fields are optional and only populated for the relevant source.
 *
 * Design rules baked into this model:
 *  - Leads are NEVER deleted. Status moves through soft states only.
 *  - Every state transition is timestamped, so month-over-month trend reporting
 *    can be built on top later without backfilling.
 *  - `organizationId` is on every lead (multi-tenancy plumbing) but never shown in the UI.
 */

/** Where the lead came from. Each source captures a different field set + conversion goal. */
export type LeadSource = 'new' | 'trial' | 'quiz' | 'promo' | 'deal99';

/**
 * Overall lifecycle. Linear except for the terminal split:
 *   New → Contacted → Responded → (Converted | Lost)
 * `Lost` is a MANUAL status only — nothing writes it off automatically.
 */
export type LeadStatus = 'New' | 'Contacted' | 'Responded' | 'Converted' | 'Lost';

/** How this lead is followed up. Quiz leads are CALLED; everyone else is TEXTED. */
export type ContactMethod = 'text' | 'call';

/** A 7-day-trial touchpoint: independently markable, timestamped. */
export interface Touchpoint {
  done: boolean;
  at: Timestamp | null;
}

/** The three trial check-ins, layered on top of the core status. */
export interface TrialTouchpoints {
  firstServiceContact: Touchpoint;
  midTrialCheck: Touchpoint;
  finalTrialCall: Touchpoint;
}

export interface Lead {
  id: string;

  /**
   * Multi-tenancy plumbing: FK to `organizations` (see org.model.ts). Always set, never
   * surfaced in the UI, and load-bearing in the Firestore rules — access requires it to
   * match the caller's `users/{uid}.organizationId`.
   */
  organizationId: string;

  source: LeadSource;

  // --- Shared fields (all sources) ---
  name: string;
  phone: string;
  email: string | null;
  serviceUsed: string | null;
  notes: string | null;

  // --- Follow-up block ---
  status: LeadStatus;
  contactMethod: ContactMethod;
  /**
   * Rest period: the earliest moment this lead may surface in the "To contact today" queue —
   * the start of the calendar day AFTER its effective date, so a lead entered today is only
   * worked from tomorrow (see `followUpFromDate`). It never affects the "All leads" table.
   *
   * Only stamped on NON-trial leads created after the rest period was introduced. Trials are
   * exempt (their queue timing is the Day 1/4/7 check-in schedule), and leads that predate
   * the field have it ABSENT, which means "due now" — this rule never retro-holds an
   * existing lead. See `followUpDue`.
   */
  followUpFrom?: Timestamp | null;

  // --- Timestamps (every transition recorded) ---
  createdAt: Timestamp;
  contactedAt: Timestamp | null;
  lastContactAt: Timestamp | null;
  respondedAt: Timestamp | null;
  convertedAt: Timestamp | null;
  /** Free-text record of what "converted" meant for this lead (source-specific). */
  conversionOutcome: string | null;
  lostAt: Timestamp | null;

  // --- New-client-specific (source === 'new') ---
  /**
   * Business date of the lead — editable so staff can backdate a forgotten entry.
   * `createdAt` stays the untouched system entry timestamp; date filtering keys off
   * the EFFECTIVE date (`leadDate` when present, else `createdAt`).
   */
  leadDate?: Timestamp | null;

  // --- Trial-specific (source === 'trial') ---
  /** Day 1 of the 7-day trial. Drives the date-based check-in queue (Day 1 / 4 / 7). */
  trialStartDate?: Timestamp | null;
  /** Reference/display only (defaults to start + 7 days in the form) — no logic reads it. */
  trialEndDate?: Timestamp | null;
  /** @deprecated Legacy free-text stage, replaced by trialStartDate. Still on old docs. */
  trialStage?: string | null;
  /** @deprecated Legacy manual day number, replaced by deriving from trialStartDate. */
  trialDay?: number | null;
  experienceNotes?: string | null;
  touchpoints?: TrialTouchpoints;

  // --- Promo-specific (source === 'promo') ---
  promoName?: string | null;
  purchaseDate?: Timestamp | null;

  // --- $99 Deal-specific (source === 'deal99') ---
  // Mirrors the promo shape (offer purchased + purchase date) but a DISTINCT offer.
  dealName?: string | null;
  dealPurchaseDate?: Timestamp | null;
}

/**
 * Shape used to CREATE a lead. The caller supplies domain fields; the service stamps
 * id, organizationId, status='New', timestamps and contactMethod.
 * This is the single ingestion entry point that the Phase 2 importer will also call.
 */
export type LeadDraft = Pick<Lead, 'source' | 'name' | 'phone'> &
  Partial<
    Pick<
      Lead,
      | 'email'
      | 'serviceUsed'
      | 'notes'
      | 'leadDate'
      | 'trialStartDate'
      | 'trialEndDate'
      | 'experienceNotes'
      | 'promoName'
      | 'purchaseDate'
      | 'dealName'
      | 'dealPurchaseDate'
    >
  >;
