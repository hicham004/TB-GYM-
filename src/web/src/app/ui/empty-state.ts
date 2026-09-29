import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** An invitation with one projected action; the default illustration is decorative. */
@Component({
  selector: 'app-empty-state',
  template: `
    <div class="art" aria-hidden="true">
      <ng-content select="[empty-state-art]">
        <svg viewBox="0 0 80 80" focusable="false">
          <rect x="13" y="18" width="54" height="48" rx="10" fill="var(--tb-accent-soft)" />
          <path
            d="M24 34h32M24 44h23M24 54h15"
            stroke="var(--tb-accent-ink)"
            stroke-width="3"
            stroke-linecap="round"
          />
          <circle cx="61" cy="19" r="9" fill="var(--tb-accent)" />
        </svg>
      </ng-content>
    </div>
    <h2>{{ heading() }}</h2>
    <p>{{ description() }}</p>
    <div class="action"><ng-content select="[empty-state-action]" /></div>
  `,
  styles: `
    :host {
      align-items: center;
      color: var(--tb-ink);
      display: flex;
      flex-direction: column;
      min-inline-size: 0;
      padding: var(--space-32) var(--space-16);
      text-align: center;
    }

    .art {
      block-size: 80px;
      inline-size: 80px;
      margin-block-end: var(--space-16);
    }

    svg {
      block-size: 100%;
      inline-size: 100%;
    }

    h2 {
      font-family: var(--tb-font-serif);
      font-size: clamp(1.5rem, 3vw, 2rem);
      font-style: italic;
      font-weight: 400;
      line-height: 1.2;
      margin: 0;
      overflow-wrap: anywhere;
    }

    p {
      color: var(--tb-muted);
      line-height: var(--text-body-line-height);
      margin: var(--space-8) 0 0;
      max-inline-size: 32rem;
      overflow-wrap: anywhere;
    }

    .action {
      margin-block-start: var(--space-24);
    }
    .action:empty {
      display: none;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmptyState {
  readonly heading = input.required<string>();
  readonly description = input.required<string>();
}
