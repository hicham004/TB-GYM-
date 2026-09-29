import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export interface SparklineGeometry {
  line: string;
  area: string;
  last: { x: number; y: number } | null;
}

/** Fit ordered measurements into a 120 × 48 SVG without changing their order or values. */
export function sparklineGeometry(values: readonly number[]): SparklineGeometry {
  if (!values.length || values.some((value) => !Number.isFinite(value))) {
    return { line: '', area: '', last: null };
  }

  const min = values.reduce((lowest, value) => Math.min(lowest, value), Infinity);
  const max = values.reduce((highest, value) => Math.max(highest, value), -Infinity);
  const points = values.map((value, index) => ({
    x: values.length === 1 ? 60 : 4 + (112 * index) / (values.length - 1),
    y: max === min ? 24 : 44 - (40 * (value - min)) / (max - min),
  }));
  const coordinates = points.map((point) => `${point.x.toFixed(2)} ${point.y.toFixed(2)}`);
  const first = points[0];
  const last = points[points.length - 1];

  return {
    line: `M ${coordinates.join(' L ')}`,
    area:
      points.length > 1
        ? `M ${first.x.toFixed(2)} 44 L ${coordinates.join(' L ')} L ${last.x.toFixed(2)} 44 Z`
        : '',
    last,
  };
}

/** A visual trend with a required spoken summary. Values stay ordered from first to last. */
@Component({
  selector: 'app-sparkline',
  template: `
    <svg viewBox="0 0 120 48" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      @if (geometry().area) {
        <path class="area" [attr.d]="geometry().area" />
      }
      @if (geometry().line) {
        <path class="line" [attr.d]="geometry().line" />
      }
      @if (geometry().last; as last) {
        <circle [attr.cx]="last.x" [attr.cy]="last.y" r="3" />
      }
    </svg>
    <span class="sr-only">{{ summary() }}</span>
  `,
  styles: `
    :host {
      display: inline-block;
      min-inline-size: 0;
      vertical-align: middle;
    }
    svg {
      block-size: 48px;
      display: block;
      inline-size: 100%;
      overflow: visible;
    }
    svg:dir(rtl) {
      transform: scaleX(-1);
    }
    .area {
      fill: var(--tb-accent-soft);
    }
    .line {
      fill: none;
      stroke: var(--tb-accent-ink);
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-width: 2.5;
      vector-effect: non-scaling-stroke;
    }
    circle {
      fill: var(--tb-accent-ink);
    }
    .sr-only {
      block-size: 1px;
      clip-path: inset(50%);
      inline-size: 1px;
      overflow: hidden;
      position: absolute;
      white-space: nowrap;
    }
    @media (forced-colors: active) {
      .line {
        stroke: CanvasText;
      }
      circle {
        fill: CanvasText;
      }
      .area {
        fill: transparent;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Sparkline {
  readonly values = input.required<readonly number[]>();
  readonly summary = input.required<string>();
  protected readonly geometry = computed(() => sparklineGeometry(this.values()));
}
