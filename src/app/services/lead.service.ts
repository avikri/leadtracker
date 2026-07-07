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

import { Observable, of } from 'rxjs';
import { switchMap } from 'rxjs/operators';

import { OrgService } from './org.service';
import {
  ContactMethod,
  Lead,
  LeadDraft,
  LeadSource,
  LeadStatus,
  TrialTouchpoints,
} from '../models/lead.model';
import {
  TRIAL_TOUCHPOINT_DUE_DAY,
  TrialTouchpointKey,
  defaultContactMethod,
  nextOutstandingTouchpointKey,
  trialDayNumber,
} from '../models/lead.constants';

/** A cursor into the leads collection: the last document snapshot of a fetched page. */
export type LeadCursor = QueryDocumentSnapshot<DocumentData>;

/**
 * The combinable "All leads" table filters. All are ANDed together.
 *
 * How each one runs (see `fetchLeadsPage` for why):
 *  - source / status → Firestore `where` clauses.
 *  - search / service / promo / method / checkin / date range → client-side predicate
 *    (`matchesLeadFilters`) applied while filling a page.
 */
export interface LeadTableFilters {
  source: LeadSource | 'all';
  status: LeadStatus | 'all';
  /**
   * Contact method, DERIVED from source (`defaultContactMethod`) — not the stored field.
   * Applies to NON-trial leads only: trials are sliced by `checkin` instead, so a specific
   * method ('text'/'call') never matches a trial.
   */
  method: ContactMethod | 'all';
  /**
   * Trial check-in stage, matched against the lead's NEXT outstanding touchpoint
   * (`nextOutstandingTouchpointKey`). Applies to trial leads only — a specific stage never
   * matches a non-trial lead. Independent of `method`.
   */
  checkin: TrialTouchpointKey | 'all';
  /** Case-insensitive substring match on `name`. Empty string = off. */
  search: string;
  /**
   * Inclusive bounds on the EFFECTIVE lead date — `leadDate` when present (backdated
   * new-client entries), else `createdAt`. Callers pass local start/end-of-day.
   * Null = unbounded.
   */
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
  // Contact method applies to non-trial leads only; trials are matched by `checkin`.
  if (f.method !== 'all') {
    if (lead.source === 'trial') return false;
    if (defaultContactMethod(lead.source) !== f.method) return false;
  }
  // Trial check-in stage applies to trial leads only (their next outstanding touchpoint).
  if (f.checkin !== 'all') {
    if (lead.source !== 'trial') return false;
    if (nextOutstandingTouchpointKey(lead) !== f.checkin) return false;
  }
  if (f.service !== 'all' && lead.serviceUsed !== f.service) return false;
  if (f.promo !== 'all' && lead.promoName !== f.promo) return false;
  const term = f.search.trim().toLowerCase();
  if (term && !lead.name.toLowerCase().includes(term)) return false;
  // Date range keys off the EFFECTIVE date: leadDate (backdated new-client entries) when
  // present, else createdAt. A just-created lead's serverTimestamp is briefly null in
  // latency-compensated snapshots — treat it as "now" so it passes recency-style filters.
  const effective = (lead.leadDate ?? lead.createdAt)?.toMillis() ?? Date.now();
  if (f.createdFrom && effective < f.createdFrom.getTime()) return false;
  if (f.createdTo && effective > f.createdTo.getTime()) return false;
  return true;
}

/**
 * The ONLY place the app talks to Firestore for leads. Components read the reactive
 * signals exposed here and call the mutation methods — they never import Firestore.
 *
 * This is the seam Claude Code will extend. Notable extension points:
 *  - `createLead()` is the single ingestion entry point. The Phase 2 Mindbody / ScoreApp
 *    importer should call this same method (see "TODO: Phase 2 ingestion").
 *  - All reads/writes are scoped to the signed-in user's `organizationId` (see OrgService),
 *    which the Firestore rules also enforce server-side.
 *  - Leads are never deleted; every transition is timestamped for later trend reporting.
 */
@Injectable({ providedIn: 'root' })
export class LeadService {
  private firestore = inject(Firestore);
  private org = inject(OrgService);

  private readonly leadsCollection = collection(this.firestore, 'leads');

  /** Page size for the paginated "All leads" table, enforced via Firestore `limit()`. */
  readonly pageSize = 20;

  // --- Reactive reads ---------------------------------------------------------

  /**
   * Live stream of the signed-in user's organisation's leads, newest entered first.
   * Re-targets whenever the org id changes (login/logout); empty while it is unknown.
   *
   * NOTE: this backs the (deliberately unpaginated) "To text today" queue only. The
   * "All leads" table does NOT read this — it pages Firestore-side via `fetchLeadsPage`
   * so it stays bounded as the collection grows without limit.
   */
  readonly leads = toSignal(
    this.org.organizationId$.pipe(
      switchMap((orgId) =>
        orgId === null
          ? of([] as Lead[])
          : (collectionData(
              query(
                this.leadsCollection,
                where('organizationId', '==', orgId),
                orderBy('createdAt', 'desc'),
              ),
              { idField: 'id' },
            ) as unknown as Observable<Lead[]>),
      ),
    ),
    { initialValue: [] as Lead[] },
  );

  /**
   * Today's follow-up queue, most-overdue first (front desk works the backlog top-down).
   *
   * Membership rules differ by source:
   *  - Trial leads are driven by TOUCHPOINT DUE DATES, not the generic status: a trial
   *    surfaces only when its NEXT incomplete check-in is due — current trial day
   *    (derived from trialStartDate, Day 1 = start) ≥ that touchpoint's due day
   *    (Day 1 / 4 / 7) — and stays until it's marked complete, so an overdue check-in is
   *    never silently dropped. Between due days, and once every check-in is done or the
   *    deal is closed (Converted/Lost), the trial stays out of the queue.
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
      const next = nextOutstandingTouchpointKey(lead);
      if (!next) return false; // all three check-ins done
      // Due (or overdue) check-ins surface and stay; between due days the trial rests.
      return trialDayNumber(lead) >= TRIAL_TOUCHPOINT_DUE_DAY[next];
    }
    return lead.status === 'New';
  }

  /**
   * Queue sort priority as a "days waiting" number — larger sorts earlier.
   * New/Quiz/Promo use age since entry (oldest first). Trials use days-into-trial so a
   * longer-overdue next touchpoint outranks a fresher one.
   */
  private queuePriority(lead: Lead): number {
    return lead.source === 'trial' ? trialDayNumber(lead) : ageInDays(lead.createdAt);
  }

  // --- Paginated table read ---------------------------------------------------

  /**
   * Fetch one page (`pageSize` matching docs) of the "All leads" table with ALL filters
   * applied in combination, ordered by `createdAt` desc, using Firestore cursor pagination.
   *
   * FIRESTORE CONSTRAINT this is designed around: a query allows a range filter on only ONE
   * field, and `orderBy` must be that field. `createdAt` keeps that slot permanently (it's
   * the sort), and NO range `where` is issued at all: the date filter keys off the EFFECTIVE
   * date — `leadDate` when present (backdatable new-client entries), else `createdAt` —
   * which spans two fields, so it runs client-side in `matchesLeadFilters` exactly like the
   * name search. Name search is likewise NEVER a Firestore range filter (no `nameLower`
   * startAt/endAt): it runs client-side as a substring match, which is more useful than
   * prefix anyway ("chen" finds "Sarah Chen"). Service/promo run client-side too —
   * server-side equality on them would need a composite index per filter combination.
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
    const orgId = await this.org.requireOrganizationId();
    const base: QueryConstraint[] = [where('organizationId', '==', orgId)];
    if (opts.source !== 'all') base.push(where('source', '==', opts.source));
    if (opts.status !== 'all') base.push(where('status', '==', opts.status));
    base.push(orderBy('createdAt', 'desc'));

    // Only over-fetch when a client-side filter can actually thin the batch. A method
    // filter can't thin it when source is pinned (method is derived from source); a checkin
    // filter always can (it keeps only trials at one specific next touchpoint).
    const scanning =
      opts.search.trim() !== '' ||
      opts.service !== 'all' ||
      opts.promo !== 'all' ||
      opts.checkin !== 'all' ||
      opts.createdFrom !== null ||
      opts.createdTo !== null ||
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
    const organizationId = await this.org.requireOrganizationId();
    const now = serverTimestamp();
    const base: Record<string, unknown> = {
      organizationId,
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
      leadDate: null,
      trialStartDate: null,
      trialEndDate: null,
      trialStage: null, // legacy pair — still nulled so old docs shed them on a source change
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
      case 'new':
        return {
          leadDate: src.leadDate ?? null,
        };
      case 'trial':
        return {
          trialStartDate: src.trialStartDate ?? null,
          trialEndDate: src.trialEndDate ?? null,
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
      // 'quiz' only uses shared fields.
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

/** Whole/fractional days since a timestamp. */
function ageInDays(ts: Timestamp): number {
  return (Date.now() - ts.toMillis()) / MS_PER_DAY;
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
