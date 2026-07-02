import { Component, EventEmitter, Output, computed, inject, signal } from '@angular/core';

import { LeadService } from '../../services/lead.service';
import { ContactMethod, Lead, LeadSource } from '../../models/lead.model';
import {
  CONTACT_METHODS,
  CONTACT_METHOD_LABEL,
  LEAD_SOURCES,
  SOURCE_LABEL,
  TRIAL_TOUCHPOINT_ACTION_LABEL,
  TRIAL_TOUCHPOINT_LABEL,
  TRIAL_TOUCHPOINT_ORDER,
  TrialTouchpointKey,
  contactActionLabel,
  defaultContactMethod,
} from '../../models/lead.constants';
import { relative } from '../../shared/format.util';

/**
 * "To contact today" queue: every lead still at status New, oldest entered first.
 * One-click advance whose label matches the contact method (texted vs called).
 * Reads straight from LeadService signals — no inputs needed.
 */
@Component({
  selector: 'app-follow-up-queue',
  standalone: true,
  templateUrl: './follow-up-queue.component.html',
})
export class FollowUpQueueComponent {
  private leadService = inject(LeadService);

  /** Bubble up so the dashboard can open the shared edit modal. */
  @Output() edit = new EventEmitter<Lead>();

  // Queue-only filters — independent of the All-leads table's filter state.
  readonly sourceFilter = signal<LeadSource | 'all'>('all');
  /** Contact method, derived from source (quiz → call, rest → text) — never stored. */
  readonly methodFilter = signal<ContactMethod | 'all'>('all');

  readonly anyFilterActive = computed(
    () => this.sourceFilter() !== 'all' || this.methodFilter() !== 'all',
  );

  /** The service's queue narrowed by the local filters; drives the cards AND the badge. */
  readonly queue = computed(() =>
    this.leadService.followUpQueue().filter((lead) => {
      if (this.sourceFilter() !== 'all' && lead.source !== this.sourceFilter()) return false;
      const method = this.methodFilter();
      return method === 'all' || defaultContactMethod(lead.source) === method;
    }),
  );

  readonly sources = LEAD_SOURCES;
  readonly contactMethods = CONTACT_METHODS;
  readonly SOURCE_LABEL = SOURCE_LABEL;
  readonly CONTACT_METHOD_LABEL = CONTACT_METHOD_LABEL;

  relative = relative;
  contactActionLabel = contactActionLabel;

  markContacted(lead: Lead): void {
    void this.leadService.markContacted(lead);
  }

  /** Mark the trial's next outstanding check-in done (the queue action for trial cards). */
  markTouchpoint(lead: Lead): void {
    const key = this.nextTouchpointKey(lead);
    if (key) void this.leadService.markTouchpoint(lead, key);
  }

  /** The next outstanding trial touchpoint key, or null if trial's done / not a trial. */
  nextTouchpointKey(lead: Lead): TrialTouchpointKey | null {
    if (lead.source !== 'trial') return null;
    const tp = lead.touchpoints;
    return TRIAL_TOUCHPOINT_ORDER.find((k) => !tp || !tp[k].done) ?? null;
  }

  /** Next outstanding trial check-in label, for the "Next:" line on trial cards. */
  nextTouchpoint(lead: Lead): string | null {
    if (lead.source !== 'trial') return null;
    const key = this.nextTouchpointKey(lead);
    return key ? TRIAL_TOUCHPOINT_LABEL[key] : 'All check-ins done';
  }

  /** Button label naming the specific touchpoint the trial action will mark done. */
  touchpointActionLabel(lead: Lead): string | null {
    const key = this.nextTouchpointKey(lead);
    return key ? TRIAL_TOUCHPOINT_ACTION_LABEL[key] : null;
  }
}
