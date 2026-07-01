import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Timestamp } from '@angular/fire/firestore';

import { LeadService } from '../../services/lead.service';
import { Lead, LeadDraft, LeadSource } from '../../models/lead.model';
import {
  CONVERSION_PROMPT,
  LEAD_SOURCES,
  SOURCE_GOAL,
  SOURCE_LABEL,
  contactVerbPast,
  defaultContactMethod,
} from '../../models/lead.constants';

/**
 * Add / Edit lead modal. One form, reused for both.
 *
 * - Source selector is FIRST and swaps the visible field set.
 * - Changing source on an existing lead is a first-class action: shared fields are kept,
 *   the conditional set is swapped (LeadService.changeSource nulls stale fields), and the
 *   contact method (text/call) is recomputed.
 * - New leads always enter at status 'New'.
 *
 * Template-driven forms keep the dynamic field set simple to read. Swap to reactive forms
 * if/when validation grows.
 */
@Component({
  selector: 'app-lead-modal',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './lead-modal.component.html',
})
export class LeadModalComponent {
  private leadService = inject(LeadService);

  readonly sources = LEAD_SOURCES;
  readonly SOURCE_LABEL = SOURCE_LABEL;
  readonly SOURCE_GOAL = SOURCE_GOAL;

  @Input() open = false;
  @Output() closed = new EventEmitter<void>();
  /**
   * Fired after a successful write, carrying `created` (true = new lead, false = edit).
   * The dashboard uses it to refresh the one-shot paginated table, which — unlike the live
   * queue — won't otherwise reflect the change until a page reload.
   */
  @Output() saved = new EventEmitter<boolean>();

  /** The lead being edited, or null to add a new one. */
  private editing: Lead | null = null;
  saving = false;

  /** Working copy bound to the form. Strings for inputs; converted on save. */
  draft = blankDraft();

  @Input() set lead(value: Lead | null) {
    this.editing = value;
    this.draft = value ? toDraft(value) : blankDraft();
  }

  get isEdit(): boolean {
    return this.editing !== null;
  }

  get contactMethodNote(): string {
    const method = defaultContactMethod(this.draft.source);
    return `${SOURCE_LABEL[this.draft.source]} leads are ${
      method === 'call' ? 'phoned' : 'texted'
    } — this lead will be set to "${method}".`;
  }

  get conversionHint(): string {
    return CONVERSION_PROMPT[this.draft.source];
  }

  cancel(): void {
    this.closed.emit();
  }

  /** Backdrop click closes; clicks inside the panel are stopped in the template. */
  onBackdrop(): void {
    this.cancel();
  }

  canSave(): boolean {
    return this.draft.name.trim().length > 0 && this.draft.phone.trim().length > 0;
  }

  async save(): Promise<void> {
    if (!this.canSave() || this.saving) return;
    this.saving = true;
    try {
      let created: boolean;
      if (this.isEdit && this.editing) {
        created = false;
        const id = this.editing.id;
        // First-class source change: lets the service swap the conditional field set.
        if (this.draft.source !== this.editing.source) {
          await this.leadService.changeSource(id, this.editing, this.draft.source);
        }
        await this.leadService.updateLead(id, {
          source: this.draft.source,
          contactMethod: defaultContactMethod(this.draft.source),
          ...this.sharedPatch(),
          ...this.sourcePatch(),
        });
      } else {
        created = true;
        await this.leadService.createLead(this.toCreateDraft());
      }
      // Signal the write landed BEFORE closing, so the table reloads off fresh Firestore data.
      this.saved.emit(created);
      this.closed.emit();
    } finally {
      this.saving = false;
    }
  }

  // --- field set builders -----------------------------------------------------

  private sharedPatch(): Partial<Lead> {
    return {
      name: this.draft.name.trim(),
      phone: this.draft.phone.trim(),
      email: this.draft.email.trim() || null,
      serviceUsed: this.draft.serviceUsed.trim() || null,
      notes: this.draft.notes.trim() || null,
    };
  }

  /** Source-specific fields ONLY. Excludes touchpoints so editing never wipes them. */
  private sourcePatch(): Partial<Lead> {
    switch (this.draft.source) {
      case 'trial':
        return {
          trialStage: this.draft.trialStage.trim() || null,
          trialDay: this.draft.trialDay === '' ? null : Number(this.draft.trialDay),
          experienceNotes: this.draft.experienceNotes.trim() || null,
        };
      case 'promo':
        return {
          promoName: this.draft.promoName.trim() || null,
          purchaseDate: parseDate(this.draft.purchaseDate),
        };
      default:
        return {};
    }
  }

  private toCreateDraft(): LeadDraft {
    const shared = this.sharedPatch();
    return {
      source: this.draft.source,
      name: shared.name!,
      phone: shared.phone!,
      email: shared.email ?? null,
      serviceUsed: shared.serviceUsed ?? null,
      notes: shared.notes ?? null,
      ...this.sourcePatch(),
    };
  }

  protected readonly contactVerbPast = contactVerbPast;
}

// --- draft <-> lead mapping ---------------------------------------------------

interface DraftForm {
  source: LeadSource;
  name: string;
  phone: string;
  email: string;
  serviceUsed: string;
  notes: string;
  trialStage: string;
  trialDay: string;
  experienceNotes: string;
  promoName: string;
  purchaseDate: string; // YYYY-MM-DD
}

function blankDraft(): DraftForm {
  return {
    source: 'new',
    name: '',
    phone: '',
    email: '',
    serviceUsed: '',
    notes: '',
    trialStage: '',
    trialDay: '',
    experienceNotes: '',
    promoName: '',
    purchaseDate: '',
  };
}

function toDraft(l: Lead): DraftForm {
  return {
    source: l.source,
    name: l.name,
    phone: l.phone,
    email: l.email ?? '',
    serviceUsed: l.serviceUsed ?? '',
    notes: l.notes ?? '',
    trialStage: l.trialStage ?? '',
    trialDay: l.trialDay != null ? String(l.trialDay) : '',
    experienceNotes: l.experienceNotes ?? '',
    promoName: l.promoName ?? '',
    purchaseDate: dateInputValue(l.purchaseDate ?? null),
  };
}

function dateInputValue(ts: Timestamp | null): string {
  if (!ts) return '';
  const d = ts.toDate();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function parseDate(value: string): Timestamp | null {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00`);
  return isNaN(d.getTime()) ? null : Timestamp.fromDate(d);
}
