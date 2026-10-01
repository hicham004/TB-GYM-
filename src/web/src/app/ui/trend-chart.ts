import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';

export interface TrendPoint {
  date: string;
  value: number | null;
  estimate: number | null;
}

export interface TrendWeek {
  from: string;
  toExclusive: string;
  mean: number | null;
  observedDays: number;
}

interface ChartMark {
  x: number;
  y: number;
}

/**
 * A trend line and weekly averages say nothing about one or two weigh-ins, so below this the chart
 * shows the readings themselves, compactly, and says how many more it needs.
 */
export const TREND_MINIMUM_OBSERVATIONS = 3;

// The SVG's own coordinate space. Dots are placed as a share of it (see `dotLeft`, `dotTop`).
const WIDTH = 720;
const HEIGHT = 240;

@Component({
  selector: 'app-trend-chart',
  imports: [DatePipe, DecimalPipe],
  template: `
    <div class="trend-chart">
      @if (hasData()) {
        @if (readings(); as pair) {
          <div class="readings">
            <p>
              <span class="reading-date">{{ pair.first.date | date: 'd MMM' }}</span>
              <span class="reading-value"
                >{{ pair.first.value | number: '1.0-2' }} {{ unit() }}</span
              >
            </p>
            <span class="change"
              >{{ pair.delta > 0 ? '+' : pair.delta < 0 ? '−' : ''
              }}{{ abs(pair.delta) | number: '1.0-2' }} {{ unit() }}</span
            >
            <p class="end">
              <span class="reading-date">{{ pair.last.date | date: 'd MMM' }}</span>
              <span class="reading-value"
                >{{ pair.last.value | number: '1.0-2' }} {{ unit() }}</span
              >
            </p>
          </div>
        }
        <div class="plot" [class.compact]="sparse()">
          <svg
            [attr.viewBox]="'0 0 ' + width + ' ' + height"
            role="img"
            [attr.aria-label]="chartLabel()"
            preserveAspectRatio="none"
          >
            @if (sparse()) {
              <path [attr.d]="connection()" class="trend-line" />
            } @else {
              @for (band of bands(); track band.from) {
                <line
                  [attr.x1]="band.x1"
                  [attr.x2]="band.x2"
                  [attr.y1]="band.y"
                  [attr.y2]="band.y"
                  class="week-band"
                />
              }
              <path [attr.d]="line()" class="trend-line" />
            }
          </svg>
          <!-- Plain elements, not circles: the SVG stretches to its box, and a stretched circle is
               an ellipse. -->
          @for (mark of observations(); track mark.x) {
            <i
              class="observation"
              aria-hidden="true"
              [style.left.%]="dotLeft(mark)"
              [style.top.%]="dotTop(mark)"
            ></i>
          }
        </div>
        @if (sparse()) {
          <p class="hint">
            @if (audience() === 'coach') {
              <ng-container i18n>A trend line needs at least 3 weigh-ins.</ng-container>
            } @else {
              <ng-container i18n
                >Log
                {missing(), plural, =1 {1 more weigh-in} other {{{ missing() }} more weigh-ins}} to
                see your trend line.</ng-container
              >
            }
          </p>
        }
        <div class="legend">
          @if (!sparse()) {
            <span><i class="trend-key"></i><ng-container i18n>Trend estimate</ng-container></span
            ><span><i class="week-key"></i><ng-container i18n>Weekly average</ng-container></span>
          }
          <span><i class="dot-key"></i><ng-container i18n>Weigh-in</ng-container></span>
        </div>
      } @else {
        <p class="empty" i18n>Log a few weights to see your trend.</p>
      }
      <details>
        <summary i18n>Chart values</summary>
        <table>
          <caption>
            <ng-container i18n>Bodyweight observations and trend estimates</ng-container>
            ({{
              unit()
            }})
          </caption>
          <thead>
            <tr>
              <th i18n>Date</th>
              <th i18n>Weight</th>
              <th i18n>Trend</th>
            </tr>
          </thead>
          <tbody>
            @for (point of visibleRows(); track point.date) {
              <tr>
                <th>{{ point.date }}</th>
                <td>{{ point.value ?? '—' }}</td>
                <td>{{ point.estimate ?? '—' }}</td>
              </tr>
            }
          </tbody>
        </table>
      </details>
    </div>
  `,
  styles: [
    `
      :host {
        /* Darker than the accent, so the average reads on a white card: at least 3:1 on the light
           surface for TB Gym's own brand. */
        --week-average: color-mix(in srgb, var(--tb-accent, #d9ed94) 40%, var(--tb-brand, #153d33));
        display: block;
      }
      .trend-chart {
        border-radius: 1rem;
        padding: 1rem;
        background: var(--tb-surface, #fff);
        color: var(--tb-ink, #182d27);
      }
      .plot {
        block-size: 14rem;
        position: relative;
      }
      .plot.compact {
        block-size: 5.5rem;
      }
      svg {
        block-size: 100%;
        display: block;
        inline-size: 100%;
        overflow: visible;
      }
      .week-band {
        stroke: var(--week-average);
        stroke-dasharray: 7 5;
        stroke-width: 3;
        vector-effect: non-scaling-stroke;
      }
      .trend-line {
        fill: none;
        stroke: var(--tb-brand, #153d33);
        stroke-width: 3;
        stroke-linecap: round;
        stroke-linejoin: round;
        vector-effect: non-scaling-stroke;
      }
      .observation {
        background: var(--tb-brand, #153d33);
        block-size: 0.6rem;
        border-radius: 50%;
        inline-size: 0.6rem;
        position: absolute;
        transform: translate(-50%, -50%);
      }
      .readings {
        align-items: end;
        display: grid;
        gap: 0.5rem;
        grid-template-columns: 1fr auto 1fr;
        margin-block-end: 0.75rem;
      }
      .readings p {
        display: grid;
        gap: 0.1rem;
        margin: 0;
      }
      .readings .end {
        text-align: end;
      }
      .reading-date {
        color: var(--tb-muted, #4f6057);
        font-size: 0.78rem;
      }
      .reading-value {
        font-size: 1.25rem;
        font-variant-numeric: tabular-nums;
        font-weight: 600;
      }
      .change {
        background: color-mix(in srgb, var(--tb-accent, #d9ed94) 45%, transparent);
        border-radius: 99px;
        color: var(--tb-brand, #153d33);
        font-size: 0.84rem;
        font-variant-numeric: tabular-nums;
        font-weight: 700;
        padding: 0.3rem 0.65rem;
      }
      .hint {
        background: var(--tb-surface-2, #f3f1e7);
        border-radius: 0.75rem;
        font-size: 0.875rem;
        margin: 0.75rem 0 0;
        padding: 0.6rem 0.8rem;
      }
      .legend {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem 1rem;
        font-size: 0.75rem;
        color: var(--tb-muted, #4f6057);
        margin-block-start: 0.75rem;
      }
      .legend span {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
      }
      .legend i {
        display: inline-block;
        flex: none;
      }
      .trend-key {
        background: var(--tb-brand, #153d33);
        block-size: 0.25rem;
        border-radius: 1rem;
        inline-size: 1rem;
      }
      .week-key {
        block-size: 0;
        border-block-start: 3px dashed var(--week-average);
        inline-size: 1rem;
      }
      .dot-key {
        background: var(--tb-brand, #153d33);
        block-size: 0.6rem;
        border-radius: 50%;
        inline-size: 0.6rem;
      }
      details {
        margin-block-start: 0.6rem;
        font-size: 0.8rem;
        max-inline-size: 100%;
        overflow-x: auto;
      }
      summary {
        cursor: pointer;
        min-block-size: 2rem;
      }
      table {
        display: block;
        max-inline-size: 100%;
        overflow-x: auto;
        border-collapse: collapse;
        text-align: start;
      }
      th,
      td {
        padding: 0.25rem;
        border-block-end: 1px solid #d9dfd1;
        text-align: start;
      }
      .empty {
        margin: 0;
        padding: 2rem;
        text-align: center;
      }
    `,
  ],
})
export class TrendChart {
  readonly points = input.required<readonly TrendPoint[]>();
  readonly weeks = input.required<readonly TrendWeek[]>();
  readonly unit = input('kg');
  /** Who is looking: the client is asked to log more, the coach is only told what is needed. */
  readonly audience = input<'self' | 'coach'>('self');
  protected readonly width = WIDTH;
  protected readonly height = HEIGHT;
  protected readonly abs = Math.abs;

  readonly hasData = computed(() =>
    this.points().some((point) => point.value !== null || point.estimate !== null),
  );
  private readonly observed = computed(() =>
    this.points().flatMap((point, index) =>
      point.value === null ? [] : [{ index, date: point.date, value: point.value }],
    ),
  );
  /** One or two weigh-ins: too few for a trend, so the chart shows only the readings. */
  readonly sparse = computed(
    () => this.observed().length > 0 && this.observed().length < TREND_MINIMUM_OBSERVATIONS,
  );
  protected readonly missing = computed(() => TREND_MINIMUM_OBSERVATIONS - this.observed().length);
  /** The two readings and the change between them, when there are exactly two. */
  protected readonly readings = computed(() => {
    const observed = this.observed();
    if (!this.sparse() || observed.length !== 2) return null;
    const [first, last] = observed;
    // Rounded to what is shown, so float noise (82.3 - 81.9) never prints a sign beside "0".
    return { first, last, delta: Math.round((last.value - first.value) * 100) / 100 };
  });
  protected readonly chartLabel = computed(() =>
    this.sparse()
      ? $localize`Bodyweight readings`
      : $localize`Bodyweight trend with weekly averages`,
  );

  private readonly scale = computed(() => {
    const values = this.sparse()
      ? this.observed().map((entry) => entry.value)
      : [
          ...this.points().flatMap((point) => [point.value, point.estimate]),
          ...this.weeks().map((week) => week.mean),
        ].filter((value): value is number => value !== null);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const padding = Math.max(1, (max - min) * 0.15);
    return { min: min - padding, max: max + padding };
  });
  private x(index: number): number {
    return 16 + (688 * index) / Math.max(1, this.points().length - 1);
  }
  private y(value: number): number {
    const { min, max } = this.scale();
    return 220 - (200 * (value - min)) / (max - min);
  }
  protected dotLeft(mark: ChartMark): number {
    return (100 * mark.x) / WIDTH;
  }
  protected dotTop(mark: ChartMark): number {
    return (100 * mark.y) / HEIGHT;
  }
  readonly observations = computed<ChartMark[]>(() =>
    this.observed().map((entry) => ({ x: this.x(entry.index), y: this.y(entry.value) })),
  );
  /** A plain line from one reading to the next. It claims no trend, so it is drawn only when sparse. */
  protected readonly connection = computed(() =>
    this.observations()
      .map((mark, index) => `${index === 0 ? 'M' : 'L'}${mark.x.toFixed(1)} ${mark.y.toFixed(1)}`)
      .join(' '),
  );
  readonly line = computed(() => {
    const points = this.points().map((point, index) =>
      point.estimate === null ? null : { x: this.x(index), y: this.y(point.estimate) },
    );
    const segments: string[] = [];
    let drawing = false;
    for (const point of points) {
      if (point === null) {
        drawing = false;
        continue;
      }
      segments.push(`${drawing ? 'L' : 'M'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`);
      drawing = true;
    }
    return segments.join(' ');
  });
  readonly bands = computed(() => {
    return this.weeks().flatMap((week) => {
      if (week.mean === null) return [];
      const positions = this.points().flatMap((point, position) =>
        point.date >= week.from && point.date < week.toExclusive ? [position] : [],
      );
      if (!positions.length) return [];
      return [
        {
          from: week.from,
          x1: this.x(positions[0]),
          x2: this.x(positions.at(-1)!),
          y: this.y(week.mean),
        },
      ];
    });
  });
  readonly visibleRows = computed(() =>
    this.points().filter((point) => point.value !== null || point.estimate !== null),
  );
}
