import { Component, EventEmitter, Output, inject } from '@angular/core';

import { LeadService } from '../../services/lead.service';
import { Lead } from '../../models/lead.model';
import {
  SOURCE_LABEL,
  TRIAL_TOUCHPOINT_LABEL,
  TRIAL_TOUCHPOINT_ORDER,
  contactActionLabel,
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

  readonly queue = this.leadService.followUpQueue;
  readonly SOURCE_LABEL = SOURCE_LABEL;

  relative = relative;
  contactActionLabel = contactActionLabel;

  markContacted(lead: Lead): void {
    void this.leadService.markContacted(lead);
  }

  /** Next outstanding trial check-in label, for the trial cards. */
  nextTouchpoint(lead: Lead): string | null {
    if (lead.source !== 'trial' || !lead.touchpoints) return null;
    const next = TRIAL_TOUCHPOINT_ORDER.find((k) => !lead.touchpoints![k].done);
    return next ? TRIAL_TOUCHPOINT_LABEL[next] : 'All check-ins done';
  }
}
