import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Icon } from '../../ui/icon';
import type { StripMark } from './clients.models';

/**
 * One day of the Clients strip, and of its legend and the sheet that explains it (critique B4a):
 * ✓ done, × missed, – still due, a quiet dot for a day with no workout. A shape as well as a colour,
 * so it never depends on colour alone; decorative, as the strip says itself in words beside it.
 */
@Component({
  selector: 'app-day-mark',
  imports: [Icon],
  template: `
    @switch (mark()) {
      @case ('done') {
        <app-icon name="check" />
      }
      @case ('missed') {
        <app-icon name="close" />
      }
      @case ('due') {
        <app-icon name="minus" />
      }
    }
  `,
  styles: `
    :host {
      align-items: center;
      block-size: 1.25rem;
      border-radius: 0.3125rem;
      box-sizing: border-box;
      display: inline-flex;
      flex: none;
      inline-size: 1.25rem;
      justify-content: center;
      overflow: hidden;
    }

    // Forest on light, the bright accent on dark, as on Coach Today's week.
    :host([data-mark='done']) {
      background: var(--tb-accent-ink);
      color: var(--tb-on-accent-ink);
    }

    :host([data-mark='missed']) {
      background: var(--tb-warning-soft);
      border: 1.5px solid var(--tb-warning);
      color: var(--tb-warning);
    }

    :host([data-mark='due']) {
      border: 1.5px dashed var(--tb-line-strong);
      color: var(--tb-muted);
    }

    :host([data-mark='rest'])::after {
      background: var(--tb-line-strong);
      block-size: 0.3125rem;
      border-radius: 50%;
      content: '';
      inline-size: 0.3125rem;
    }

    @media (forced-colors: active) {
      :host(:not([data-mark='rest'])) {
        border: 1.5px solid CanvasText;
      }
    }
  `,
  host: { '[attr.data-mark]': 'mark()', 'aria-hidden': 'true' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DayMarkView {
  readonly mark = input.required<StripMark>();
}
