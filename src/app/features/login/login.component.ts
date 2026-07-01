import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { AuthService } from '../../services/auth.service';

/**
 * Sign-in screen. Email/password against Firebase Auth (see AuthService).
 *
 * Reached when authGuard bounces an anonymous visitor; the guard passes the attempted
 * URL as ?returnUrl so we can send them back after a successful sign-in.
 */
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './login.component.html',
})
export class LoginComponent {
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  email = '';
  password = '';
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);

  async submit(): Promise<void> {
    if (this.submitting()) return;
    if (!this.email.trim() || !this.password) {
      this.error.set('Enter your email and password.');
      return;
    }

    this.submitting.set(true);
    this.error.set(null);
    try {
      await this.auth.login(this.email.trim(), this.password);
      const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') || '/';
      await this.router.navigateByUrl(returnUrl);
    } catch (err: unknown) {
      this.error.set(this.messageFor(err));
    } finally {
      this.submitting.set(false);
    }
  }

  /** Map Firebase Auth error codes to something a front-desk user can read. */
  private messageFor(err: unknown): string {
    const code = (err as { code?: string })?.code ?? '';
    switch (code) {
      case 'auth/invalid-email':
        return 'That email address is not valid.';
      case 'auth/user-disabled':
        return 'This account has been disabled.';
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
      case 'auth/user-not-found':
        return 'Incorrect email or password.';
      case 'auth/too-many-requests':
        return 'Too many attempts. Try again in a few minutes.';
      default:
        return 'Could not sign in. Please try again.';
    }
  }
}
