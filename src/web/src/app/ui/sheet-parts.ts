import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Button } from './button';

/**
 * The foot of a form in a sheet: Not now, and the one action. It stays in view while a long form
 * scrolls. Shared by the weigh-in, measurement and photo sheets (R5.3c) and the nutrition sheets (R5.3d).
 */
@Component({
  selector: 'app-entry-actions',
  imports: [Button],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="actions">
      <button appButton type="button" variant="text" (click)="notNow.emit()">
        {{ cancelLabel() }}
      </button>
      <button appButton type="submit" [loading]="busy()">
        @if (busy()) {
          {{ busyLabel() }}
        } @else {
          {{ saveLabel() }}
        }
      </button>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .actions {
      background: var(--tb-surface);
      border-block-start: 1px solid var(--tb-line);
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      inset-block-end: -1.5rem;
      justify-content: flex-end;
      margin-block-end: -1.5rem;
      margin-inline: -1.5rem;
      padding: 0.75rem 1.5rem;
      position: sticky;
    }
  `,
})
export class EntryActions {
  readonly saveLabel = input.required<string>();
  readonly busyLabel = input.required<string>();
  readonly busy = input(false);
  readonly cancelLabel = input($localize`Not now`);
  readonly notNow = output<void>();
}

/** A form in a sheet's own look: a column of fields, the quiet text, and a problem in a tinted box. */
export const SHEET_STYLES = `
  :host {
    display: block;
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  p {
    color: var(--tb-ink);
    margin: 0;
    overflow-wrap: anywhere;
  }

  .muted {
    color: var(--tb-muted);
    font-size: 0.875rem;
  }

  .about {
    background: var(--tb-surface-2);
    border-radius: var(--tb-radius-control);
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    padding: 0.75rem 0.875rem;
  }

  .about strong {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }

  .value-unit {
    align-items: start;
    display: grid;
    gap: 0.5rem;
    grid-template-columns: minmax(0, 1fr) minmax(0, 10rem);
  }

  @media (max-width: 26rem) {
    .value-unit {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  .problem-text {
    background: var(--tb-danger-soft);
    border-radius: var(--tb-radius-control);
    color: var(--tb-danger);
    font-weight: 600;
    padding: 0.625rem 0.875rem;
    // Scrolled into view clear of the sticky action bar below it.
    scroll-margin-block-end: 5rem;
  }

  // A focused box scrolls clear of the sticky action bar at the sheet's foot.
  input,
  textarea,
  button {
    scroll-margin-block-end: 5rem;
  }
`;
