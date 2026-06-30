import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { environment } from '../../environments/environment';

/**
 * Baseline auth guard.
 *
 * While environment.requireAuth is false this is a pass-through so the app runs without
 * a sign-in step. Once you create Firebase Auth users, flip requireAuth=true and add a
 * '/login' route — anonymous visitors will then be redirected there.
 */
export const authGuard: CanActivateFn = () => {
  if (!environment.requireAuth) {
    return true;
  }

  const auth = inject(AuthService);
  const router = inject(Router);

  return auth.isAuthenticated() ? true : router.createUrlTree(['/login']);
};
