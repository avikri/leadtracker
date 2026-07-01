import { Injectable, signal } from '@angular/core';

/**
 * App-wide replacement for the browser's native `confirm()` / `prompt()`.
 *
 * A single {@link DialogComponent} (mounted once at the app root) renders whatever request is
 * held in {@link current}. Call sites `await` the returned Promise and branch exactly as they
 * did with the native dialogs — `confirm` resolves `true`/`false`, `prompt` resolves the entered
 * string or `null` when cancelled — so migrating away from `window.confirm`/`window.prompt` is a
 * drop-in change at the call site.
 */
export type DialogVariant = 'default' | 'destructive';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** `destructive` renders the confirm action in the app's danger style (e.g. Mark as Lost). */
  variant?: DialogVariant;
}

export interface PromptOptions extends ConfirmOptions {
  defaultValue?: string;
  placeholder?: string;
}

interface DialogState {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  variant: DialogVariant;
  isPrompt: boolean;
  defaultValue: string;
  placeholder: string;
  resolve: (result: boolean | string | null) => void;
}

@Injectable({ providedIn: 'root' })
export class DialogService {
  private readonly state = signal<DialogState | null>(null);

  /** The dialog currently requested, or `null` when nothing is open. Drives the component. */
  readonly current = this.state.asReadonly();

  /** Resolves `true` on confirm, `false` on cancel / Escape / backdrop. */
  confirm(options: ConfirmOptions): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.push({
        ...this.base(options),
        confirmLabel: options.confirmLabel ?? 'Confirm',
        isPrompt: false,
        defaultValue: '',
        placeholder: '',
        resolve: (result) => resolve(result === true),
      });
    });
  }

  /** Resolves the entered string on confirm, `null` on cancel — mirrors `window.prompt`. */
  prompt(options: PromptOptions): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      this.push({
        ...this.base(options),
        confirmLabel: options.confirmLabel ?? 'OK',
        isPrompt: true,
        defaultValue: options.defaultValue ?? '',
        placeholder: options.placeholder ?? '',
        resolve: (result) => resolve(typeof result === 'string' ? result : null),
      });
    });
  }

  /** Called by the component when the user confirms, cancels, or dismisses. */
  settle(result: boolean | string | null): void {
    const active = this.state();
    if (!active) return;
    this.state.set(null);
    active.resolve(result);
  }

  private base(options: ConfirmOptions) {
    return {
      title: options.title,
      message: options.message,
      cancelLabel: options.cancelLabel ?? 'Cancel',
      variant: options.variant ?? ('default' as DialogVariant),
    };
  }

  private push(next: DialogState): void {
    // Only one dialog at a time: cancel any pending request so its Promise never dangles.
    this.settle(next.isPrompt ? null : false);
    this.state.set(next);
  }
}
