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
import { buildSeedLeads } from './seed-data';

/**
 * Dev-only seeding. Writes the sample leads ONCE if this location has none.
 *
 * Guarded three ways: never in production, only when environment.seedOnStartup is true,
 * and only when the collection is empty for this location. Safe to leave wired up.
 * Invoked from AppComponent on init.
 */
@Injectable({ providedIn: 'root' })
export class SeedService {
  private firestore = inject(Firestore);
  private leadsCollection = collection(this.firestore, 'leads');

  async seedIfEmpty(): Promise<void> {
    if (environment.production || !environment.seedOnStartup) return;

    const locationId = environment.defaultLocationId;
    const existing = await getDocs(
      query(this.leadsCollection, where('locationId', '==', locationId)),
    );
    if (!existing.empty) return; // already has data — do nothing

    const batch = writeBatch(this.firestore);
    for (const lead of buildSeedLeads()) {
      batch.set(doc(this.leadsCollection), { ...lead, locationId });
    }
    await batch.commit();
    // eslint-disable-next-line no-console
    console.info('[SeedService] Seeded sample leads for', locationId);
  }
}
