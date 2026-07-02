import {
  Component,
  EventEmitter,
  OnDestroy,
  OnInit,
  Output,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DocumentData, QueryDocumentSnapshot } from '@angular/fire/firestore';

import {
  LeadCursor,
  LeadService,
  LeadTableFilters,
  matchesLeadFilters,
} from '../../services/lead.service';
import { DialogService } from '../../shared/dialog/dialog.service';
import { ContactMethod, Lead, LeadSource, LeadStatus } from '../../models/lead.model';
import {
  CONTACT_METHODS,
  CONTACT_METHOD_LABEL,
  CONVERSION_PROMPT,
  LEAD_SOURCES,
  LEAD_STATUSES,
  SOURCE_LABEL,
  STATUS_PILL_CLASS,
  TRIAL_TOUCHPOINT_LABEL,
  TRIAL_TOUCHPOINT_ORDER,
  TrialTouchpointKey,
  contactActionLabel,
} from '../../models/lead.constants';
import { dateTime, shortDate } from '../../shared/format.util';

/**
 * All-leads table. Filterable by any COMBINATION of name search, source, status, service,
 * promo and created-date range (filters affect the table only, never the queue). Inline
 * action advances the pipeline; at "Responded" the user chooses Convert or Lost (both
 * terminal). Trial rows expand to show + mark the three check-ins.
 *
 * Paginated Firestore-side at {@link LeadService.pageSize} per page via `startAfter`
 * cursors, so the table stays bounded as the collection grows. Every filter change resets
 * to page 1 (`scheduleFirstPage`); the name search is additionally debounced. Because reads
 * are one-shot (not a live stream), every mutation below reloads the current page so the
 * table reflects the change.
 */
@Component({
  selector: 'app-leads-table',
  standalone: true,
  templateUrl: './leads-table.component.html',
})
export class LeadsTableComponent implements OnInit, OnDestroy {
  private leadService = inject(LeadService);
  private dialog = inject(DialogService);

  @Output() edit = new EventEmitter<Lead>();

  // Filters (table-only). Changing any of them resets pagination to page 1.
  readonly sourceFilter = signal<LeadSource | 'all'>('all');
  readonly statusFilter = signal<LeadStatus | 'all'>('all');
  /** Contact method, derived from source (quiz → call, rest → text) — never stored. */
  readonly methodFilter = signal<ContactMethod | 'all'>('all');
  readonly serviceFilter = signal<string | 'all'>('all');
  readonly promoFilter = signal<string | 'all'>('all');
  /** What's in the search box right now (undebounced — drives only the input + clear UI). */
  readonly searchInput = signal('');
  /** The debounced term the query actually runs with. */
  readonly searchTerm = signal('');
  /** Date-range bounds as `input[type=date]` strings ('' = unbounded). */
  readonly dateFrom = signal('');
  readonly dateTo = signal('');
  readonly expandedId = signal<string | null>(null);

  /** All filters bundled in the shape the service consumes. */
  readonly filters = computed<LeadTableFilters>(() => ({
    source: this.sourceFilter(),
    status: this.statusFilter(),
    method: this.methodFilter(),
    service: this.serviceFilter(),
    promo: this.promoFilter(),
    search: this.searchTerm(),
    createdFrom: parseDateInput(this.dateFrom(), 'start'),
    createdTo: parseDateInput(this.dateTo(), 'end'),
  }));

  readonly anyFilterActive = computed(() => {
    const f = this.filters();
    return (
      f.source !== 'all' ||
      f.status !== 'all' ||
      f.method !== 'all' ||
      f.service !== 'all' ||
      f.promo !== 'all' ||
      f.search.trim() !== '' ||
      f.createdFrom !== null ||
      f.createdTo !== null
    );
  });

  // Dropdown options harvested from the real data (the live stream the queue already
  // pays for), so front-desk staff pick exact existing values instead of typing.
  readonly serviceOptions = computed(() => distinct(this.leadService.leads(), (l) => l.serviceUsed));
  readonly promoOptions = computed(() => distinct(this.leadService.leads(), (l) => l.promoName));

  /**
   * Exact count of leads matching the COMBINED filters, for "X of Y leads". Computed
   * client-side over the live `leads` signal with the same predicate the page fetch uses,
   * so it can't drift from the rows shown — and costs no extra reads.
   */
  readonly matchedTotal = computed(() =>
    this.leadService.leads().filter((l) => matchesLeadFilters(l, this.filters())).length,
  );

  /** "1–20 of 34 leads" header line, degrading gracefully around empty pages. */
  readonly resultSummary = computed(() => {
    const total = this.matchedTotal();
    const shown = this.pageLeads().length;
    if (total === 0) return this.anyFilterActive() ? 'No leads match' : 'No leads yet';
    if (shown === 0) return `${total} lead${total === 1 ? '' : 's'}`;
    const start = this.pageIndex() * this.pageSize + 1;
    return `${start}–${start + shown - 1} of ${total} lead${total === 1 ? '' : 's'}`;
  });

  // --- Pagination state (Firestore cursor paging) -----------------------------

  /** The current page's leads (at most `pageSize`). */
  readonly pageLeads = signal<Lead[]>([]);
  /** 0-based index of the page currently shown. */
  readonly pageIndex = signal(0);
  /**
   * Tail cursor of each visited page: `pageCursors()[i]` is the last doc of page `i`, so
   * page `n` is fetched with `startAfter(pageCursors()[n - 1])`. Lets "Previous" re-run a
   * page without walking back from page 1.
   */
  readonly pageCursors = signal<QueryDocumentSnapshot<DocumentData>[]>([]);
  /** A page fetch is in flight — disables Prev/Next and actions to avoid racing the cursor stack. */
  readonly loading = signal(false);
  /** Current page came back full, so a next page may exist. */
  readonly hasNextPage = signal(false);

  readonly pageSize = this.leadService.pageSize;

  readonly sources = LEAD_SOURCES;
  readonly statuses = LEAD_STATUSES;
  readonly contactMethods = CONTACT_METHODS;
  readonly CONTACT_METHOD_LABEL = CONTACT_METHOD_LABEL;
  readonly SOURCE_LABEL = SOURCE_LABEL;
  readonly STATUS_PILL_CLASS = STATUS_PILL_CLASS;
  readonly TRIAL_TOUCHPOINT_ORDER = TRIAL_TOUCHPOINT_ORDER;
  readonly TRIAL_TOUCHPOINT_LABEL = TRIAL_TOUCHPOINT_LABEL;

  shortDate = shortDate;
  dateTime = dateTime;
  contactActionLabel = contactActionLabel;

  /** Pending debounce timer for the name search. */
  private searchDebounce: ReturnType<typeof setTimeout> | null = null;
  /** A filter changed while a load was in flight — run page 1 again when it finishes. */
  private firstPageQueued = false;

  ngOnInit(): void {
    void this.loadFirstPage();
  }

  ngOnDestroy(): void {
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
  }

  // --- Filters ------------------------------------------------------------------
  // Every change funnels through scheduleFirstPage so combined filters always restart
  // from page 1, and a change landing mid-load is queued instead of dropped.

  onSourceFilterChange(value: LeadSource | 'all'): void {
    this.sourceFilter.set(value);
    this.scheduleFirstPage();
  }

  onStatusFilterChange(value: LeadStatus | 'all'): void {
    this.statusFilter.set(value);
    this.scheduleFirstPage();
  }

  onMethodFilterChange(value: ContactMethod | 'all'): void {
    this.methodFilter.set(value);
    this.scheduleFirstPage();
  }

  onServiceFilterChange(value: string): void {
    this.serviceFilter.set(value);
    this.scheduleFirstPage();
  }

  onPromoFilterChange(value: string): void {
    this.promoFilter.set(value);
    this.scheduleFirstPage();
  }

  onDateFromChange(value: string): void {
    this.dateFrom.set(value);
    this.scheduleFirstPage();
  }

  onDateToChange(value: string): void {
    this.dateTo.set(value);
    this.scheduleFirstPage();
  }

  /** Search keystrokes update the box immediately but re-query only after a quiet pause. */
  onSearchInput(value: string): void {
    this.searchInput.set(value);
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => {
      this.searchDebounce = null;
      const term = value.trim();
      if (term === this.searchTerm()) return; // e.g. trailing whitespace — nothing changed
      this.searchTerm.set(term);
      this.scheduleFirstPage();
    }, SEARCH_DEBOUNCE_MS);
  }

  clearSearch(): void {
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    this.searchDebounce = null;
    this.searchInput.set('');
    if (this.searchTerm() === '') return;
    this.searchTerm.set('');
    this.scheduleFirstPage();
  }

  clearAllFilters(): void {
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    this.searchDebounce = null;
    this.searchInput.set('');
    this.searchTerm.set('');
    this.sourceFilter.set('all');
    this.statusFilter.set('all');
    this.methodFilter.set('all');
    this.serviceFilter.set('all');
    this.promoFilter.set('all');
    this.dateFrom.set('');
    this.dateTo.set('');
    this.scheduleFirstPage();
  }

  // --- Pagination -------------------------------------------------------------

  next(): void {
    if (this.hasNextPage() && !this.loading()) {
      void this.runLoading(() => this.fetchPage(this.pageIndex() + 1));
    }
  }

  previous(): void {
    if (this.pageIndex() > 0 && !this.loading()) {
      void this.runLoading(() => this.fetchPage(this.pageIndex() - 1));
    }
  }

  /**
   * Load page 1 with the CURRENT filter signals, or queue that load if one is already in
   * flight (`runLoading` would otherwise silently drop it — fatal for the debounced search,
   * which fires without a disabled control guarding it).
   */
  private scheduleFirstPage(): void {
    if (this.loading()) {
      this.firstPageQueued = true;
      return;
    }
    void this.loadFirstPage();
  }

  /** Reset the cursor stack and load page 1 (initial load + on every filter change). */
  private loadFirstPage(): Promise<void> {
    return this.runLoading(() => this.fetchFirstPage());
  }

  /** The un-wrapped page-1 fetch — also run for queued filter changes inside `runLoading`. */
  private fetchFirstPage(): Promise<void> {
    this.expandedId.set(null);
    this.pageCursors.set([]);
    return this.fetchPage(0);
  }

  /** Re-run the current page (after a mutation) so the one-shot table reflects the change. */
  private reloadCurrentPage(): Promise<void> {
    return this.fetchPage(this.pageIndex());
  }

  // --- External refresh (driven by the shared Add/Edit modal via the dashboard) ---------

  /**
   * An edit landed elsewhere: re-fetch the page currently shown so the changed row updates
   * in place. The lead keeps its position (edits don't reorder), so we stay on this page.
   */
  refreshAfterEdit(): Promise<void> {
    return this.runLoading(() => this.reloadCurrentPage());
  }

  /**
   * A new lead was added: it's the newest, so jump to page 1 where it will appear at the top
   * (rather than reloading a later page that wouldn't show it).
   */
  refreshAfterAdd(): Promise<void> {
    return this.loadFirstPage();
  }

  /**
   * Fetch `targetIndex` and apply it to state. Uses `pageCursors()[targetIndex - 1]` as the
   * `startAfter` cursor (none for page 0), records this page's tail cursor, and drops any
   * now-stale forward cursors. Does NOT toggle `loading` — callers wrap it in `runLoading`.
   */
  private async fetchPage(targetIndex: number): Promise<void> {
    const cursors = this.pageCursors();
    const startAfterDoc: LeadCursor | null =
      targetIndex === 0 ? null : cursors[targetIndex - 1] ?? null;

    const { leads, lastDoc, hasMore } = await this.leadService.fetchLeadsPage({
      ...this.filters(),
      startAfterDoc,
    });

    // Guard against paging into an empty page when the previous page was exactly full.
    if (leads.length === 0 && targetIndex > 0) {
      this.hasNextPage.set(false);
      return;
    }

    this.pageLeads.set(leads);
    this.pageIndex.set(targetIndex);
    this.hasNextPage.set(hasMore);

    const nextCursors = cursors.slice(0, targetIndex);
    if (lastDoc) nextCursors[targetIndex] = lastDoc;
    this.pageCursors.set(nextCursors);
  }

  /** Run an async unit of work with the shared loading guard (ignores re-entry while busy). */
  private async runLoading(work: () => Promise<void>): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);
    try {
      await work();
      // Filter changes that landed mid-work queued a page-1 reload — honour them now,
      // still inside the guard, always with the latest filter signals.
      while (this.firstPageQueued) {
        this.firstPageQueued = false;
        await this.fetchFirstPage();
      }
    } finally {
      this.loading.set(false);
    }
  }

  toggleExpand(lead: Lead): void {
    this.expandedId.update((id) => (id === lead.id ? null : lead.id));
  }

  // --- pipeline actions -------------------------------------------------------
  // Each mutates then reloads the current page (one-shot reads don't self-update).

  /** Advance one step from New or Contacted. (Responded splits into Convert / Lost.) */
  advance(lead: Lead): void {
    if (lead.status !== 'New' && lead.status !== 'Contacted') return;
    void this.runLoading(async () => {
      if (lead.status === 'New') await this.leadService.markContacted(lead);
      else await this.leadService.markResponded(lead);
      await this.reloadCurrentPage();
    });
  }

  async convert(lead: Lead): Promise<void> {
    // Capture the source-specific outcome; it's stored on the lead and stays queryable.
    const outcome = await this.dialog.prompt({
      title: 'Record conversion',
      message: `What was the outcome for ${lead.name}?`,
      defaultValue: CONVERSION_PROMPT[lead.source],
      confirmLabel: 'Save outcome',
    });
    if (outcome === null) return; // cancelled
    void this.runLoading(async () => {
      await this.leadService.markConverted(lead, outcome || CONVERSION_PROMPT[lead.source]);
      await this.reloadCurrentPage();
    });
  }

  async markLost(lead: Lead): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'Mark as Lost',
      message: `Mark ${lead.name} as Lost? This is manual and can be changed later.`,
      confirmLabel: 'Mark as Lost',
      cancelLabel: 'Cancel',
      variant: 'destructive',
    });
    if (!confirmed) return;
    void this.runLoading(async () => {
      await this.leadService.markLost(lead);
      await this.reloadCurrentPage();
    });
  }

  markTouchpoint(lead: Lead, key: TrialTouchpointKey): void {
    void this.runLoading(async () => {
      await this.leadService.markTouchpoint(lead, key);
      await this.reloadCurrentPage();
    });
  }

  /** Label for the single advance button at New/Contacted. */
  advanceLabel(lead: Lead): string {
    if (lead.status === 'New') return contactActionLabel(lead.contactMethod);
    if (lead.status === 'Contacted') return 'Mark responded';
    return '';
  }
}

/** Quiet-typing pause before the name search re-queries. */
const SEARCH_DEBOUNCE_MS = 300;

/** Sorted distinct non-empty values of one lead field — dropdown options from real data. */
function distinct(leads: Lead[], pick: (l: Lead) => string | null | undefined): string[] {
  const values = new Set<string>();
  for (const lead of leads) {
    const v = pick(lead);
    if (v) values.add(v);
  }
  return [...values].sort((a, b) => a.localeCompare(b));
}

/**
 * An `input[type=date]` value ('YYYY-MM-DD') as a LOCAL Date at the start or end of that
 * day, so a single-day range still catches the whole day. '' (cleared) → null (unbounded).
 */
function parseDateInput(value: string, edge: 'start' | 'end'): Date | null {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return null;
  return edge === 'start' ? new Date(y, m - 1, d) : new Date(y, m - 1, d, 23, 59, 59, 999);
}
