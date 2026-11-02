import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

const CIRCUMFERENCE = 2 * Math.PI * 26;

/**
 * A bounded metric with native progress semantics and a visible text value. The fill's offset is a
 * custom property, so the stylesheet can sweep it (W9); the circumference is written there too.
 */
@Component({
  selector: 'app-progress-ring',
  template: `
    <span class="graphic">
      <svg
        viewBox="0 0 64 64"
        role="progressbar"
        [attr.aria-label]="label()"
        aria-valuemin="0"
        [attr.aria-valuemax]="safeMax()"
        [attr.aria-valuenow]="safeValue()"
        [attr.aria-valuetext]="displayValue()"
        focusable="false"
      >
        <circle class="track" cx="32" cy="32" r="26" />
        <circle
          class="fill"
          cx="32"
          cy="32"
          r="26"
          [attr.stroke-dasharray]="circumference"
          [style.--offset]="dashOffset()"
        />
      </svg>
      <strong aria-hidden="true">{{ percent() }}%</strong>
    </span>
    <span class="caption" aria-hidden="true">
      {{ label() }}
      @if (valueText()) {
        <small>{{ valueText() }}</small>
      }
    </span>
  `,
  styles: `
    :host {
      align-items: center;
      color: var(--tb-ink);
      display: inline-flex;
      flex-direction: column;
      gap: var(--space-8);
      max-inline-size: 100%;
      text-align: center;
      vertical-align: middle;
    }

    .graphic {
      block-size: 72px;
      display: grid;
      inline-size: 72px;
      place-items: center;
    }
    svg,
    strong {
      grid-area: 1 / 1;
    }
    svg {
      block-size: 100%;
      inline-size: 100%;
      transform: rotate(-90deg);
    }
    circle {
      fill: none;
      stroke-width: 6;
    }
    .track {
      stroke: var(--tb-surface-2);
    }
    .fill {
      stroke: var(--tb-accent-ink);
      stroke-dashoffset: var(--offset);
      stroke-linecap: round;
    }
    // The ring sweeps to a new value and draws in on first paint (motion plan W9); with reduced
    // motion or the switch on (data-tb-motion, core/motion) it rests at its value.
    @media (prefers-reduced-motion: no-preference) {
      :host-context(html:not([data-tb-motion='off'])) .fill {
        transition: stroke-dashoffset 600ms var(--tb-ease);
      }
      @starting-style {
        :host-context(html:not([data-tb-motion='off'])) .fill {
          stroke-dashoffset: 163.36;
        }
      }
    }
    strong {
      font-size: 1rem;
      font-variant-numeric: tabular-nums;
      font-weight: 600;
    }
    .caption {
      color: var(--tb-ink);
      font-size: 0.875rem;
      font-weight: 600;
      line-height: 1.3;
      overflow-wrap: anywhere;
    }
    small {
      color: var(--tb-muted);
      display: block;
      font-size: 0.8125rem;
      font-variant-numeric: tabular-nums;
      font-weight: 400;
    }
    @media (forced-colors: active) {
      .track {
        stroke: GrayText;
      }
      .fill {
        stroke: Highlight;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProgressRing {
  readonly value = input.required<number>();
  readonly max = input(100);
  readonly label = input.required<string>();
  readonly valueText = input<string | null>(null);
  protected readonly circumference = CIRCUMFERENCE;
  protected readonly safeMax = computed(() =>
    Number.isFinite(this.max()) && this.max() > 0 ? this.max() : 100,
  );
  protected readonly safeValue = computed(() =>
    Number.isFinite(this.value()) ? Math.min(this.safeMax(), Math.max(0, this.value())) : 0,
  );
  protected readonly percent = computed(() =>
    Math.round((100 * this.safeValue()) / this.safeMax()),
  );
  protected readonly dashOffset = computed(() =>
    (CIRCUMFERENCE * (1 - this.safeValue() / this.safeMax())).toFixed(2),
  );
  protected readonly displayValue = computed(() => this.valueText() ?? `${this.percent()}%`);
}
