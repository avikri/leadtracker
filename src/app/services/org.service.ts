import { Injectable, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Auth, authState } from '@angular/fire/auth';
import { Firestore, doc, docData } from '@angular/fire/firestore';
import { Observable, firstValueFrom, of } from 'rxjs';
import { filter, map, shareReplay, switchMap } from 'rxjs/operators';

import { AppUser, Organization } from '../models/org.model';

/**
 * The single source of truth for "which organisation is the signed-in user in".
 *
 * On login it streams the caller's `users/{uid}` doc and exposes its `organizationId`.
 * Everything org-scoped (LeadService reads/writes, seeding) pulls the id from here —
 * nothing reads it from the environment any more.
 *
 * `organizationId` is null while signed out AND during the brief window between login and
 * the users/{uid} doc arriving. One-shot operations that must not race that window await
 * `requireOrganizationId()` instead of reading the signal directly.
 */
@Injectable({ providedIn: 'root' })
export class OrgService {
  private firestore = inject(Firestore);
  private auth = inject(Auth);

  /** Live `users/{uid}` doc for the signed-in user; null when signed out or doc missing. */
  private readonly appUser$: Observable<AppUser | null> = authState(this.auth).pipe(
    switchMap((user) =>
      user
        ? (docData(doc(this.firestore, 'users', user.uid)) as Observable<AppUser | undefined>).pipe(
            map((appUser) => appUser ?? null),
          )
        : of(null),
    ),
    shareReplay({ bufferSize: 1, refCount: false }),
  );

  /** Emits the current user's org id, or null (signed out / doc not yet loaded). */
  readonly organizationId$: Observable<string | null> = this.appUser$.pipe(
    map((appUser) => appUser?.organizationId ?? null),
  );

  /** Signal form of the above — the id the rest of the app reads. */
  readonly organizationId = toSignal(this.organizationId$, { initialValue: null });

  /** Live `organizations/{orgId}` doc for the signed-in user's org; null until it loads. */
  private readonly organization$: Observable<Organization | null> = this.organizationId$.pipe(
    switchMap((id) =>
      id
        ? (docData(doc(this.firestore, 'organizations', id), { idField: 'id' }) as Observable<
            Organization | undefined
          >).pipe(map((org) => org ?? null))
        : of(null),
    ),
    shareReplay({ bufferSize: 1, refCount: false }),
  );

  /** The signed-in user's organisation, or null while signed out / loading. */
  readonly organization = toSignal(this.organization$, { initialValue: null });

  /**
   * URL of the org's brand logo, by convention `assets/{slug}/logo.jpg`, or null when the
   * org has no slug. Consumers should still handle the image failing to load (no file yet)
   * by falling back to the generic mark.
   */
  readonly logoUrl = computed(() => {
    const slug = this.organization()?.slug;
    return slug ? `assets/${slug}/logo.jpg` : null;
  });

  /**
   * Resolves with the org id once it is known. Never resolves while signed out — callers
   * are expected to sit behind the auth guard (or, like seeding, be fine waiting forever).
   */
  requireOrganizationId(): Promise<string> {
    return firstValueFrom(
      this.organizationId$.pipe(filter((id): id is string => id !== null)),
    );
  }
}
