import { Component, inject, signal } from '@angular/core';
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
}
