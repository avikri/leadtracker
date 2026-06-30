import { Component, EventEmitter, Output, computed, inject, signal } from '@angular/core';

import { LeadService } from '../../services/lead.service';
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
 */
@Component({
  selector: 'app-leads-table',
  standalone: true,
  templateUrl: './leads-table.component.html',
})
export class LeadsTableComponent {
  private leadService = inject(LeadService);

  @Output() edit = new EventEmitter<Lead>();

  // Filters (table-only)
  readonly sourceFilter = signal<LeadSource | 'all'>('all');
  readonly statusFilter = signal<LeadStatus | 'all'>('all');
  readonly expandedId = signal<string | null>(null);

  readonly sources = LEAD_SOURCES;
  readonly statuses = LEAD_STATUSES;
  readonly SOURCE_LABEL = SOURCE_LABEL;
  readonly STATUS_COLOR = STATUS_COLOR;
  readonly TRIAL_TOUCHPOINT_ORDER = TRIAL_TOUCHPOINT_ORDER;
  readonly TRIAL_TOUCHPOINT_LABEL = TRIAL_TOUCHPOINT_LABEL;

  shortDate = shortDate;
  dateTime = dateTime;
  contactActionLabel = contactActionLabel;

  readonly filtered = computed(() => {
    const src = this.sourceFilter();
    const status = this.statusFilter();
    return this.leadService.leads().filter(
      (l) => (src === 'all' || l.source === src) && (status === 'all' || l.status === status),
    );
  });

  toggleExpand(lead: Lead): void {
    this.expandedId.update((id) => (id === lead.id ? null : lead.id));
  }

  // --- pipeline actions -------------------------------------------------------

  /** Advance one step from New or Contacted. (Responded splits into Convert / Lost.) */
  advance(lead: Lead): void {
    if (lead.status === 'New') void this.leadService.markContacted(lead);
    else if (lead.status === 'Contacted') void this.leadService.markResponded(lead);
  }

  convert(lead: Lead): void {
    // Baseline: quick prompt for the source-specific outcome. Replace with a small
    // dialog later — the outcome is stored on the lead and stays queryable.
    const outcome = window.prompt('Conversion outcome:', CONVERSION_PROMPT[lead.source]);
    if (outcome === null) return; // cancelled
    void this.leadService.markConverted(lead, outcome || CONVERSION_PROMPT[lead.source]);
  }

  markLost(lead: Lead): void {
    if (window.confirm(`Mark ${lead.name} as Lost? This is manual and can be changed later.`)) {
      void this.leadService.markLost(lead);
    }
  }

  markTouchpoint(lead: Lead, key: TrialTouchpointKey): void {
    void this.leadService.markTouchpoint(lead, key);
  }

  /** Label for the single advance button at New/Contacted. */
  advanceLabel(lead: Lead): string {
    if (lead.status === 'New') return contactActionLabel(lead.contactMethod);
    if (lead.status === 'Contacted') return 'Mark responded';
    return '';
  }
}
