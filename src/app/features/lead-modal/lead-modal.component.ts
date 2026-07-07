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

  /**
   * Opening in ADD mode always starts from a blank draft: after a previous add, `lead`
   * stays null so its setter never re-fires — without this reset the last entry's values
   * (and source) would carry over into the next open.
   */
  @Input() set open(value: boolean) {
    if (value && !this._open && !this.editing) this.resetDraft();
    this._open = value;
  }
  get open(): boolean {
    return this._open;
  }
  private _open = false;

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

  /**
   * The trial end date auto-follows "start + 7 days" until the user edits it by hand —
   * after that, start-date changes leave it alone. Recomputed on load for edits: an end
   * date that still equals the derived default keeps auto-following.
   */
  private trialEndTouched = false;

  @Input() set lead(value: Lead | null) {
    this.editing = value;
    if (value) {
      this.draft = toDraft(value);
      this.trialEndTouched =
        this.draft.trialEndDate !== plusDays(this.draft.trialStartDate, TRIAL_LENGTH_DAYS);
    } else {
      this.resetDraft();
    }
  }

  private resetDraft(): void {
    this.draft = blankDraft();
    this.trialEndTouched = false;
  }

  /** Start date changed → keep the end date tracking start + 7 unless it was hand-edited. */
  onTrialStartChange(value: string): void {
    this.draft.trialStartDate = value;
    if (!this.trialEndTouched) {
      this.draft.trialEndDate = plusDays(value, TRIAL_LENGTH_DAYS);
    }
  }

  onTrialEndChange(value: string): void {
    this.draft.trialEndDate = value;
    this.trialEndTouched = true;
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
    if (this.draft.name.trim().length === 0 || this.draft.phone.trim().length === 0) {
      return false;
    }
    // The trial start date is Day 1 of the check-in schedule — required for trials.
    if (this.draft.source === 'trial' && !this.draft.trialStartDate) return false;
    return true;
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
    // Mirror the form's per-source field visibility so hidden fields aren't persisted stale:
    // every source captures an email; quiz/promo/$99-deals capture no service used.
    const usesService = this.draft.source === 'new' || this.draft.source === 'trial';
    return {
      name: this.draft.name.trim(),
      phone: this.draft.phone.trim(),
      email: this.draft.email.trim() || null,
      serviceUsed: usesService ? this.draft.serviceUsed.trim() || null : null,
      notes: this.draft.notes.trim() || null,
    };
  }

  /** Source-specific fields ONLY. Excludes touchpoints so editing never wipes them. */
  private sourcePatch(): Partial<Lead> {
    switch (this.draft.source) {
      case 'new':
        return {
          leadDate: parseDate(this.draft.leadDate),
        };
      case 'trial':
        return {
          trialStartDate: parseDate(this.draft.trialStartDate),
          trialEndDate: parseDate(this.draft.trialEndDate),
          experienceNotes: this.draft.experienceNotes.trim() || null,
          // Legacy free-text stage/day — nulled on save so old docs converge on the dates.
          trialStage: null,
          trialDay: null,
        };
      case 'promo':
        return {
          promoName: this.draft.promoName.trim() || null,
          purchaseDate: parseDate(this.draft.purchaseDate),
        };
      case 'deal99':
        return {
          dealName: this.draft.dealName.trim() || null,
          dealPurchaseDate: parseDate(this.draft.dealPurchaseDate),
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

/** How long the trial runs: the end date defaults to start + 7 days. */
const TRIAL_LENGTH_DAYS = 7;

interface DraftForm {
  source: LeadSource;
  name: string;
  phone: string;
  email: string;
  serviceUsed: string;
  notes: string;
  leadDate: string; // YYYY-MM-DD
  trialStartDate: string; // YYYY-MM-DD
  trialEndDate: string; // YYYY-MM-DD
  experienceNotes: string;
  promoName: string;
  purchaseDate: string; // YYYY-MM-DD
  dealName: string;
  dealPurchaseDate: string; // YYYY-MM-DD
}

function blankDraft(): DraftForm {
  // Dates default to today: leadDate is the business date staff may backdate, and the
  // trial pair starts as today → today + 7 (most trials are entered on their first day).
  const today = todayInputValue();
  return {
    source: 'new',
    name: '',
    phone: '',
    email: '',
    serviceUsed: '',
    notes: '',
    leadDate: today,
    trialStartDate: today,
    trialEndDate: plusDays(today, TRIAL_LENGTH_DAYS),
    experienceNotes: '',
    promoName: '',
    purchaseDate: '',
    dealName: '',
    dealPurchaseDate: '',
  };
}

function toDraft(l: Lead): DraftForm {
  // Older docs predate leadDate/trialStartDate — surface the fallback the app already
  // uses (createdAt) so saving an edit backfills it explicitly.
  const trialStart = dateInputValue(l.trialStartDate ?? l.createdAt ?? null);
  return {
    source: l.source,
    name: l.name,
    phone: l.phone,
    email: l.email ?? '',
    serviceUsed: l.serviceUsed ?? '',
    notes: l.notes ?? '',
    leadDate: dateInputValue(l.leadDate ?? l.createdAt ?? null),
    trialStartDate: trialStart,
    trialEndDate: dateInputValue(l.trialEndDate ?? null) || plusDays(trialStart, TRIAL_LENGTH_DAYS),
    experienceNotes: l.experienceNotes ?? '',
    promoName: l.promoName ?? '',
    purchaseDate: dateInputValue(l.purchaseDate ?? null),
    dealName: l.dealName ?? '',
    dealPurchaseDate: dateInputValue(l.dealPurchaseDate ?? null),
  };
}

function dateInputValue(ts: Timestamp | null): string {
  if (!ts) return '';
  return toInputValue(ts.toDate());
}

function toInputValue(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function todayInputValue(): string {
  return toInputValue(new Date());
}

/** 'YYYY-MM-DD' + n days → 'YYYY-MM-DD' (local calendar math). '' stays ''. */
function plusDays(value: string, days: number): string {
  if (!value) return '';
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return '';
  return toInputValue(new Date(y, m - 1, d + days));
}

function parseDate(value: string): Timestamp | null {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00`);
  return isNaN(d.getTime()) ? null : Timestamp.fromDate(d);
}
