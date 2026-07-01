import { Component, EventEmitter, OnInit, Output, inject, signal } from '@angular/core';
import { DocumentData, QueryDocumentSnapshot } from '@angular/fire/firestore';

import { LeadCursor, LeadService } from '../../services/lead.service';
import { DialogService } from '../../shared/dialog/dialog.service';
import { Lead, LeadSource, LeadStatus } from '../../models/lead.model';
import {
  CONVERSION_PROMPT,
  LEAD_SOURCES,
  LEAD_STATUSES,
  SOURCE_LABEL,
  STATUS_COLOR,
  TRIAL_TOUCHPOINT_LABEL,
  TRIAL_TOUCHPOINT_ORDER,
  TrialTouchpointKey,
  contactActionLabel,
} from '../../models/lead.constants';
import { dateTime, shortDate } from '../../shared/format.util';

/**
 * All-leads table. Filterable by source + status (filters affect the table only, never
 * the queue). Inline action advances the pipeline; at "Responded" the user chooses
 * Convert or Lost (both terminal). Trial rows expand to show + mark the three check-ins.
 *
 * Paginated Firestore-side at {@link LeadService.pageSize} per page: filters run as `where`
 * clauses in the query and paging uses `startAfter` cursors, so the table stays bounded as
 * the collection grows. Because reads are one-shot (not a live stream), every mutation below
 * reloads the current page so the table reflects the change.
 */
@Component({
  selector: 'app-leads-table',
  standalone: true,
  templateUrl: './leads-table.component.html',
})
export class LeadsTableComponent implements OnInit {
  private leadService = inject(LeadService);
  private dialog = inject(DialogService);

  @Output() edit = new EventEmitter<Lead>();

  // Filters (table-only). Changing either resets pagination to page 1.
  readonly sourceFilter = signal<LeadSource | 'all'>('all');
  readonly statusFilter = signal<LeadStatus | 'all'>('all');
  readonly expandedId = signal<string | null>(null);

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
  readonly SOURCE_LABEL = SOURCE_LABEL;
  readonly STATUS_COLOR = STATUS_COLOR;
  readonly TRIAL_TOUCHPOINT_ORDER = TRIAL_TOUCHPOINT_ORDER;
  readonly TRIAL_TOUCHPOINT_LABEL = TRIAL_TOUCHPOINT_LABEL;

  shortDate = shortDate;
  dateTime = dateTime;
  contactActionLabel = contactActionLabel;

  ngOnInit(): void {
    void this.loadFirstPage();
  }

  // --- Pagination -------------------------------------------------------------

  onSourceFilterChange(value: LeadSource | 'all'): void {
    this.sourceFilter.set(value);
    void this.loadFirstPage();
  }

  onStatusFilterChange(value: LeadStatus | 'all'): void {
    this.statusFilter.set(value);
    void this.loadFirstPage();
  }

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

  /** Reset the cursor stack and load page 1 (initial load + on every filter change). */
  private loadFirstPage(): Promise<void> {
    this.expandedId.set(null);
    this.pageCursors.set([]);
    return this.runLoading(() => this.fetchPage(0));
  }

  /** Re-run the current page (after a mutation) so the one-shot table reflects the change. */
  private reloadCurrentPage(): Promise<void> {
    return this.fetchPage(this.pageIndex());
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

    const { leads, lastDoc } = await this.leadService.fetchLeadsPage({
      source: this.sourceFilter(),
      status: this.statusFilter(),
      startAfterDoc,
    });

    // Guard against paging into an empty page when the previous page was exactly full.
    if (leads.length === 0 && targetIndex > 0) {
      this.hasNextPage.set(false);
      return;
    }

    this.pageLeads.set(leads);
    this.pageIndex.set(targetIndex);
    this.hasNextPage.set(leads.length === this.pageSize);

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
