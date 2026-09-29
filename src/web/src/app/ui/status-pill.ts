import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type StatusPillTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'warm';

/** Text names the state; the dot and colour reinforce it visually. */
@Component({
  selector: 'app-status-pill',
  template: '<span class="dot" aria-hidden="true"></span><span>{{ label() }}</span>',
  styles: `
    :host {
      --pill-ink: var(--tb-muted);
      --pill-fill: var(--tb-surface-2);
      align-items: center;
      background: var(--pill-fill);
      border-radius: 999px;
      color: var(--pill-ink);
      display: inline-flex;
      font-size: var(--text-metadata-size);
      font-weight: 600;
      gap: var(--space-8);
      line-height: var(--text-metadata-line-height);
      max-inline-size: 100%;
      overflow-wrap: anywhere;
      padding: var(--space-4) var(--space-12);
      vertical-align: middle;
    }

    :host(.success) {
      --pill-ink: var(--tb-success);
      --pill-fill: var(--tb-success-soft);
    }
    :host(.warning) {
      --pill-ink: var(--tb-warning);
      --pill-fill: var(--tb-warning-soft);
    }
    :host(.danger) {
      --pill-ink: var(--tb-danger);
      --pill-fill: var(--tb-danger-soft);
    }
    :host(.info) {
      --pill-ink: var(--tb-info);
      --pill-fill: var(--tb-info-soft);
    }
    :host(.warm) {
      --pill-ink: var(--tb-warm-ink);
      --pill-fill: var(--tb-warm-soft);
    }

    .dot {
      background: currentColor;
      block-size: 6px;
      border-radius: 50%;
      flex: none;
      inline-size: 6px;
    }

    @media (forced-colors: active) {
      :host {
        border: 1px solid CanvasText;
      }
    }
  `,
  host: {
    '[class.success]': "tone() === 'success'",
    '[class.warning]': "tone() === 'warning'",
    '[class.danger]': "tone() === 'danger'",
    '[class.info]': "tone() === 'info'",
    '[class.warm]': "tone() === 'warm'",
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatusPill {
  readonly label = input.required<string>();
  readonly tone = input<StatusPillTone>('neutral');
}
