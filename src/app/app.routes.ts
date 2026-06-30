import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';
import { DashboardComponent } from './features/dashboard/dashboard.component';

export const routes: Routes = [
  {
    path: '',
    component: DashboardComponent,
    canActivate: [authGuard],
  },
  // TODO: add a real /login route when Firebase Auth users exist (see AuthService + authGuard).
  { path: '**', redirectTo: '' },
];
