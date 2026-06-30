import { Component, signal } from '@angular/core';

import { FollowUpQueueComponent } from '../queue/follow-up-queue.component';
import { LeadsTableComponent } from '../leads-table/leads-table.component';
import { LeadModalComponent } from '../lead-modal/lead-modal.component';
import { Lead } from '../../models/lead.model';

/**
 * Dashboard: the single screen front-desk staff work from.
 * Owns the shared Add/Edit modal; the queue and table read their data from LeadService.
 */
@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [FollowUpQueueComponent, LeadsTableComponent, LeadModalComponent],
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent {
  readonly modalOpen = signal(false);
  readonly editingLead = signal<Lead | null>(null);

  openAdd(): void {
    this.editingLead.set(null);
    this.modalOpen.set(true);
  }

  openEdit(lead: Lead): void {
    this.editingLead.set(lead);
    this.modalOpen.set(true);
  }

  closeModal(): void {
    this.modalOpen.set(false);
    this.editingLead.set(null);
  }
}
