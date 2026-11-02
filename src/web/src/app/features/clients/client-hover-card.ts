import { Overlay, type OverlayRef } from '@angular/cdk/overlay';
import { TemplatePortal } from '@angular/cdk/portal';
import { DOCUMENT } from '@angular/common';
import {
  DestroyRef,
  Directive,
  ElementRef,
  inject,
  input,
  TemplateRef,
  ViewContainerRef,
} from '@angular/core';
import { Motion } from '../../core/motion/motion';
import type { ClientRow } from './clients.models';
import { ROWS_MOMENT } from './rows-moment';

/**
 * A client's hover card (docs/MOTION-PLAN-2026-11.md, W14): on a client's row, once the mouse has
 * rested on it for 700 ms, a card beside the name spells out the row's own last seven days and its
 * plan line, from the row's data and no new read; it closes 300 ms after the mouse leaves, and at
 * once on a press (the row opens the client). Only where a pointer hovers and points finely
 * (`(hover: hover) and (pointer: fine)`): a finger never hovers. A reading, not a control: the
 * card takes no pointer events, is hidden from assistive technology (the row already says it all)
 * and holds nothing to focus.
 */

/** How long the mouse rests on a row before its card opens. */
export const HOVER_OPEN_MS = 700;
/** How long after the mouse leaves the card stays. */
export const HOVER_CLOSE_MS = 300;
/** A mouse, or another pointer that hovers and points finely. */
export const HOVER_QUERY = '(hover: hover) and (pointer: fine)';

@Directive({
  selector: '[appClientHoverCard]',
  host: {
    '(pointerenter)': 'enter($event)',
    '(pointerleave)': 'leave()',
    '(pointerdown)': 'hide()',
  },
})
export class ClientHoverCard {
  /** The row the card reads. */
  readonly row = input.required<ClientRow>({ alias: 'appClientHoverCard' });
  /** The card's template, declared once by the page; its context is the row. */
  readonly hoverCardTemplate = input.required<TemplateRef<{ $implicit: ClientRow }>>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly overlay = inject(Overlay);
  private readonly viewContainer = inject(ViewContainerRef);
  private readonly document = inject(DOCUMENT);
  private readonly motion = inject(Motion);
  private ref: OverlayRef | null = null;
  private openTimer: ReturnType<typeof setTimeout> | null = null;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.hide());
  }

  protected enter(event: Event): void {
    const pointerType = (event as Partial<PointerEvent>).pointerType;
    if (pointerType !== undefined && pointerType !== 'mouse' && pointerType !== 'pen') return;
    if (!this.document.defaultView?.matchMedia?.(HOVER_QUERY).matches) return;
    this.clearTimers();
    if (this.ref) return;
    this.openTimer = setTimeout(() => this.show(), HOVER_OPEN_MS);
  }

  protected leave(): void {
    this.clearTimers();
    if (this.ref) this.closeTimer = setTimeout(() => this.hide(), HOVER_CLOSE_MS);
  }

  protected hide(): void {
    this.clearTimers();
    const ref = this.ref;
    this.ref = null;
    ref?.dispose();
  }

  private show(): void {
    this.openTimer = null;
    const element = this.host.nativeElement;
    const anchor = element.querySelector('.who') ?? element;
    const position = this.overlay
      .position()
      .flexibleConnectedTo(anchor)
      .withPositions([
        { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 6 },
        { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -6 },
      ])
      .withViewportMargin(8)
      .withFlexibleDimensions(false)
      .withPush(true);
    const ref = this.overlay.create({
      positionStrategy: position,
      // A scroll takes the card away: it belongs to a row the mouse rested on, not to the page.
      scrollStrategy: this.overlay.scrollStrategies.close(),
      panelClass: 'tb-hover-pane',
      direction:
        element.closest('[dir]:not([dir="auto"])')?.getAttribute('dir') === 'rtl' ? 'rtl' : 'ltr',
    });
    const mode = element.closest('[data-mode]')?.getAttribute('data-mode');
    if (mode) ref.overlayElement.dataset['mode'] = mode;
    ref.detachments().subscribe(() => {
      if (this.ref === ref) this.hide();
    });
    ref.attach(
      new TemplatePortal(this.hoverCardTemplate(), this.viewContainer, { $implicit: this.row() }),
    );
    // After attaching: the overlay turns the pane's pointer events on as it attaches.
    ref.overlayElement.style.pointerEvents = 'none';
    // The card arrives in the everyday 120 ms, 4 px up; in place at once with reduced motion.
    const card = ref.overlayElement.firstElementChild;
    if (card) this.motion.rise([card], { moment: ROWS_MOMENT, from: 4, duration: 120 });
    this.ref = ref;
  }

  private clearTimers(): void {
    if (this.openTimer !== null) clearTimeout(this.openTimer);
    if (this.closeTimer !== null) clearTimeout(this.closeTimer);
    this.openTimer = null;
    this.closeTimer = null;
  }
}
