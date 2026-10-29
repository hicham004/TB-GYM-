import { DOCUMENT } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  input,
  output,
} from '@angular/core';
import { Button } from '../../ui/button';
import { Icon } from '../../ui/icon';

/** The custom property `html` reads to keep a focused control clear of the bar (styles.scss). */
export const ADDING_BAR_BLOCK_SIZE = '--tb-adding-bar-block-size';

/**
 * The bar at the foot of a builder while a library row chosen with + waits for an Add here
 * (critique B5b): what is being added, and Cancel. Escape and a second press of + cancel too, but a
 * phone has no Escape key and its library is in a sheet that closed when the row was chosen.
 */
@Component({
  selector: 'app-adding-bar',
  imports: [Button, Icon],
  template: `
    <span class="mark" aria-hidden="true"><app-icon name="plus" /></span>
    <!-- The name is the coach's own words, in either script. -->
    <p class="text" i18n>
      Adding <bdi class="name">{{ name() }}</bdi
      >: press Add here where it goes.
    </p>
    <button appButton type="button" variant="outlined" (click)="cancelled.emit()" i18n>
      Cancel
    </button>
  `,
  styles: `
    // Pinned to the foot of the screen while the grid scrolls under it, inside the grid's column,
    // so the sidebar and the library beside the grid stay clear.
    :host {
      align-items: center;
      align-self: center;
      background: var(--tb-surface);
      border: 1px solid var(--tb-line);
      border-inline-start: 4px solid var(--tb-accent-ink);
      border-radius: var(--tb-radius-control);
      box-shadow: var(--tb-shadow-overlay);
      box-sizing: border-box;
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem 0.75rem;
      inline-size: min(100%, 40rem);
      inset-block-end: calc(env(safe-area-inset-bottom) + 0.75rem);
      padding-block: 0.5rem;
      padding-inline: 0.75rem 0.5rem;
      position: sticky;
      z-index: 2;
    }

    .mark {
      align-items: center;
      background: var(--tb-accent-ink);
      block-size: 2rem;
      border-radius: 999px;
      color: var(--tb-on-accent-ink);
      display: inline-flex;
      flex: none;
      inline-size: 2rem;
      justify-content: center;
    }

    .text {
      color: var(--tb-ink);
      flex: 1 1 12rem;
      margin: 0;
      min-inline-size: 0;
      overflow-wrap: anywhere;
    }

    .name {
      font-weight: 700;
    }

    @media (forced-colors: active) {
      :host {
        border-color: CanvasText;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AddingBar {
  /** The recipe, exercise or saved workout being added. */
  readonly name = input.required<string>();
  readonly cancelled = output<void>();

  constructor() {
    // Publishes how much of the screen's foot the bar takes, its gap included, and keeps it current
    // as its words wrap, so a control reached by keyboard stops clear of it (WCAG 2.4.11), as the
    // client's tab bar does. Removed again with the bar.
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const root = inject(DOCUMENT).documentElement;
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(() =>
        root.style.setProperty(
          ADDING_BAR_BLOCK_SIZE,
          `calc(${host.getBoundingClientRect().height}px + 1.25rem)`,
        ),
      );
      observer.observe(host);
      destroyRef.onDestroy(() => observer.disconnect());
    });
    destroyRef.onDestroy(() => root.style.removeProperty(ADDING_BAR_BLOCK_SIZE));
  }
}
