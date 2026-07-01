import { Component, ViewChild, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { FollowUpQueueComponent } from '../queue/follow-up-queue.component';
import { LeadsTableComponent } from '../leads-table/leads-table.component';
import { LeadModalComponent } from '../lead-modal/lead-modal.component';
import { Lead } from '../../models/lead.model';
import { AuthService } from '../../services/auth.service';
import { environment } from '../../../environments/environment';

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
  private auth = inject(AuthService);
  private router = inject(Router);

  /**
   * The one-shot paginated table. The live queue self-updates from Firestore, but the table
   * reads pages once, so it must be told to reload after a save made through the modal.
   */
  @ViewChild(LeadsTableComponent) private table?: LeadsTableComponent;

  /** Only show the signed-in user / sign-out control when auth is actually enforced. */
  readonly requireAuth = environment.requireAuth;
  readonly userName = this.auth.currentUserName;

  readonly modalOpen = signal(false);
  readonly editingLead = signal<Lead | null>(null);

  async logout(): Promise<void> {
    await this.auth.logout();
    await this.router.navigate(['/login']);
  }

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

  /**
   * A save landed in the modal. The queue reacts to Firestore live; the paginated table
   * doesn't, so refresh it here — jump to page 1 for a new lead, reload in place for an edit.
   */
  onLeadSaved(created: boolean): void {
    if (created) void this.table?.refreshAfterAdd();
    else void this.table?.refreshAfterEdit();
  }
}
