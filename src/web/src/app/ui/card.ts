import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type CardVariant = 'surface' | 'soft' | 'brand';

/** A surface for a related group of content; its caller supplies the semantic element or heading. */
@Component({
  selector: 'app-card',
  template: '<ng-content />',
  styles: `
    :host {
      background: var(--tb-surface);
      border: 1px solid var(--tb-line);
      border-radius: var(--tb-radius-card);
      box-shadow: var(--tb-shadow-card);
      color: var(--tb-ink);
      display: block;
      min-inline-size: 0;
      padding: var(--space-20, 20px);
    }

    :host(.soft) {
      background: var(--tb-surface-2);
    }

    :host(.brand) {
      background: var(--tb-brand);
      border-color: var(--tb-brand);
      color: var(--tb-on-brand);
    }
  `,
  host: {
    '[class.soft]': "variant() === 'soft'",
    '[class.brand]': "variant() === 'brand'",
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Card {
  readonly variant = input<CardVariant>('surface');
}
