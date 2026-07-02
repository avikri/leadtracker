import { Injectable, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  DocumentData,
  Firestore,
  QueryConstraint,
  QueryDocumentSnapshot,
  Timestamp,
  UpdateData,
  addDoc,
  collection,
  collectionData,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  updateDoc,
  where,
} from '@angular/fire/firestore';

import { environment } from '../../environments/environment';
import {
  ContactMethod,
  Lead,
  LeadDraft,
  LeadSource,
  LeadStatus,
  TrialTouchpoints,
} from '../models/lead.model';
import {
  TRIAL_TOUCHPOINT_ORDER,
  TrialTouchpointKey,
  defaultContactMethod,
} from '../models/lead.constants';

/** A cursor into the leads collection: the last document snapshot of a fetched page. */
export type LeadCursor = QueryDocumentSnapshot<DocumentData>;

/**
 * The combinable "All leads" table filters. All are ANDed together.
 *
 * How each one runs (see `fetchLeadsPage` for why):
 *  - source / status / date range → Firestore `where` clauses.
 *  - search / service / promo / method → client-side predicate (`matchesLeadFilters`)
 *    applied while filling a page.
 */
export interface LeadTableFilters {
  source: LeadSource | 'all';
  status: LeadStatus | 'all';
  /** Contact method, DERIVED from source (`defaultContactMethod`) — not the stored field. */
  method: ContactMethod | 'all';
  /** Case-insensitive substring match on `name`. Empty string = off. */
  search: string;
  /** Inclusive `createdAt` bounds. Callers pass local start/end-of-day. Null = unbounded. */
  createdFrom: Date | null;
  createdTo: Date | null;
  /** Exact `serviceUsed` value. */
  service: string | 'all';
  /** Exact `promoName` value (promo-source leads only carry one). */
  promo: string | 'all';
}

/** Filters + cursor describing which slice of the "All leads" table to fetch. */
export interface LeadPageQuery extends LeadTableFilters {
  /** Fetch the page immediately AFTER this document; null/omitted fetches page 1. */
  startAfterDoc?: LeadCursor | null;
}

/** One page of table results plus the cursor needed to page forward from it. */
export interface LeadPage {
  leads: Lead[];
  /** Last doc scanned for this page — feed back as `startAfterDoc` for the next page. Null if empty. */
  lastDoc: LeadCursor | null;
  /** Whether another page may exist (false only when the scan provably hit the end). */
  hasMore: boolean;
}

/**
 * The single AND-of-all-filters predicate. Used by `fetchLeadsPage` to post-filter scanned
 * docs, and by the table's "X of Y" count over the live `leads` signal — one definition so
 * the page contents and the count can never disagree on what matches.
 */
export function matchesLeadFilters(lead: Lead, f: LeadTableFilters): boolean {
  if (f.source !== 'all' && lead.source !== f.source) return false;
  if (f.status !== 'all' && lead.status !== f.status) return false;
  if (f.method !== 'all' && defaultContactMethod(lead.source) !== f.method) return false;
  if (f.service !== 'all' && lead.serviceUsed !== f.service) return false;
  if (f.promo !== 'all' && lead.promoName !== f.promo) return false;
  const term = f.search.trim().toLowerCase();
  if (term && !lead.name.toLowerCase().includes(term)) return false;
  // A just-created lead's serverTimestamp is briefly null in latency-compensated
  // snapshots — treat it as "now" so it passes recency-style date filters.
  const created = lead.createdAt?.toMillis() ?? Date.now();
  if (f.createdFrom && created < f.createdFrom.getTime()) return false;
  if (f.createdTo && created > f.createdTo.getTime()) return false;
  return true;
}

/**
 * The ONLY place the app talks to Firestore for leads. Components read the reactive
 * signals exposed here and call the mutation methods — they never import Firestore.
 *
 * This is the seam Claude Code will extend. Notable extension points:
 *  - `createLead()` is the single ingestion entry point. The Phase 2 Mindbody / ScoreApp
 *    importer should call this same method (see "TODO: Phase 2 ingestion").
 *  - All reads/writes are scoped to `locationId` so this can become multi-studio with no
 *    schema retrofit.
 *  - Leads are never deleted; every transition is timestamped for later trend reporting.
 */
@Injectable({ providedIn: 'root' })
export class LeadService {
  private firestore = inject(Firestore);

  private readonly leadsCollection = collection(this.firestore, 'leads');

  /**
   * Active tenant. Hard-coded to the single live studio for now and kept out of the UI.
   * When this becomes multi-studio, derive it from the signed-in user instead.
   */
  readonly locationId = environment.defaultLocationId;

  /** Page size for the paginated "All leads" table, enforced via Firestore `limit()`. */
  readonly pageSize = 20;

  // --- Reactive reads ---------------------------------------------------------

  /**
   * Live stream of this location's leads, newest entered first.
   *
   * NOTE: this backs the (deliberately unpaginated) "To text today" queue only. The
   * "All leads" table does NOT read this — it pages Firestore-side via `fetchLeadsPage`
   * so it stays bounded as the collection grows without limit.
   */
  readonly leads = toSignal(
    collectionData(
      query(
        this.leadsCollection,
        where('locationId', '==', this.locationId),
        orderBy('createdAt', 'desc'),
      ),
      { idField: 'id' },
    ) as unknown as import('rxjs').Observable<Lead[]>,
    { initialValue: [] as Lead[] },
  );

  /**
   * Today's follow-up queue, most-overdue first (front desk works the backlog top-down).
   *
   * Membership rules differ by source:
   *  - Trial leads are driven by TOUCHPOINTS, not the generic status: a trial belongs in
   *    the queue whenever it still has an outstanding check-in (firstServiceContact /
   *    midTrialCheck / finalTrialCall) and the deal isn't already closed
   *    (Converted/Lost). It therefore resurfaces once per touchpoint, not once total.
   *  - Every other source keeps the simple rule: still at status 'New'.
   *
   * Sort is by "days waiting" descending so the oldest New leads and the most
   * trial-day-overdue trials float to the top. See `queuePriority`.
   */
  readonly followUpQueue = computed(() =>
    this.leads()
      .filter((l) => this.inFollowUpQueue(l))
      .sort((a, b) => this.queuePriority(b) - this.queuePriority(a)),
  );

  /** Whether a lead belongs in today's follow-up queue (see `followUpQueue`). */
  private inFollowUpQueue(lead: Lead): boolean {
    if (lead.source === 'trial') {
      // Closed deals drop out regardless of any remaining touchpoints.
      if (lead.status === 'Converted' || lead.status === 'Lost') return false;
      return hasOutstandingTouchpoint(lead);
    }
    return lead.status === 'New';
  }

  /**
   * Queue sort priority as a "days waiting" number — larger sorts earlier.
   * New/Quiz/Promo use age since entry (oldest first). Trials use days-into-trial so a
   * longer-overdue next touchpoint outranks a fresher one.
   */
  private queuePriority(lead: Lead): number {
    return lead.source === 'trial' ? daysIntoTrial(lead) : ageInDays(lead.createdAt);
  }

  // --- Paginated table read ---------------------------------------------------

  /**
   * Fetch one page (`pageSize` matching docs) of the "All leads" table with ALL filters
   * applied in combination, ordered by `createdAt` desc, using Firestore cursor pagination.
   *
   * FIRESTORE CONSTRAINT this is designed around: a query allows a range filter on only ONE
   * field, and `orderBy` must be that field. `createdAt` keeps that slot permanently — the
   * date-range filter is a true server-side `where` riding the same composite indexes the
   * table already uses (locationId [+source] [+status] + createdAt). Name search is therefore
   * NEVER a Firestore range filter (no `nameLower` startAt/endAt): it runs client-side as a
   * substring match, which is more useful than prefix anyway ("chen" finds "Sarah Chen").
   * Service/promo run client-side too — server-side equality on them would need a composite
   * index per filter combination.
   *
   * Client-side filters mean a raw Firestore page can thin out, so the page is FILLED by
   * scanning `createdAt`-ordered batches through `matchesLeadFilters` until `pageSize` match
   * or the collection ends (capped at `MAX_SCAN_PER_PAGE` docs — at studio scale the cap is
   * effectively never hit). `lastDoc` is the resume point for the next page.
   *
   * Filters run inside the fetch (not as a post-filter over a fixed page), so callers must
   * reset to page 1 — i.e. omit `startAfterDoc` — whenever any filter changes. No `count()`
   * is issued; `hasMore` says whether paging forward makes sense.
   */
  async fetchLeadsPage(opts: LeadPageQuery): Promise<LeadPage> {
    const base: QueryConstraint[] = [where('locationId', '==', this.locationId)];
    if (opts.source !== 'all') base.push(where('source', '==', opts.source));
    if (opts.status !== 'all') base.push(where('status', '==', opts.status));
    if (opts.createdFrom) base.push(where('createdAt', '>=', Timestamp.fromDate(opts.createdFrom)));
    if (opts.createdTo) base.push(where('createdAt', '<=', Timestamp.fromDate(opts.createdTo)));
    base.push(orderBy('createdAt', 'desc'));

    // Only over-fetch when a client-side filter can actually thin the batch. A method
    // filter can't thin it when source is pinned (method is derived from source).
    const scanning =
      opts.search.trim() !== '' ||
      opts.service !== 'all' ||
      opts.promo !== 'all' ||
      (opts.method !== 'all' && opts.source === 'all');
    const batchSize = scanning ? SCAN_BATCH_SIZE : this.pageSize;

    const leads: Lead[] = [];
    let cursor: LeadCursor | null = opts.startAfterDoc ?? null;
    let lastDoc: LeadCursor | null = null;
    let hasMore = false;
    let scanned = 0;

    pageFill: while (true) {
      const constraints = [...base];
      if (cursor) constraints.push(startAfter(cursor));
      constraints.push(limit(batchSize));
      const snap = await getDocs(query(this.leadsCollection, ...constraints));
      scanned += snap.docs.length;

      for (const d of snap.docs) {
        const lead = { id: d.id, ...d.data() } as Lead;
        if (!matchesLeadFilters(lead, opts)) continue;
        if (leads.length === this.pageSize) {
          hasMore = true; // found a (pageSize+1)th match — a next page definitely exists
          break pageFill;
        }
        leads.push(lead);
        lastDoc = d;
      }

      if (snap.docs.length < batchSize) break; // collection exhausted → hasMore stays false
      cursor = snap.docs[snap.docs.length - 1];
      if (leads.length === this.pageSize) {
        hasMore = true; // page full and more docs exist behind it — more MAY match
        break;
      }
      if (scanned >= MAX_SCAN_PER_PAGE) {
        // Give up scanning for this page; resume AFTER the scanned region (everything
        // between the last match and here was checked and didn't match).
        lastDoc = cursor;
        hasMore = true;
        break;
      }
    }

    return { leads, lastDoc, hasMore };
  }

  // --- Create -----------------------------------------------------------------

  /**
   * Single ingestion entry point. Stamps timestamps, status='New', source-correct
   * contactMethod, and (for trials) the empty touchpoint scaffold.
   *
   * TODO: Phase 2 ingestion — the Mindbody (new clients & trials) and ScoreApp (quiz)
   * importers should call this exact method so manual + automatic leads stay identical.
   */
  async createLead(draft: LeadDraft): Promise<string> {
    const now = serverTimestamp();
    const base: Record<string, unknown> = {
      locationId: this.locationId,
      source: draft.source,
      name: draft.name.trim(),
      phone: draft.phone.trim(),
      email: draft.email?.trim() || null,
      serviceUsed: draft.serviceUsed?.trim() || null,
      notes: draft.notes?.trim() || null,

      status: 'New',
      contactMethod: defaultContactMethod(draft.source),

      createdAt: now,
      contactedAt: null,
      lastContactAt: null,
      respondedAt: null,
      convertedAt: null,
      conversionOutcome: null,
      lostAt: null,

      ...this.sourceFields(draft.source, draft),
    };

    const ref = await addDoc(this.leadsCollection, base);
    return ref.id;
  }

  // --- Edit -------------------------------------------------------------------

  /** Patch arbitrary shared/source fields. Status flow goes through the methods below. */
  async updateLead(id: string, patch: Partial<Lead>): Promise<void> {
    await updateDoc(this.docRef(id), patch as unknown as UpdateData<DocumentData>);
  }

  /**
   * Changing the source is a first-class action. Shared fields (name, phone, email,
   * status, timestamps) are preserved; the conditional field set is swapped and contactMethod
   * is recomputed. Fields the new source doesn't use are nulled rather than left stale.
   */
  async changeSource(id: string, current: Lead, newSource: LeadSource): Promise<void> {
    if (current.source === newSource) return;

    const cleared = {
      trialStage: null,
      trialDay: null,
      experienceNotes: null,
      touchpoints: null,
      promoName: null,
      purchaseDate: null,
      dealName: null,
      dealPurchaseDate: null,
    };

    await updateDoc(this.docRef(id), {
      source: newSource,
      contactMethod: defaultContactMethod(newSource),
      ...cleared,
      // Re-apply the new source's fields, carrying over anything still relevant.
      ...this.sourceFields(newSource, current),
    } as unknown as UpdateData<DocumentData>);
  }

  // --- Status flow ------------------------------------------------------------
  // New → Contacted → Responded → (Converted | Lost). Every step is timestamped.

  /** Mark the lead contacted (texted/called per its contactMethod). */
  async markContacted(lead: Lead): Promise<void> {
    const now = serverTimestamp();
    await updateDoc(this.docRef(lead.id), {
      status: 'Contacted',
      contactedAt: lead.contactedAt ?? now, // keep first-contact time if already set
      lastContactAt: now,
    });
  }

  /** The lead replied. */
  async markResponded(lead: Lead): Promise<void> {
    await updateDoc(this.docRef(lead.id), {
      status: 'Responded',
      respondedAt: serverTimestamp(),
      lastContactAt: serverTimestamp(),
    });
  }

  /**
   * Terminal: converted. `conversionOutcome` records what that meant for this source
   * (returned / bought membership / booked a visit / bought a pack) so it stays queryable.
   */
  async markConverted(lead: Lead, conversionOutcome: string): Promise<void> {
    await updateDoc(this.docRef(lead.id), {
      status: 'Converted',
      convertedAt: serverTimestamp(),
      conversionOutcome: conversionOutcome.trim() || null,
    });
  }

  /** Terminal: lost. MANUAL only — nothing in the app writes this off automatically. */
  async markLost(lead: Lead): Promise<void> {
    await updateDoc(this.docRef(lead.id), {
      status: 'Lost',
      lostAt: serverTimestamp(),
    });
  }

  // --- Trial touchpoints ------------------------------------------------------

  /** Mark one of the three trial check-ins done, timestamped. */
  async markTouchpoint(lead: Lead, key: TrialTouchpointKey): Promise<void> {
    const existing = lead.touchpoints ?? emptyTouchpoints();
    const next: TrialTouchpoints = {
      ...existing,
      [key]: { done: true, at: Timestamp.now() },
    };
    await updateDoc(this.docRef(lead.id), {
      touchpoints: next,
      lastContactAt: serverTimestamp(),
    });
  }

  // --- Internals --------------------------------------------------------------

  private docRef(id: string) {
    return doc(this.firestore, 'leads', id);
  }

  /** Build the source-specific slice of a lead from a draft/lead, defaulting trial scaffold. */
  private sourceFields(source: LeadSource, src: Partial<Lead>): Record<string, unknown> {
    switch (source) {
      case 'trial':
        return {
          trialStage: src.trialStage ?? null,
          trialDay: src.trialDay ?? null,
          experienceNotes: src.experienceNotes ?? null,
          touchpoints: src.touchpoints ?? emptyTouchpoints(),
        };
      case 'promo':
        return {
          promoName: src.promoName ?? null,
          purchaseDate: src.purchaseDate ?? null,
        };
      case 'deal99':
        return {
          dealName: src.dealName ?? null,
          dealPurchaseDate: src.dealPurchaseDate ?? null,
        };
      // 'new' and 'quiz' only use shared fields.
      default:
        return {};
    }
  }
}

const MS_PER_DAY = 86_400_000;

/** Raw docs fetched per round trip while filling a client-filtered page. */
const SCAN_BATCH_SIZE = 100;
/** Hard cap on raw docs scanned for ONE page, so a no-match search can't read unbounded. */
const MAX_SCAN_PER_PAGE = 500;

/** True if a trial lead still has at least one incomplete touchpoint. */
function hasOutstandingTouchpoint(lead: Lead): boolean {
  const tp = lead.touchpoints ?? emptyTouchpoints();
  return TRIAL_TOUCHPOINT_ORDER.some((k) => !tp[k].done);
}

/** Whole/fractional days since a timestamp. */
function ageInDays(ts: Timestamp): number {
  return (Date.now() - ts.toMillis()) / MS_PER_DAY;
}

/** How far into the 7-day trial: the recorded trialDay if set, else derived from entry age. */
function daysIntoTrial(lead: Lead): number {
  return typeof lead.trialDay === 'number' ? lead.trialDay : ageInDays(lead.createdAt);
}

/** Fresh, all-undone trial touchpoint scaffold. */
export function emptyTouchpoints(): TrialTouchpoints {
  const blank = { done: false, at: null };
  return {
    firstServiceContact: { ...blank },
    midTrialCheck: { ...blank },
    finalTrialCall: { ...blank },
  };
}
