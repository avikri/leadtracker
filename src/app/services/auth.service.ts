import { Injectable, computed, inject } from '@angular/core';
import { Auth, authState, signInWithEmailAndPassword, signOut, User } from '@angular/fire/auth';
import { toSignal } from '@angular/core/rxjs-interop';

/**
 * Thin wrapper over Firebase Auth (email/password).
 *
 * Baseline scope: enough to gate the app behind a login and show who's signed in.
 * The guard is a pass-through until environment.requireAuth is flipped on (see
 * auth.guard.ts). Build the /login screen against login()/logout() next.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private auth = inject(Auth);

  /** Live Firebase user (or null). */
  readonly user = toSignal<User | null>(authState(this.auth), { initialValue: null });

  readonly isAuthenticated = computed(() => this.user() !== null);

  /**
   * Display name shown in the dashboard top bar.
   * Falls back to a generic label so the baseline works before real users exist.
   */
  readonly currentUserName = computed(
    () => this.user()?.displayName ?? this.user()?.email ?? 'Front desk',
  );

  login(email: string, password: string) {
    return signInWithEmailAndPassword(this.auth, email, password);
  }

  logout() {
    return signOut(this.auth);
  }
}
