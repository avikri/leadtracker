import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { SeedService } from './seed/seed.service';
import { DialogComponent } from './shared/dialog/dialog.component';

/**
 * App shell. Hosts the router outlet, the app-wide confirm/prompt dialog (see DialogService),
 * and runs the dev-only seed routine on startup (no-op in production / when the collection
 * already has data).
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, DialogComponent],
  template: '<router-outlet></router-outlet><app-dialog></app-dialog>',
})
export class AppComponent implements OnInit {
  private seed = inject(SeedService);

  ngOnInit(): void {
    void this.seed.seedIfEmpty();
  }
}
