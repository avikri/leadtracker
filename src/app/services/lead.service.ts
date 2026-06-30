import { Injectable, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  DocumentData,
  Firestore,
  Timestamp,
  UpdateData,
  addDoc,
  collection,
  collectionData,
  doc,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from '@angular/fire/firestore';

import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';
import { Lead, LeadDraft, LeadSource, TrialTouchpoints } from '../models/lead.model';
import { TrialTouchpointKey, defaultContactMethod } from '../models/lead.constants';

/**
 * The ONLY place the app talks to Firestore for leads. Components read the reactive
 * signals exposed here and call the mutation methods — they never import Firestore.
 *
 * This is the seam Claude Code will extend. Notable extension points:
 *  - `createLead()` is the single ingestion entry point. The Phase 2 Mindbody / ScoreApp
 *    importer should call this same method (see "TODO: Phase 2 ingestion").
 *  - All reads/writes are scoped to `locationId` so this can become multi-studio with no
 *    schema retrofit.
 *  - Leads are never deleted; every transition is timestamped for later trend reporting.
 */
@Injectable({ providedIn: 'root' })
export class LeadService {
  private firestore = inject(Firestore);
  private auth = inject(AuthService);

  private readonly leadsCollection = collection(this.firestore, 'leads');

  /**
   * Active tenant. Hard-coded to the single live studio for now and kept out of the UI.
   * When this becomes multi-studio, derive it from the signed-in user instead.
   */
  readonly locationId = environment.defaultLocationId;

  // --- Reactive reads ---------------------------------------------------------

  /** Live stream of this location's leads, newest entered first. */
  readonly leads = toSignal(
    collectionData(
      query(
        this.leadsCollection,
        where('locationId', '==', this.locationId),
        orderBy('createdAt', 'desc'),
      ),
      { idField: 'id' },
    ) as unknown as import('rxjs').Observable<Lead[]>,
    { initialValue: [] as Lead[] },
  );

  /**
   * Today's follow-up queue: every lead still at status 'New', OLDEST entered first
   * (front desk works the backlog top-down).
   */
  readonly followUpQueue = computed(() =>
    this.leads()
      .filter((l) => l.status === 'New')
      .sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis()),
  );

  // --- Create -----------------------------------------------------------------

  /**
   * Single ingestion entry point. Stamps audit fields, status='New', source-correct
   * contactMethod, and (for trials) the empty touchpoint scaffold.
   *
   * TODO: Phase 2 ingestion — the Mindbody (new clients & trials) and ScoreApp (quiz)
   * importers should call this exact method so manual + automatic leads stay identical.
   */
  async createLead(draft: LeadDraft): Promise<string> {
    const now = serverTimestamp();
    const base: Record<string, unknown> = {
      locationId: this.locationId,
      source: draft.source,
      name: draft.name.trim(),
      phone: draft.phone.trim(),
      email: draft.email?.trim() || null,
      serviceUsed: draft.serviceUsed?.trim() || null,
      notes: draft.notes?.trim() || null,

      status: 'New',
      contactMethod: defaultContactMethod(draft.source),

      createdAt: now,
      enteredBy: this.auth.currentUserName(),
      contactedAt: null,
      contactedBy: null,
      lastContactAt: null,
      respondedAt: null,
      convertedAt: null,
      conversionOutcome: null,
      lostAt: null,

      ...this.sourceFields(draft.source, draft),
    };

    const ref = await addDoc(this.leadsCollection, base);
    return ref.id;
  }

  // --- Edit -------------------------------------------------------------------

  /** Patch arbitrary shared/source fields. Audit + status flow go through the methods below. */
  async updateLead(id: string, patch: Partial<Lead>): Promise<void> {
    await updateDoc(this.docRef(id), patch as unknown as UpdateData<DocumentData>);
  }

  /**
   * Changing the source is a first-class action. Shared fields (name, phone, email,
   * status, audit) are preserved; the conditional field set is swapped and contactMethod
   * is recomputed. Fields the new source doesn't use are nulled rather than left stale.
   */
  async changeSource(id: string, current: Lead, newSource: LeadSource): Promise<void> {
    if (current.source === newSource) return;

    const cleared = {
      trialStage: null,
      trialDay: null,
      experienceNotes: null,
      touchpoints: null,
      promoName: null,
      purchaseDate: null,
    };

    await updateDoc(this.docRef(id), {
      source: newSource,
      contactMethod: defaultContactMethod(newSource),
      ...cleared,
      // Re-apply the new source's fields, carrying over anything still relevant.
      ...this.sourceFields(newSource, current),
    } as unknown as UpdateData<DocumentData>);
  }

  // --- Status flow ------------------------------------------------------------
  // New → Contacted → Responded → (Converted | Lost). Every step is timestamped.

  /** Mark the lead contacted (texted/called per its contactMethod). */
  async markContacted(lead: Lead): Promise<void> {
    const now = serverTimestamp();
    await updateDoc(this.docRef(lead.id), {
      status: 'Contacted',
      contactedAt: lead.contactedAt ?? now, // keep first-contact time if already set
      contactedBy: lead.contactedBy ?? this.auth.currentUserName(),
      lastContactAt: now,
    });
  }

  /** The lead replied. */
  async markResponded(lead: Lead): Promise<void> {
    await updateDoc(this.docRef(lead.id), {
      status: 'Responded',
      respondedAt: serverTimestamp(),
      lastContactAt: serverTimestamp(),
    });
  }

  /**
   * Terminal: converted. `conversionOutcome` records what that meant for this source
   * (returned / bought membership / booked a visit / bought a pack) so it stays queryable.
   */
  async markConverted(lead: Lead, conversionOutcome: string): Promise<void> {
    await updateDoc(this.docRef(lead.id), {
      status: 'Converted',
      convertedAt: serverTimestamp(),
      conversionOutcome: conversionOutcome.trim() || null,
    });
  }

  /** Terminal: lost. MANUAL only — nothing in the app writes this off automatically. */
  async markLost(lead: Lead): Promise<void> {
    await updateDoc(this.docRef(lead.id), {
      status: 'Lost',
      lostAt: serverTimestamp(),
    });
  }

  /** Re-record a contact attempt without changing status (e.g. left another voicemail). */
  async logContactAttempt(lead: Lead): Promise<void> {
    await updateDoc(this.docRef(lead.id), { lastContactAt: serverTimestamp() });
  }

  // --- Trial touchpoints ------------------------------------------------------

  /** Mark one of the three trial check-ins done, with audit. */
  async markTouchpoint(lead: Lead, key: TrialTouchpointKey): Promise<void> {
    const existing = lead.touchpoints ?? emptyTouchpoints();
    const next: TrialTouchpoints = {
      ...existing,
      [key]: { done: true, at: Timestamp.now(), by: this.auth.currentUserName() },
    };
    await updateDoc(this.docRef(lead.id), {
      touchpoints: next,
      lastContactAt: serverTimestamp(),
    });
  }

  // --- Internals --------------------------------------------------------------

  private docRef(id: string) {
    return doc(this.firestore, 'leads', id);
  }

  /** Build the source-specific slice of a lead from a draft/lead, defaulting trial scaffold. */
  private sourceFields(source: LeadSource, src: Partial<Lead>): Record<string, unknown> {
    switch (source) {
      case 'trial':
        return {
          trialStage: src.trialStage ?? null,
          trialDay: src.trialDay ?? null,
          experienceNotes: src.experienceNotes ?? null,
          touchpoints: src.touchpoints ?? emptyTouchpoints(),
        };
      case 'promo':
        return {
          promoName: src.promoName ?? null,
          purchaseDate: src.purchaseDate ?? null,
        };
      // 'new' and 'quiz' only use shared fields.
      default:
        return {};
    }
  }
}

/** Fresh, all-undone trial touchpoint scaffold. */
export function emptyTouchpoints(): TrialTouchpoints {
  const blank = { done: false, at: null, by: null };
  return {
    firstServiceContact: { ...blank },
    midTrialCheck: { ...blank },
    finalTrialCall: { ...blank },
  };
}
