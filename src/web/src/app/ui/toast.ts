import { DOCUMENT } from '@angular/common';
import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import {
  ChangeDetectionStrategy,
  Component,
  ComponentRef,
  DestroyRef,
  inject,
  Injectable,
  signal,
  ViewEncapsulation,
} from '@angular/core';
import { Button, IconButton } from './button';
import { modalDirection, ModalDirection } from './modal-surface';

export type ToastTone = 'info' | 'success' | 'error';

export interface ToastOptions {
  tone?: ToastTone;
  /** Zero keeps the toast until dismissal. Actions and errors default to zero. */
  durationMs?: number;
  action?: { label: string; run: () => void };
  dismissLabel?: string;
  direction?: ModalDirection;
}

export interface ToastHandle {
  dismiss(): void;
}

interface ToastEntry {
  id: number;
  message: string;
  tone: ToastTone;
  action?: ToastOptions['action'];
  dismissLabel: string;
}

interface ToastTimer {
  remainingMs: number;
  startedAt: number;
  timeout?: ReturnType<typeof setTimeout>;
  pausedBy: Set<'hover' | 'focus'>;
}

/** Visible stack. Only the message is live; controls are ordinary, separately named buttons. */
@Component({
  selector: 'app-toast-host',
  imports: [Button, IconButton],
  template: `
    <div class="tb-toast-stack">
      @for (entry of toasts.entries(); track entry.id) {
        <div
          class="tb-toast"
          [class.tb-toast--success]="entry.tone === 'success'"
          [class.tb-toast--error]="entry.tone === 'error'"
          (mouseenter)="toasts.setPaused(entry.id, 'hover', true)"
          (mouseleave)="toasts.setPaused(entry.id, 'hover', false)"
          (focusin)="toasts.setPaused(entry.id, 'focus', true)"
          (focusout)="onFocusOut($event, entry.id)"
        >
          <p
            class="tb-toast__message"
            [attr.role]="entry.tone === 'error' ? 'alert' : 'status'"
            [attr.aria-live]="entry.tone === 'error' ? 'assertive' : 'polite'"
            aria-atomic="true"
          >
            {{ entry.message }}
          </p>
          @if (entry.action; as action) {
            <button appButton type="button" variant="text" (click)="toasts.activate(entry.id)">
              {{ action.label }}
            </button>
          }
          <button
            appIconButton
            type="button"
            [label]="entry.dismissLabel"
            (click)="toasts.dismiss(entry.id)"
          >
            <span aria-hidden="true">&times;</span>
          </button>
        </div>
      }
    </div>
  `,
  styleUrl: './overlay-base.scss',
  styles: `
    .tb-toast-pane app-toast-host {
      color: var(--tb-ink);
      display: block;
      font-family: var(--font-sans);
      font-size: var(--text-compact-size);
      inline-size: 100%;
      line-height: var(--text-compact-line-height);
      max-block-size: calc(100dvh - 2rem);
      overflow-y: auto;
      overscroll-behavior: contain;
    }

    .tb-toast-stack {
      display: grid;
      gap: 0.5rem;
      padding: 0.25rem;
    }

    .tb-toast {
      align-items: start;
      background: var(--tb-surface);
      border: 1px solid var(--tb-line);
      border-inline-start: 4px solid var(--tb-info);
      border-radius: var(--tb-radius-control);
      box-shadow: var(--tb-shadow-overlay);
      display: flex;
      gap: 0.5rem;
      min-block-size: 3rem;
      padding: 0.5rem;
      animation: tb-toast-enter var(--tb-duration) var(--tb-ease) both;
    }

    .tb-toast--success {
      border-inline-start-color: var(--tb-success);
    }
    .tb-toast--error {
      border-inline-start-color: var(--tb-danger);
    }

    .tb-toast__message {
      align-self: center;
      flex: 1;
      margin: 0;
      min-inline-size: 0;
      overflow-wrap: anywhere;
      padding-inline-start: 0.25rem;
    }

    .tb-toast .tb-button {
      align-self: center;
      flex: none;
      min-block-size: 2.5rem;
      padding-inline: 0.5rem;
    }

    .tb-toast .tb-icon-button {
      align-self: start;
    }

    .tb-toast :is(button, a):focus-visible {
      outline: var(--focus-ring-width) solid var(--tb-focus);
      outline-offset: var(--focus-separation-gap);
    }

    @keyframes tb-toast-enter {
      from {
        opacity: 0;
        transform: translateY(-0.5rem);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .tb-toast {
        animation: none;
      }
    }

    @media (forced-colors: active) {
      .tb-toast {
        border-color: CanvasText;
        border-inline-start-width: 4px;
      }
    }
  `,
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToastHost {
  protected readonly toasts = inject(UiToast);

  protected onFocusOut(event: FocusEvent, id: number): void {
    const next = event.relatedTarget;
    if (!(next instanceof Node) || !(event.currentTarget as HTMLElement).contains(next)) {
      this.toasts.setPaused(id, 'focus', false);
    }
  }
}

/** Small, text-only notification overlay. No HTML from callers is rendered. */
@Injectable({ providedIn: 'root' })
export class UiToast {
  private readonly overlay = inject(Overlay);
  private readonly document = inject(DOCUMENT);
  private readonly items = signal<ToastEntry[]>([]);
  private readonly timers = new Map<number, ToastTimer>();
  private overlayRef?: OverlayRef;
  private hostRef?: ComponentRef<ToastHost>;
  private nextId = 0;

  readonly entries = this.items.asReadonly();

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      for (const timer of this.timers.values()) clearTimeout(timer.timeout);
      this.timers.clear();
      this.overlayRef?.dispose();
    });
  }

  show(message: string, options: ToastOptions = {}): ToastHandle {
    const tone = options.tone ?? 'info';
    const id = ++this.nextId;
    const durationMs = options.durationMs ?? (tone === 'error' || options.action ? 0 : 6000);
    this.ensureHost(modalDirection(this.document, options.direction));
    this.items.update((items) => [
      ...items,
      {
        id,
        message,
        tone,
        action: options.action,
        dismissLabel: options.dismissLabel ?? 'Dismiss notification',
      },
    ]);
    if (durationMs > 0) {
      const timer: ToastTimer = {
        remainingMs: durationMs,
        startedAt: 0,
        pausedBy: new Set(),
      };
      this.timers.set(id, timer);
      this.startTimer(id, timer);
    }
    return { dismiss: () => this.dismiss(id) };
  }

  dismiss(id: number): void {
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer.timeout);
    this.timers.delete(id);
    this.items.update((items) => items.filter((item) => item.id !== id));
    if (this.items().length === 0) {
      this.overlayRef?.dispose();
      this.overlayRef = undefined;
      this.hostRef = undefined;
    }
  }

  activate(id: number): void {
    const action = this.items().find((item) => item.id === id)?.action;
    if (!action) return;
    try {
      action.run();
    } finally {
      this.dismiss(id);
    }
  }

  setPaused(id: number, reason: 'hover' | 'focus', paused: boolean): void {
    const timer = this.timers.get(id);
    if (!timer) return;
    if (paused) {
      if (timer.pausedBy.has(reason)) return;
      timer.pausedBy.add(reason);
      if (timer.timeout) {
        clearTimeout(timer.timeout);
        timer.timeout = undefined;
        timer.remainingMs = Math.max(0, timer.remainingMs - (Date.now() - timer.startedAt));
      }
    } else {
      timer.pausedBy.delete(reason);
      if (timer.pausedBy.size === 0 && !timer.timeout) this.startTimer(id, timer);
    }
  }

  private startTimer(id: number, timer: ToastTimer): void {
    timer.startedAt = Date.now();
    timer.timeout = setTimeout(() => this.dismiss(id), timer.remainingMs);
  }

  private ensureHost(direction: ModalDirection): void {
    const position = this.overlay.position().global().top('calc(env(safe-area-inset-top) + 1rem)');
    if (direction === 'rtl') position.left('1rem');
    else position.right('1rem');

    if (this.overlayRef) {
      this.overlayRef.updatePositionStrategy(position);
      this.overlayRef.setDirection(direction);
      return;
    }

    this.overlayRef = this.overlay.create({
      hasBackdrop: false,
      panelClass: 'tb-toast-pane',
      positionStrategy: position,
      scrollStrategy: this.overlay.scrollStrategies.noop(),
      direction,
      width: 'min(24rem, calc(100vw - 2rem))',
    });
    this.hostRef = this.overlayRef.attach(new ComponentPortal(ToastHost));
  }
}
