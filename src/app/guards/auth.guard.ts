import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth, authState } from '@angular/fire/auth';
import { map, take } from 'rxjs';

import { environment } from '../../environments/environment';

/**
 * Auth guard.
 *
 * While environment.requireAuth is false this is a pass-through so the app runs without
 * a sign-in step. When true, anonymous visitors are redirected to '/login' with the
 * attempted URL in ?returnUrl.
 *
 * We resolve the guard from authState's FIRST emission (take(1)) rather than a cached
 * signal: on a fresh load / refresh Firebase restores the persisted session
 * asynchronously, so reading a snapshot too early would bounce a signed-in user to login.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  if (!environment.requireAuth) {
    return true;
  }

  const auth = inject(Auth);
  const router = inject(Router);

  return authState(auth).pipe(
    take(1),
    map((user) =>
      user
        ? true
        : router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } }),
    ),
  );
};
