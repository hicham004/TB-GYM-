import { NgTemplateOutlet } from '@angular/common';
import { DIALOG_DATA, DialogConfig, DialogRef } from '@angular/cdk/dialog';
import { hasModifierKey } from '@angular/cdk/keycodes';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  Injector,
  signal,
  TemplateRef,
  viewChild,
  ViewEncapsulation,
} from '@angular/core';
import { IconButton } from './button';
import { MODAL_FOOTER_SLOT, type ModalFooterSlot } from './modal-footer';

export type ModalDirection = 'ltr' | 'rtl';

export interface ModalOptions {
  /** Visible heading and accessible dialog name. */
  title: string;
  direction?: ModalDirection;
  closeLabel?: string;
  /** A field selector when an error needs correction; otherwise focus the heading. */
  initialFocus?: string;
  /**
   * False keeps the modal open while the address changes. A leave confirmation needs it: the
   * browser's Back button changes the address before the page is asked whether it may go.
   */
  closeOnNavigation?: boolean;
  /**
   * Asked before the close button, Escape or the backdrop closes the modal, say to keep typed work;
   * false keeps it open. A close the page makes itself, after a save, is not asked.
   */
  canClose?: () => boolean | Promise<boolean>;
  /**
   * Printing the page while the modal is open prints the modal alone: its title and content, on as
   * many pages as they take (the client's recipe, R4.4d). Content marked `tb-print-hide` is left out.
   */
  printable?: boolean;
  /**
   * Draws the modal in this mode whatever the person chose, for a screen that is always one mode: a
   * sheet over the workout player, which is always dark (§3), is dark too (R6.1a).
   */
  mode?: 'light' | 'dark';
}

/**
 * Starts the modal's own mode scope on its overlay pane (`_tokens.scss`), so its surface and
 * controls read that mode's tokens.
 */
export function applyModalMode<R>(
  ref: DialogRef<R, ModalSurface>,
  mode: ModalOptions['mode'],
): void {
  if (mode) ref.overlayRef.overlayElement.dataset['mode'] = mode;
}

/** The overlay pane's classes for a modal of this kind and these options. */
export function modalPaneClasses(kind: 'dialog' | 'sheet', options: ModalOptions): string[] {
  return [
    'tb-modal-pane',
    `tb-modal-pane--${kind}`,
    ...(options.printable ? ['tb-modal-pane--printable'] : []),
  ];
}

export interface ModalData {
  content: TemplateRef<unknown>;
  title: string;
  titleId: string;
  closeLabel: string;
  /** Set by `guardClose` when the modal asks before closing. */
  requestClose?: () => void;
}

/**
 * Content shell shared by the centred dialog and the mobile bottom sheet: the title bar, the body that
 * scrolls, and the footer the content's `appModalFooter` actions are drawn in (critique B2a). The footer
 * is outside the body, so it never covers the body's last line; it lifts on a soft shadow while there
 * is more to scroll to.
 */
@Component({
  selector: 'app-modal-surface',
  imports: [IconButton, NgTemplateOutlet],
  template: `
    <!-- Not a <header>: a modal's title bar is no page banner, and two stacked modals would make two. -->
    <div class="tb-modal__header">
      <h2 class="tb-modal__title" [id]="data.titleId">{{ data.title }}</h2>
      <button appIconButton type="button" [label]="data.closeLabel" (click)="close()">
        <span aria-hidden="true">&times;</span>
      </button>
    </div>
    <div #body class="tb-modal__body">
      <ng-container
        [ngTemplateOutlet]="data.content"
        [ngTemplateOutletContext]="{ $implicit: dialogRef }"
        [ngTemplateOutletInjector]="contentInjector"
      />
      <div #end class="tb-modal__end"></div>
    </div>
    @if (footer(); as actions) {
      <div class="tb-modal__footer" [class.tb-modal__footer--raised]="moreBelow()">
        <ng-container [ngTemplateOutlet]="actions" />
      </div>
    }
  `,
  styleUrl: './overlay-base.scss',
  styles: `
    .tb-modal-backdrop {
      background: color-mix(in srgb, var(--tb-night) 56%, transparent);
      transition-duration: var(--tb-duration);
      transition-timing-function: var(--tb-ease);
    }

    .tb-modal-pane app-modal-surface {
      background: var(--tb-surface);
      border: 1px solid var(--tb-line);
      border-radius: var(--tb-radius-card);
      box-shadow: var(--tb-shadow-overlay);
      box-sizing: border-box;
      color: var(--tb-ink);
      display: flex;
      flex-direction: column;
      font-family: var(--font-sans);
      font-size: var(--text-body-size);
      inline-size: 100%;
      line-height: var(--text-body-line-height);
      max-block-size: calc(100dvh - 2rem);
      min-inline-size: 0;
      overflow: hidden;
      animation: tb-modal-enter var(--tb-duration) var(--tb-ease) both;
    }

    .tb-modal-pane--sheet app-modal-surface {
      border-block-end: 0;
      border-end-end-radius: 0;
      border-end-start-radius: 0;
      max-block-size: min(90dvh, 52rem);
      animation-name: tb-sheet-enter;
    }

    .tb-modal__header {
      align-items: start;
      border-block-end: 1px solid var(--tb-line);
      display: flex;
      flex: none;
      gap: 1rem;
      justify-content: space-between;
      padding-block: 1rem;
      padding-inline: 1.5rem;
    }

    .tb-modal__title {
      font-size: var(--text-section-title-size);
      font-weight: var(--font-weight-strong);
      line-height: var(--text-section-title-line-height);
      margin: 0;
      min-inline-size: 0;
      overflow-wrap: anywhere;
      padding-block: 0.25rem;
    }

    .tb-modal__body {
      min-block-size: 0;
      overflow: auto;
      overscroll-behavior: contain;
      padding: 1.5rem;
    }

    // A little more room between the last line and the footer than the body's own edge.
    .tb-modal__body:has(+ .tb-modal__footer) {
      padding-block-end: 2rem;
    }

    // A phone's home indicator sits under whatever ends the sheet: the footer, or the body without one.
    .tb-modal-pane--sheet .tb-modal__body:not(:has(+ .tb-modal__footer)) {
      padding-block-end: calc(1.5rem + env(safe-area-inset-bottom));
    }

    // Marks the end of the body's content; while it is out of view there is more below the footer.
    .tb-modal__end {
      block-size: 0;
    }

    .tb-modal__footer {
      align-items: center;
      background: var(--tb-surface);
      border-block-start: 1px solid var(--tb-line);
      display: flex;
      flex: none;
      flex-wrap: wrap;
      gap: 0.5rem;
      justify-content: flex-end;
      padding-block: 0.75rem;
      padding-inline: 1.5rem;
      // Above the body, which scrolls in a layer of its own, so its shadow falls on the body.
      position: relative;
      transition: box-shadow var(--tb-duration) var(--tb-ease);
      z-index: 1;
    }

    .tb-modal-pane--sheet .tb-modal__footer {
      padding-block-end: calc(0.75rem + env(safe-area-inset-bottom));
    }

    .tb-modal__footer--raised {
      box-shadow: 0 -0.25rem 0.75rem -0.25rem color-mix(in srgb, var(--tb-night) 24%, transparent);
    }

    .tb-modal-pane :is(button, a, input, select, textarea, [tabindex]):focus-visible {
      outline: var(--focus-ring-width) solid var(--tb-focus);
      outline-offset: var(--focus-separation-gap);
    }

    @keyframes tb-modal-enter {
      from {
        opacity: 0;
        transform: translateY(0.5rem) scale(0.98);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    @keyframes tb-sheet-enter {
      from {
        opacity: 0;
        transform: translateY(1rem);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .tb-modal-pane app-modal-surface {
        animation: none;
      }
      .tb-modal-backdrop,
      .tb-modal__footer {
        transition: none;
      }
    }

    @media (forced-colors: active) {
      .tb-modal-pane app-modal-surface {
        border-color: CanvasText;
      }
    }

    /*
     * A printable modal prints alone: the page, the backdrop and any other overlay stay off the
     * paper, and the modal flows over as many pages as it needs instead of scrolling. The overlay
     * wraps the backdrop and the pane in one popover; the pane's size and place are inline styles
     * from the overlay, hence the !important.
     */
    @media print {
      body:has(.tb-modal-pane--printable) > :not(.cdk-overlay-container),
      .cdk-overlay-container:has(.tb-modal-pane--printable) > :not(:has(.tb-modal-pane--printable)),
      :has(> .tb-modal-pane--printable) > .cdk-overlay-backdrop,
      .tb-modal-pane--printable .tb-modal__header button,
      .tb-modal-pane--printable .tb-modal__footer,
      .tb-modal-pane--printable .tb-print-hide {
        display: none !important;
      }

      .cdk-overlay-container:has(.tb-modal-pane--printable),
      .cdk-overlay-container:has(.tb-modal-pane--printable) > :has(.tb-modal-pane--printable),
      .tb-modal-pane--printable,
      .tb-modal-pane--printable > .cdk-dialog-container {
        block-size: auto !important;
        display: block !important;
        inline-size: auto !important;
        max-block-size: none !important;
        max-inline-size: none !important;
        position: static !important;
        transform: none !important;
      }

      .tb-modal-pane--printable app-modal-surface {
        animation: none;
        border: 0;
        box-shadow: none;
        display: block;
        max-block-size: none;
        overflow: visible;
      }

      .tb-modal-pane--printable .tb-modal__header {
        border: 0;
        padding: 0 0 1rem;
      }

      .tb-modal-pane--printable .tb-modal__body {
        overflow: visible;
        padding: 0;
      }
    }
  `,
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ModalSurface {
  protected readonly data = inject<ModalData>(DIALOG_DATA);
  protected readonly dialogRef = inject<DialogRef<unknown>>(DialogRef);
  private readonly body = viewChild.required<ElementRef<HTMLElement>>('body');
  private readonly end = viewChild.required<ElementRef<HTMLElement>>('end');
  private readonly footers = signal<readonly TemplateRef<unknown>[]>([]);
  /** The actions the content handed over; the newest, should it hand over more than one. */
  protected readonly footer = computed(() => this.footers().at(-1) ?? null);
  /** The body can still scroll down, so the footer lifts off it. */
  protected readonly moreBelow = signal(false);
  /**
   * The content's own injector holds the footer slot and nothing else, so every other token is still
   * found where the content was declared, never in the overlay.
   */
  protected readonly contentInjector = Injector.create({
    providers: [
      {
        provide: MODAL_FOOTER_SLOT,
        useValue: {
          show: (actions) => this.footers.update((shown) => [...shown, actions]),
          hide: (actions) => this.footers.update((shown) => shown.filter((it) => it !== actions)),
        } satisfies ModalFooterSlot,
      },
    ],
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      if (typeof IntersectionObserver === 'undefined') return;
      const observer = new IntersectionObserver(
        (entries) => this.moreBelow.set(!entries[entries.length - 1].isIntersecting),
        { root: this.body().nativeElement },
      );
      observer.observe(this.end().nativeElement);
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  protected close(): void {
    if (this.data.requestClose) this.data.requestClose();
    else this.dialogRef.close();
  }
}

/** The CDK settings for a modal that asks first: Escape and the backdrop no longer close it alone. */
export function guardedConfig(options: ModalOptions): Pick<DialogConfig, 'disableClose'> {
  return { disableClose: !!options.canClose };
}

/**
 * Sends the close button, Escape and the backdrop through `canClose`, one question at a time, and
 * closes only on a yes.
 */
export function guardClose<R>(
  ref: DialogRef<R, ModalSurface>,
  data: ModalData,
  canClose: ModalOptions['canClose'],
): void {
  if (!canClose) return;
  let asking = false;
  const request = async () => {
    if (asking) return;
    asking = true;
    try {
      if (await canClose()) ref.close();
    } finally {
      asking = false;
    }
  };
  data.requestClose = () => void request();
  ref.backdropClick.subscribe(() => void request());
  ref.keydownEvents.subscribe((event) => {
    if (event.key === 'Escape' && !hasModifierKey(event)) {
      event.preventDefault();
      void request();
    }
  });
}

/** A lab-local `dir` also governs a surface portalled to the document body. */
export function modalDirection(document: Document, requested?: ModalDirection): ModalDirection {
  if (requested) return requested;
  const focused = document.activeElement?.closest('[dir]');
  return focused?.getAttribute('dir') === 'rtl' || document.documentElement.dir === 'rtl'
    ? 'rtl'
    : 'ltr';
}
