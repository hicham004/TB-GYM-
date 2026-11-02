import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  linkedSignal,
  signal,
  untracked,
  viewChildren,
} from '@angular/core';
import type { TrainingLoadUnit } from '../../core/api/generated';
import { Motion } from '../../core/motion/motion';
import { loadPlates, sharedFromCollar, unloadPlates } from './plates-moment';
import {
  PLATE_SETS,
  type PlateSet,
  plateUnitLabel,
  perSideWords,
  splitPlates,
  stepLoadable,
} from './plates';

/** How a plate is drawn from the side: its width in px, its height as a share of the biggest, its colours. */
interface PlateLook {
  readonly w: number;
  readonly h: number;
  readonly fill: string;
  readonly ink: string;
}

const DARK = '#1b1b1b';
const LIGHT = '#ffffff';
/** Competition colours: red 25, blue 20, yellow 15, green 10, white 5, and the small ones in their own. */
const KG_LOOKS: Readonly<Record<string, PlateLook>> = {
  '25': { w: 24, h: 1, fill: '#d63a2f', ink: LIGHT },
  '20': { w: 20, h: 1, fill: '#2f5fd6', ink: LIGHT },
  '15': { w: 17, h: 1, fill: '#f0c330', ink: DARK },
  '10': { w: 14, h: 1, fill: '#2f9e52', ink: LIGHT },
  '5': { w: 11, h: 0.56, fill: '#f3f3ee', ink: DARK },
  '2.5': { w: 9, h: 0.44, fill: '#d63a2f', ink: LIGHT },
  '1.25': { w: 8, h: 0.36, fill: '#c3c9ce', ink: DARK },
};
const LB_LOOKS: Readonly<Record<string, PlateLook>> = {
  '45': { w: 22, h: 1, fill: '#2f5fd6', ink: LIGHT },
  '35': { w: 19, h: 1, fill: '#f0c330', ink: DARK },
  '25': { w: 16, h: 1, fill: '#2f9e52', ink: LIGHT },
  '10': { w: 11, h: 0.52, fill: '#f3f3ee', ink: DARK },
  '5': { w: 9, h: 0.44, fill: '#8f979d', ink: LIGHT },
  '2.5': { w: 8, h: 0.36, fill: '#c3c9ce', ink: DARK },
};
const FALLBACK_LOOK: PlateLook = { w: 10, h: 0.5, fill: '#8f979d', ink: LIGHT };

/**
 * The barbell (docs/MOTION-PLAN-2026-11.md, W11): a weight in the client's own unit, drawn as a bar
 * loaded from the collar out on a fixed plate set, with the per-side list in words, steppers that
 * move to the next loadable weight, one tap to the lighter bar, and the nearest loadable weights
 * where no plate set makes the target. It is a reading of the set's draft weight and a guide, and
 * changes nothing in the set or the coach's numbers. The plates slide on and off through
 * plates-moment.ts; with reduced motion they are in place at once and the live line says what changed.
 */
@Component({
  selector: 'app-plates-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'plates-sheet' },
  template: `
    <div class="weight-row">
      <button
        type="button"
        aria-label="Less weight"
        i18n-aria-label
        [disabled]="next(-1) === null"
        (click)="step(-1)"
      >
        −
      </button>
      <p class="weight">
        <strong>{{ target() }}</strong> {{ unitLabel() }}
      </p>
      <button type="button" aria-label="More weight" i18n-aria-label (click)="step(1)">+</button>
    </div>
    <div class="bar" aria-hidden="true" dir="ltr">
      <span class="collar"></span>
      @for (plate of drawn(); track $index) {
        @let look = lookOf(plate);
        <span
          #plate
          class="plate"
          [class.thin]="look.h < 1"
          [style.--w]="look.w"
          [style.--h]="look.h"
          [style.background]="look.fill"
          [style.color]="look.ink"
          ><b>{{ plate }}</b></span
        >
      }
    </div>
    <p class="per-side">{{ perSideLine() }}</p>
    <p class="bar-line">
      <span i18n>{{ bar() }} {{ unitLabel() }} bar</span>
      <button type="button" (click)="switchBar()" i18n>
        Use {{ otherBar() }} {{ unitLabel() }} bar
      </button>
    </p>
    @if (note(); as said) {
      <p class="note">{{ said }}</p>
    }
    <p class="tb-visually-hidden" aria-live="polite">{{ sentence() }}</p>
    <p class="guide">{{ guide() }}</p>
  `,
  styles: `
    :host {
      display: grid;
      gap: 0.9rem;
    }

    .weight-row {
      display: grid;
      grid-template-columns: 3rem minmax(0, 1fr) 3rem;
      align-items: center;
      gap: 0.5rem;
    }

    .weight-row button {
      inline-size: 3rem;
      block-size: 3rem;
      border: 0;
      border-radius: 50%;
      padding: 0;
      font-size: 1.5rem;
      line-height: 1;
      color: var(--tb-on-accent, #11201b);
      background: var(--tb-accent, #d9ed94);
      cursor: pointer;
    }

    .weight-row button:disabled {
      opacity: 0.4;
      cursor: default;
    }

    .weight-row button:focus-visible {
      outline: 2px solid var(--tb-focus, currentColor);
      outline-offset: 2px;
    }

    .weight {
      margin: 0;
      text-align: center;
      font-size: 1.1rem;
      color: var(--tb-muted);
    }

    .weight strong {
      font-size: 2rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      color: var(--tb-ink);
    }

    // The bar from the side, one sleeve: the shaft runs through, the collar sits at the left and the
    // plates stand on the sleeve from it outward. Clipped, so a plate sliding on starts out of sight.
    .bar {
      position: relative;
      display: flex;
      align-items: center;
      gap: 2px;
      block-size: 7rem;
      padding-inline-start: 1.25rem;
      overflow: hidden;
    }

    .bar::before {
      content: '';
      position: absolute;
      inset-inline: 0;
      inset-block-start: 50%;
      block-size: 0.6rem;
      translate: 0 -50%;
      border-radius: 0.3rem;
      background: linear-gradient(#d6dbdf, #8a9298);
    }

    .collar,
    .plate {
      position: relative;
      flex: none;
    }

    .collar {
      inline-size: 0.8rem;
      block-size: 1.6rem;
      border-radius: 0.2rem;
      background: #a9b1b7;
    }

    .plate {
      display: grid;
      place-items: center;
      inline-size: calc(var(--w) * 1px);
      block-size: calc(var(--h) * 100%);
      border-radius: 0.3rem;
      box-shadow: inset 0 0 0 1px #0000002e;
      font-size: 0.62rem;
      font-weight: 700;
    }

    // The number reads down the plate's rim; on the inner element, so the plate's own axes stay put.
    .plate b {
      font-weight: inherit;
      writing-mode: vertical-rl;
    }

    .plate.thin b {
      font-size: 0;
    }

    p {
      margin: 0;
      overflow-wrap: anywhere;
    }

    .per-side {
      font-weight: 600;
      color: var(--tb-ink);
    }

    .bar-line {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      color: var(--tb-muted);
    }

    .bar-line button {
      min-block-size: 2.75rem;
      border: 0;
      border-radius: 1.5rem;
      padding: 0.5rem 1rem;
      font: inherit;
      color: var(--tb-ink);
      background: var(--tb-surface-2);
      cursor: pointer;
    }

    .bar-line button:focus-visible {
      outline: 2px solid var(--tb-focus, currentColor);
      outline-offset: 2px;
    }

    .note {
      color: var(--tb-ink);
    }

    .guide {
      color: var(--tb-muted);
      font-size: 0.875rem;
    }
  `,
})
export class PlatesSheet {
  private readonly motion = inject(Motion);
  private readonly injector = inject(Injector);
  /** The weight the sheet opens on: the set's draft weight, or the bar where there is none. */
  readonly weight = input<number | null>(null);
  readonly unit = input<TrainingLoadUnit | null>(null);

  protected readonly plateSet = computed<PlateSet>(() => PLATE_SETS[this.unit() ?? 'Kilogram']);
  protected readonly bar = linkedSignal(() => this.plateSet().bars[0]);
  protected readonly target = linkedSignal(() => this.weight() ?? this.plateSet().bars[0]);
  protected readonly split = computed(() =>
    splitPlates(this.target(), this.plateSet(), this.bar()),
  );
  protected readonly unitLabel = computed(() => plateUnitLabel(this.plateSet().unit));
  protected readonly otherBar = computed(() => {
    const [first, second] = this.plateSet().bars;
    return this.bar() === first ? second : first;
  });
  /** The plates on the bar as drawn right now; the split is the truth and the drawing catches up. */
  protected readonly drawn = signal<readonly number[]>([]);
  private readonly plateElements = viewChildren<ElementRef<HTMLElement>>('plate');
  private latest: readonly number[] = [];
  private redrawing = false;
  private destroyed = false;

  protected readonly perSideLine = computed(() => {
    const { perSide } = this.split();
    return perSide.length === 0
      ? $localize`Just the bar`
      : $localize`Per side: ${perSideWords(perSide)}:plates:`;
  });

  protected readonly note = computed<string | null>(() => {
    const split = this.split();
    const unit = this.unitLabel();
    if (split.state === 'lighter-than-bar') return $localize`Lighter than the bar`;
    if (split.state === 'not-loadable') {
      return $localize`${split.target}:target: ${unit}:unit: is not loadable with these plates; the bar shows ${split.below}:below: ${unit}:unit2:. Next up: ${split.above}:above: ${unit}:unit3:.`;
    }
    return null;
  });

  protected readonly sentence = computed(() => {
    const parts = [`${this.target()} ${this.unitLabel()}`, this.perSideLine()];
    const note = this.note();
    if (note) parts.push(note);
    const said = parts.join('. ');
    return said.endsWith('.') ? said : said + '.';
  });

  protected readonly guide = computed(() => {
    const set = this.plateSet();
    const unit = this.unitLabel();
    const biggest = set.plates[0];
    const smallest = set.plates[set.plates.length - 1];
    return $localize`Standard plates ${biggest}:biggest: to ${smallest}:smallest: ${unit}:unit: on a ${set.bars[0]}:bar: ${unit}:unit2: bar; your gym's may differ.`;
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
    });
    effect(() => {
      const next = this.split().perSide;
      untracked(() => this.show(next));
    });
  }

  /** The next loadable weight that way, or null where there is none (nothing under the bar). */
  protected next(direction: 1 | -1): number | null {
    return stepLoadable(this.target(), this.plateSet(), this.bar(), direction);
  }

  protected step(direction: 1 | -1): void {
    const next = this.next(direction);
    if (next !== null) this.target.set(next);
  }

  protected switchBar(): void {
    this.bar.set(this.otherBar());
  }

  protected lookOf(plate: number): PlateLook {
    const looks = this.plateSet().unit === 'Pound' ? LB_LOOKS : KG_LOOKS;
    return looks[String(plate)] ?? FALLBACK_LOOK;
  }

  /** Asks for `next` on the bar; one redraw runs at a time and the latest ask wins. */
  private show(next: readonly number[]): void {
    this.latest = next;
    if (!this.redrawing) void this.redraw();
  }

  private async redraw(): Promise<void> {
    this.redrawing = true;
    try {
      while (!this.destroyed && !sameLoad(this.latest, this.drawn())) {
        const next = this.latest;
        const drawn = this.drawn();
        const shared = sharedFromCollar(drawn, next);
        if (shared < drawn.length) {
          await unloadPlates(this.plates().slice(shared), this.motion);
          if (this.destroyed) return;
        }
        this.drawn.set(next);
        await this.rendered();
        if (this.destroyed) return;
        loadPlates(this.plates().slice(shared), this.motion);
      }
    } finally {
      this.redrawing = false;
    }
  }

  private plates(): HTMLElement[] {
    return this.plateElements().map((ref) => ref.nativeElement);
  }

  private rendered(): Promise<void> {
    return new Promise((resolve) => {
      afterNextRender(() => resolve(), { injector: this.injector });
    });
  }
}

function sameLoad(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((plate, index) => plate === b[index]);
}
