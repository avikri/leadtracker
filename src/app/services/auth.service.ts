import { Injectable, computed, inject } from '@angular/core';
import { Auth, authState, signInWithEmailAndPassword, signOut, User } from '@angular/fire/auth';
import { toSignal } from '@angular/core/rxjs-interop';

/**
 * Thin wrapper over Firebase Auth (email/password).
 *
 * Baseline scope: enough to identify "who is at the front desk" for audit fields and
 * to back a real auth guard later. The guard is a pass-through until environment.requireAuth
 * is flipped on (see auth.guard.ts). Build the /login screen against login()/logout() next.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private auth = inject(Auth);

  /** Live Firebase user (or null). */
  readonly user = toSignal<User | null>(authState(this.auth), { initialValue: null });

  readonly isAuthenticated = computed(() => this.user() !== null);

  /**
   * Display name used to stamp audit fields (enteredBy / contactedBy / touchpoint.by).
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
