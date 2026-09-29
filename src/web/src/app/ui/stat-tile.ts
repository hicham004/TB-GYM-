import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Card } from './card';
import { Sparkline } from './sparkline';

export interface StatTrend {
  values: readonly number[];
  summary: string;
}

/** A metric with its comparison stated in text; optional trend or projected accessory. */
@Component({
  selector: 'app-stat-tile',
  imports: [Card, Sparkline],
  template: `
    <app-card>
      <div class="layout">
        <div class="copy">
          <span class="label">{{ label() }}</span>
          <strong class="value">{{ value() }}</strong>
          <span class="context">{{ context() }}</span>
        </div>
        @if (trend(); as chart) {
          <app-sparkline [values]="chart.values" [summary]="chart.summary" />
        } @else {
          <ng-content select="[stat-tile-accessory]" />
        }
      </div>
    </app-card>
  `,
  styles: `
    :host {
      display: block;
      min-inline-size: 0;
    }
    app-card {
      block-size: 100%;
    }
    .layout {
      align-items: end;
      display: flex;
      gap: var(--space-12);
      justify-content: space-between;
      min-inline-size: 0;
    }
    .copy {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-inline-size: 0;
    }
    .label {
      color: var(--tb-muted);
      font-size: var(--text-metadata-size);
      font-weight: 600;
      letter-spacing: 0.08em;
      line-height: var(--text-metadata-line-height);
      text-transform: uppercase;
    }
    .label:lang(ar) {
      letter-spacing: 0;
      text-transform: none;
    }
    .value {
      color: var(--tb-ink);
      font-size: clamp(2rem, 4vw, 2.5rem);
      font-variant-numeric: tabular-nums;
      font-weight: 600;
      line-height: 1.1;
      margin-block-start: var(--space-8);
      overflow-wrap: anywhere;
    }
    .context {
      color: var(--tb-muted);
      font-size: var(--text-metadata-size);
      line-height: 1.4;
      margin-block-start: var(--space-8);
      overflow-wrap: anywhere;
    }
    app-sparkline {
      flex: 0 1 120px;
      inline-size: 120px;
      max-inline-size: 40%;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatTile {
  readonly label = input.required<string>();
  readonly value = input.required<string | number>();
  readonly context = input.required<string>();
  readonly trend = input<StatTrend | null>(null);
}
