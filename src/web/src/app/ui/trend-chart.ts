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

@Component({
  selector: 'app-trend-chart',
  template: `
    <div class="trend-chart">
      @if (hasData()) {
        <svg
          viewBox="0 0 720 240"
          role="img"
          aria-label="Bodyweight trend with weekly averages"
          preserveAspectRatio="none"
        >
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
          @for (mark of observations(); track mark.x) {
            <circle [attr.cx]="mark.x" [attr.cy]="mark.y" r="4" class="observation" />
          }
        </svg>
        <div class="legend">
          <span><i class="trend-key"></i>Trend estimate</span
          ><span><i class="week-key"></i>Weekly average</span
          ><span><i class="dot-key"></i>Weigh-in</span>
        </div>
      } @else {
        <p class="empty">Log a few weights to see your trend.</p>
      }
      <details>
        <summary>Chart values</summary>
        <table>
          <caption>
            Bodyweight observations and trend estimates ({{
              unit()
            }})
          </caption>
          <thead>
            <tr>
              <th>Date</th>
              <th>Weight</th>
              <th>Trend</th>
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
        display: block;
      }
      .trend-chart {
        border-radius: 1rem;
        padding: 1rem;
        background: var(--tb-surface, #fff);
        color: var(--tb-ink, #182d27);
      }
      svg {
        inline-size: 100%;
        block-size: 14rem;
        overflow: visible;
      }
      .week-band {
        stroke: var(--tb-accent, #a2bd56);
        stroke-width: 9;
        stroke-linecap: round;
        opacity: 0.55;
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
        fill: var(--tb-brand, #153d33);
      }
      .legend {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem 1rem;
        font-size: 0.75rem;
        color: var(--tb-muted, #4f6057);
      }
      .legend span {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
      }
      .legend i {
        display: inline-block;
        inline-size: 0.8rem;
        block-size: 0.3rem;
        border-radius: 1rem;
      }
      .trend-key {
        background: var(--tb-brand, #153d33);
      }
      .week-key {
        background: var(--tb-accent, #a2bd56);
      }
      .dot-key {
        background: var(--tb-brand, #153d33);
        block-size: 0.6rem !important;
        inline-size: 0.6rem !important;
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
  readonly hasData = computed(() =>
    this.points().some((point) => point.value !== null || point.estimate !== null),
  );

  private readonly scale = computed(() => {
    const values = [
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
  readonly observations = computed<ChartMark[]>(() =>
    this.points().flatMap((point, index) =>
      point.value === null ? [] : [{ x: this.x(index), y: this.y(point.value) }],
    ),
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
