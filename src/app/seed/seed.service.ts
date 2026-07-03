import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  getDocs,
  query,
  where,
  writeBatch,
  doc,
} from '@angular/fire/firestore';

import { environment } from '../../environments/environment';
import { OrgService } from '../services/org.service';
import { buildSeedLeads } from './seed-data';

/**
 * Dev-only seeding. Writes the sample leads ONCE if the organisation has none.
 *
 * Guarded three ways: never in production, only when environment.seedOnStartup is true,
 * and only when the collection is empty for this organisation. Safe to leave wired up.
 * Invoked from AppComponent on init; it then WAITS for sign-in — the organizationId comes
 * from the user's `users/{uid}` doc, and the Firestore rules reject unauthenticated writes
 * anyway. If nobody ever signs in, the awaited promise simply never resolves (harmless).
 */
@Injectable({ providedIn: 'root' })
export class SeedService {
  private firestore = inject(Firestore);
  private org = inject(OrgService);
  private leadsCollection = collection(this.firestore, 'leads');

  async seedIfEmpty(): Promise<void> {
    if (environment.production || !environment.seedOnStartup) return;

    const organizationId = await this.org.requireOrganizationId();
    const existing = await getDocs(
      query(this.leadsCollection, where('organizationId', '==', organizationId)),
    );
    if (!existing.empty) return; // already has data — do nothing

    const batch = writeBatch(this.firestore);
    for (const lead of buildSeedLeads()) {
      batch.set(doc(this.leadsCollection), { ...lead, organizationId });
    }
    await batch.commit();
    // eslint-disable-next-line no-console
    console.info('[SeedService] Seeded sample leads for org', organizationId);
  }
}
