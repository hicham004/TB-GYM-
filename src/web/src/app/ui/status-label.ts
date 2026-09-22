import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Icon } from './icon';

export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger';
/** Dot for most states; the check-circle only where the state is a completed or positive one. */
export type StatusMarker = 'dot' | 'check';

/**
 * Feedback/Status label: compact, uncontained status text. The label is required and always
 * rendered, because the text carries the meaning; tone colours only the marker, which is
 * decorative. It is plain text, not a live region — a status that changes while the user watches
 * needs its own announcement.
 */
@Component({
  selector: 'app-status-label',
  imports: [Icon],
  template: `
    @if (marker() === 'check') {
      <app-icon class="marker" name="check-circle" />
    } @else {
      <span class="marker dot" aria-hidden="true"></span>
    }
    <span class="label">{{ label() }}</span>
  `,
  styles: `
    :host {
      --status-tone: var(--color-text-secondary);
      align-items: start;
      color: var(--color-text-secondary);
      display: inline-flex;
      font-size: var(--text-metadata-size);
      font-weight: var(--font-weight-strong);
      gap: var(--space-8);
      line-height: var(--text-metadata-line-height);
      max-inline-size: 100%;
      vertical-align: middle;
    }

    :host(.tone-success) {
      --status-tone: var(--color-success);
    }

    :host(.tone-warning) {
      --status-tone: var(--color-warning);
    }

    :host(.tone-danger) {
      --status-tone: var(--color-danger);
    }

    .marker {
      color: var(--status-tone);
    }

    /* Centred on the first line, so a wrapped label keeps its marker beside line one. */
    .dot {
      background-color: var(--status-tone);
      block-size: 7px;
      border-radius: var(--radius-full);
      flex: none;
      inline-size: 7px;
      margin-block: calc((var(--text-metadata-line-height) - 7px) / 2);
    }

    .label {
      min-inline-size: 0;
      overflow-wrap: anywhere;
    }

    @media (forced-colors: active) {
      .dot {
        background-color: CanvasText;
        forced-color-adjust: none;
      }
    }
  `,
  host: {
    '[class.tone-success]': "tone() === 'success'",
    '[class.tone-warning]': "tone() === 'warning'",
    '[class.tone-danger]': "tone() === 'danger'",
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatusLabel {
  readonly label = input.required<string>();
  readonly tone = input<StatusTone>('neutral');
  readonly marker = input<StatusMarker>('dot');
}
