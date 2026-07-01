import { Component, ElementRef, effect, inject, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DialogService } from './dialog.service';

/**
 * Single, app-wide modal that renders the request held in {@link DialogService.current}.
 *
 * Reuses the "Add lead" modal's styling (backdrop / panel / footer classes) so confirmations
 * look like the rest of the app, and layers on the modal behaviours that flow expects: focus is
 * trapped inside the panel, Escape and backdrop clicks cancel, and the initial focus lands on the
 * prompt input (or the confirm button) when it opens.
 */
@Component({
  selector: 'app-dialog',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './dialog.component.html',
})
export class DialogComponent {
  private readonly dialog = inject(DialogService);

  readonly current = this.dialog.current;
  promptValue = '';

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  constructor() {
    // Seed the input and move focus into the dialog each time one opens.
    effect(() => {
      const active = this.current();
      if (!active) return;
      this.promptValue = active.defaultValue;
      setTimeout(() => this.focusInitial());
    });
  }

  confirm(): void {
    const active = this.current();
    if (!active) return;
    this.dialog.settle(active.isPrompt ? this.promptValue : true);
  }

  cancel(): void {
    const active = this.current();
    if (!active) return;
    this.dialog.settle(active.isPrompt ? null : false);
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.cancel();
      return;
    }
    if (event.key !== 'Tab') return;

    // Focus trap: keep Tab / Shift+Tab cycling within the panel.
    const items = this.focusable();
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private focusInitial(): void {
    const items = this.focusable();
    if (items.length === 0) return;
    // Prompt: land on the text input. Confirm: land on the confirm action (last item).
    const target = this.current()?.isPrompt ? items.find((el) => el.tagName === 'INPUT') : undefined;
    (target ?? items[items.length - 1]).focus();
  }

  private focusable(): HTMLElement[] {
    const root = this.panel()?.nativeElement;
    if (!root) return [];
    return Array.from(
      root.querySelectorAll<HTMLElement>(
        'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => !el.hasAttribute('disabled') && el.tabIndex !== -1);
  }
}
