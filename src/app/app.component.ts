import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { SeedService } from './seed/seed.service';

/**
 * App shell. Hosts the router outlet and runs the dev-only seed routine on startup
 * (no-op in production / when the collection already has data).
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: '<router-outlet></router-outlet>',
})
export class AppComponent implements OnInit {
  private seed = inject(SeedService);

  ngOnInit(): void {
    void this.seed.seedIfEmpty();
  }
}
