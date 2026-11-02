import { DatePipe, DecimalPipe, formatDate, formatNumber } from '@angular/common';
import { Component, computed, inject, input, LOCALE_ID, signal } from '@angular/core';
import { UiDisclosure, UiDisclosureContent } from './disclosure';

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
 * A day the scrub can rest on (motion plan W13): a weigh-in, or in the full chart a day with the
 * trend's estimate alone, which reads as the trend's.
 */
export interface TrendReading {
  index: number;
  date: string;
  value: number;
  estimate: boolean;
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
  imports: [DatePipe, DecimalPipe, UiDisclosure, UiDisclosureContent],
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
            <p class="end" [class.scrubbed]="pair.scrubbed">
              <span class="reading-date">{{
                pair.last.date | date: (pair.scrubbed ? 'EEE d MMM' : 'd MMM')
              }}</span>
              <span class="reading-value">
                @if (pair.last.estimate) {
                  <span class="estimate-mark" i18n>trend</span>
                }
                {{ pair.last.value | number: '1.0-2' }} {{ unit() }}</span
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
            @if (cursorMark(); as mark) {
              <line [attr.x1]="mark.x" [attr.x2]="mark.x" y1="0" [attr.y2]="height" class="guide" />
            }
            @if (sparse()) {
              <path [attr.d]="connection()" class="trend-line" />
            } @else {
              <path [attr.d]="area()" class="trend-area" />
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
          <!-- The scrub (W13): a finger, the mouse or the arrow keys rest on the nearest day and
               the readings' last reading becomes that day's; release returns to the latest. The
               slider sits over the plot so the chart keeps its own name. -->
          @if (scrubbable()) {
            <div
              class="scrub"
              role="slider"
              tabindex="0"
              [attr.aria-label]="scrubLabel"
              aria-valuemin="0"
              [attr.aria-valuemax]="readable().length - 1"
              [attr.aria-valuenow]="valueNow()"
              [attr.aria-valuetext]="valueText()"
              (pointerdown)="scrubStart($event)"
              (pointermove)="scrubMove($event)"
              (pointerup)="scrubEnd($event)"
              (pointercancel)="scrubEnd($event)"
              (lostpointercapture)="scrubEnd($event)"
              (keydown)="scrubKey($event)"
              (blur)="cursor.set(null)"
            >
              @if (cursorMark(); as mark) {
                <i
                  class="cursor"
                  aria-hidden="true"
                  [style.left.%]="dotLeft(mark)"
                  [style.top.%]="dotTop(mark)"
                ></i>
              }
            </div>
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
      <app-disclosure class="values" label="Chart values" i18n-label>
        <ng-template appDisclosureContent>
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
        </ng-template>
      </app-disclosure>
    </div>
  `,
  styles: [
    `
      :host {
        /* The weekly average's line is a mode token (darker than the accent on light, lighter on
           dark), and the trend and weigh-ins use the accent as ink: the brand on light, the bright
           accent on dark, so the chart reads on both. */
        --week-average: var(--tb-chart-band, #5f8b5c);
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
        stroke: var(--tb-accent-ink, #153d33);
        stroke-width: 3;
        stroke-linecap: round;
        stroke-linejoin: round;
        vector-effect: non-scaling-stroke;
      }
      .trend-area {
        fill: var(--tb-accent-soft, #d9ed944d);
        stroke: none;
      }
      .guide {
        stroke: var(--tb-muted, #4f6057);
        stroke-dasharray: 4 4;
        stroke-width: 1;
        vector-effect: non-scaling-stroke;
      }
      .observation {
        background: var(--tb-accent-ink, #153d33);
        block-size: 0.6rem;
        border-radius: 50%;
        inline-size: 0.6rem;
        position: absolute;
        transform: translate(-50%, -50%);
      }
      /* The slider over the plot: a vertical move is the page's scroll, a sideways one the scrub. */
      .scrub {
        border-radius: 0.5rem;
        cursor: crosshair;
        inset: 0;
        position: absolute;
        touch-action: pan-y;
        user-select: none;
        -webkit-user-select: none;
      }
      .scrub:focus-visible {
        outline: 3px solid var(--tb-focus, #153d33);
        outline-offset: 3px;
      }
      .cursor {
        background: var(--tb-accent-ink, #153d33);
        block-size: 1rem;
        border-radius: 50%;
        box-shadow:
          0 0 0 3px var(--tb-surface, #fff),
          0 0 0 5px var(--tb-accent-ink, #153d33);
        inline-size: 1rem;
        pointer-events: none;
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
      .end.scrubbed .reading-date {
        color: var(--tb-accent-ink, #153d33);
        font-weight: 600;
      }
      .reading-value {
        font-size: 1.25rem;
        font-variant-numeric: tabular-nums;
        font-weight: 600;
      }
      .estimate-mark {
        color: var(--tb-muted, #4f6057);
        font-size: 0.7rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .change {
        background: var(--tb-accent, #d9ed94);
        border-radius: 99px;
        color: var(--tb-on-accent, #11201b);
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
        background: var(--tb-accent-ink, #153d33);
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
        background: var(--tb-accent-ink, #153d33);
        block-size: 0.6rem;
        border-radius: 50%;
        inline-size: 0.6rem;
      }
      .values {
        margin-block-start: 0.6rem;
      }
      table {
        font-size: 0.8rem;
        display: block;
        max-inline-size: 100%;
        overflow-x: auto;
        border-collapse: collapse;
        text-align: start;
      }
      th,
      td {
        padding: 0.25rem;
        border-block-end: 1px solid var(--tb-line, #d9dfd1);
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
  private readonly locale = inject(LOCALE_ID);
  protected readonly width = WIDTH;
  protected readonly height = HEIGHT;
  protected readonly abs = Math.abs;
  protected readonly scrubLabel = $localize`Weigh-in to read`;

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

  /**
   * The days the scrub rests on, in order: the weigh-ins, and in the full chart the days the trend
   * estimates alone (a compact chart of two readings has nothing between them).
   */
  readonly readable = computed<TrendReading[]>(() =>
    this.sparse()
      ? this.observed().map((entry): TrendReading => ({ ...entry, estimate: false }))
      : this.points().flatMap((point, index): TrendReading[] =>
          point.value !== null
            ? [{ index, date: point.date, value: point.value, estimate: false }]
            : point.estimate !== null
              ? [{ index, date: point.date, value: point.estimate, estimate: true }]
              : [],
        ),
  );
  /** Where the scrub rests, as a place in `readable`; null at rest, which reads the latest. */
  protected readonly cursor = signal<number | null>(null);
  private pointerId: number | null = null;
  protected readonly scrubbable = computed(() => this.readable().length >= 2);
  protected readonly scrubbed = computed(() => {
    const cursor = this.cursor();
    return cursor === null ? null : (this.readable()[cursor] ?? null);
  });
  protected readonly valueNow = computed(() => this.cursor() ?? this.readable().length - 1);
  /** "Tue 14 Oct · 71.2 kg", or the trend's estimate marked as such: what the slider says. */
  protected readonly valueText = computed(() => {
    const reading = this.readable()[this.valueNow()];
    if (!reading) return '';
    const value = `${formatNumber(reading.value, this.locale, '1.0-2')} ${this.unit()}`;
    return `${formatDate(reading.date, 'EEE d MMM', this.locale)} · ${
      reading.estimate ? `${$localize`trend`} ${value}` : value
    }`;
  });
  /**
   * The first weigh-in, the latest (or the day the scrub rests on) and the change between them,
   * from two weigh-ins up; a single weigh-in has nothing to compare.
   */
  protected readonly readings = computed(() => {
    const observed = this.observed();
    if (observed.length < 2) return null;
    const first = observed[0];
    const scrub = this.scrubbed();
    const last = scrub ?? { ...observed[observed.length - 1], estimate: false };
    // Rounded to what is shown, so float noise (82.3 - 81.9) never prints a sign beside "0".
    return {
      first,
      last,
      scrubbed: scrub !== null,
      delta: Math.round((last.value - first.value) * 100) / 100,
    };
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
  /** The dot and the guide where the scrub rests. */
  protected readonly cursorMark = computed<ChartMark | null>(() => {
    const reading = this.scrubbed();
    return reading ? { x: this.x(reading.index), y: this.y(reading.value) } : null;
  });
  /** A plain line from one reading to the next. It claims no trend, so it is drawn only when sparse. */
  protected readonly connection = computed(() =>
    this.observations()
      .map((mark, index) => `${index === 0 ? 'M' : 'L'}${mark.x.toFixed(1)} ${mark.y.toFixed(1)}`)
      .join(' '),
  );
  /** The trend's runs: consecutive days with an estimate, a gap starting a new run. */
  private readonly runs = computed<ChartMark[][]>(() => {
    const runs: ChartMark[][] = [];
    let run: ChartMark[] = [];
    this.points().forEach((point, index) => {
      if (point.estimate === null) {
        if (run.length) runs.push(run);
        run = [];
        return;
      }
      run.push({ x: this.x(index), y: this.y(point.estimate) });
    });
    if (run.length) runs.push(run);
    return runs;
  });
  readonly line = computed(() =>
    this.runs()
      .map((run) =>
        run
          .map(
            (mark, index) => `${index === 0 ? 'M' : 'L'}${mark.x.toFixed(1)} ${mark.y.toFixed(1)}`,
          )
          .join(' '),
      )
      .join(' '),
  );
  /** The soft area under the trend, down to the plot's floor, one shape per run. */
  readonly area = computed(() =>
    this.runs()
      .filter((run) => run.length > 1)
      .map(
        (run) =>
          `M${run[0].x.toFixed(1)} ${HEIGHT} ${run
            .map((mark) => `L${mark.x.toFixed(1)} ${mark.y.toFixed(1)}`)
            .join(' ')} L${run[run.length - 1].x.toFixed(1)} ${HEIGHT} Z`,
      )
      .join(' '),
  );
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

  /** A finger or the mouse lands on the plot: the pointer is held and the nearest day read. */
  protected scrubStart(event: PointerEvent): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const target = event.currentTarget as HTMLElement;
    this.pointerId = event.pointerId;
    // jsdom has no pointer capture; a browser keeps the moves coming once the finger leaves the plot.
    if (typeof target.setPointerCapture === 'function') target.setPointerCapture(event.pointerId);
    this.scrubTo(event.clientX, target);
  }

  protected scrubMove(event: PointerEvent): void {
    if (event.pointerId !== this.pointerId) return;
    this.scrubTo(event.clientX, event.currentTarget as HTMLElement);
  }

  /** Release (or the page taking the touch to scroll) returns the reading to the latest. */
  protected scrubEnd(event: PointerEvent): void {
    if (event.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.cursor.set(null);
  }

  /** Arrow keys step a day, Home and End go to the first and the latest. */
  protected scrubKey(event: KeyboardEvent): void {
    const last = this.readable().length - 1;
    const now = this.valueNow();
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        next = Math.min(last, now + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        next = Math.max(0, now - 1);
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    this.cursor.set(next);
  }

  /**
   * Maps the pointer onto the plot's drawn width (the SVG is drawn left to right whatever the
   * page's direction) and rests on the nearest day.
   */
  private scrubTo(clientX: number, target: HTMLElement): void {
    const rect = target.getBoundingClientRect();
    if (!(rect.width > 0)) return;
    const x = ((clientX - rect.left) / rect.width) * WIDTH;
    let nearest = 0;
    let distance = Infinity;
    this.readable().forEach((reading, place) => {
      const gap = Math.abs(this.x(reading.index) - x);
      if (gap < distance) {
        distance = gap;
        nearest = place;
      }
    });
    this.cursor.set(nearest);
  }
}
