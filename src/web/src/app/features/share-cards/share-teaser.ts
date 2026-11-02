import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  type ElementRef,
  inject,
  input,
  LOCALE_ID,
  signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import { Motion } from '../../core/motion/motion';
import { Button } from '../../ui/button';
import { Icon } from '../../ui/icon';
import { UiSheet } from '../../ui/sheet';
import { ShareCardMaker } from './share-card-maker';
import { shareCards, type ShareFact } from './share-card.models';
import { holdShareCard } from './share-moment';
import { ShareSheet, shareSheetTitle } from './share-sheet';

/**
 * The share card on the workout's finish summary (M2, M9): the prototype's tilted card in the coach's
 * accent, showing the first card the workout gave (the program it finished, else its first record),
 * and one button that opens the sheet to see the picture and share or save it. The player is always
 * dark, so the sheet is too. The card's face follows the pointer and springs back when let go (W10,
 * `share-moment.ts`); the outer card keeps its landing and its 2° rest.
 */
@Component({
  selector: 'app-share-teaser',
  imports: [Button, Icon, ShareSheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (card(); as shown) {
      <div class="card">
        <div class="face" #face>
          <div class="top">
            <span class="kicker">{{ shown.kicker }}</span>
            @if (logoUrl(); as url) {
              <span class="mark logo"
                ><img [src]="url" alt="" width="40" height="40" (error)="logoBroken.set(true)"
              /></span>
            } @else {
              <span class="mark" aria-hidden="true">{{ initials() }}</span>
            }
          </div>
          <p class="headline">{{ shown.headline }}</p>
          <p class="title" dir="auto">{{ shown.title }}</p>
          @for (fact of shown.facts; track fact) {
            <p class="fact">{{ fact }}</p>
          }
          <p class="byline" dir="auto">{{ shown.byline }}</p>
        </div>
      </div>
      <button appButton type="button" variant="outlined" size="touch" (click)="open()">
        <app-icon name="share" />{{ label() }}
      </button>
    }

    <ng-template #sheet>
      <app-share-sheet [facts]="facts()" />
    </ng-template>
  `,
  styles: `
    :host {
      display: block;
      margin-block: 2rem 0.5rem;
    }

    .card {
      // The finish summary sets the delay so the card lands after its parts have risen (W4);
      // backwards, so a landed card is at rest, with no animation left on the page.
      animation:
        share-teaser-in 900ms cubic-bezier(0.34, 1.56, 0.64, 1) var(--tb-share-delay, 350ms)
          backwards,
        share-teaser-fade 300ms var(--tb-ease, ease-out) var(--tb-share-delay, 350ms) backwards;
      // The prototype's elastic.out(1, .6) spring, where the browser draws linear() easings.
      animation-timing-function:
        linear(
          0 0%,
          0.237 3.13%,
          0.486 6.25%,
          0.71 9.38%,
          0.891 12.5%,
          1.022 15.63%,
          1.104 18.75%,
          1.145 21.88%,
          1.153 25%,
          1.14 28.13%,
          1.114 31.25%,
          1.083 34.38%,
          1.053 37.5%,
          1.026 40.63%,
          1.006 43.75%,
          0.992 46.88%,
          0.984 50%,
          0.981 53.13%,
          0.981 56.25%,
          0.984 59.38%,
          0.987 62.5%,
          0.991 65.63%,
          0.995 68.75%,
          0.998 71.88%,
          1 75%,
          1.001 78.13%,
          1.002 81.25%,
          1.002 84.38%,
          1.002 87.5%,
          1.002 90.63%,
          1.001 93.75%,
          1.001 96.88%,
          1 100%
        ),
        var(--tb-ease, ease-out);
      // Inset enough that the tilted corners stay on screen at phone width.
      margin-inline: 0.5rem;
      max-inline-size: min(26rem, calc(100% - 1rem));
      // The face tilts in 3D under the hand (W10); the card keeps the landing and the 2° rest.
      perspective: 56rem;
      transform: translateY(0) rotate(-2deg);
    }

    // The face is the card's surface, so the whole card tilts, shifts and turns in the hand;
    // share-moment.ts writes the pose per frame, and nothing but transform and opacity moves.
    .face {
      background: var(--tb-accent);
      border-radius: 1.6rem;
      box-shadow: 0 30px 40px -24px rgb(0 0 0 / 70%);
      color: var(--tb-on-accent);
      overflow: hidden;
      padding: 1.15rem 1.15rem 1rem;
      position: relative;
      touch-action: pan-y;
      transform: translate(var(--dx, 0px), var(--dy, 0px)) rotate(var(--rz, 0deg))
        rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg));
    }

    // The sheen: a band of light under the pointer, shown while the card is in the hand.
    .face::after {
      background: linear-gradient(
        100deg,
        transparent 32%,
        rgb(255 255 255 / 24%) 50%,
        transparent 68%
      );
      content: '';
      inset: 0;
      opacity: 0;
      pointer-events: none;
      position: absolute;
      transform: translateX(var(--sx, 0%));
      transition: opacity var(--tb-duration, 200ms) var(--tb-ease, ease-out);
    }

    .face.held::after {
      opacity: 1;
    }

    @keyframes share-teaser-in {
      from {
        transform: translateY(2.5rem) rotate(-10deg);
      }
    }

    @keyframes share-teaser-fade {
      from {
        opacity: 0;
      }
    }

    .top {
      align-items: center;
      display: flex;
      gap: 1rem;
      justify-content: space-between;
    }

    .kicker {
      font-size: 0.75rem;
      font-weight: 700;
      letter-spacing: 0.12em;
      min-inline-size: 0;
      overflow-wrap: anywhere;
      text-transform: uppercase;
    }

    .mark {
      background: var(--tb-brand);
      block-size: 2.5rem;
      border-radius: 0.7rem;
      color: var(--tb-accent-bright);
      display: grid;
      flex: none;
      font-size: 0.85rem;
      font-weight: 700;
      inline-size: 2.5rem;
      overflow: hidden;
      place-items: center;
    }

    .mark.logo {
      background: #ffffff;
      padding: 0.3rem;
    }

    .mark img {
      block-size: 100%;
      inline-size: 100%;
      object-fit: contain;
    }

    p {
      margin: 0;
      overflow-wrap: anywhere;
    }

    .headline {
      font-family: var(--tb-font-serif);
      font-size: clamp(2.6rem, 9vw, 3.4rem);
      font-style: italic;
      font-variant-numeric: lining-nums;
      line-height: 1.05;
      margin-block: 0.9rem 0.15rem;
    }

    .title {
      font-weight: 600;
    }

    .fact {
      margin-block-start: 0.15rem;
    }

    .byline {
      font-size: 0.8125rem;
      margin-block-start: 0.9rem;
    }

    button {
      margin-block-start: 1.5rem;
    }

    @media (prefers-reduced-motion: reduce) {
      .card {
        animation: none;
      }
    }

    :host-context(html[data-tb-motion='off']) .card {
      animation: none;
    }
  `,
})
export class ShareTeaser {
  private readonly maker = inject(ShareCardMaker);
  private readonly sheets = inject(UiSheet);
  private readonly locale = inject(LOCALE_ID);
  private readonly motion = inject(Motion);
  private readonly sheet = viewChild.required<TemplateRef<unknown>>('sheet');
  private readonly face = viewChild<ElementRef<HTMLElement>>('face');

  readonly facts = input.required<readonly ShareFact[]>();

  constructor() {
    // The face is in the hand while it is drawn (W10); it is let go when it leaves.
    afterRenderEffect((onCleanup) => {
      const face = this.face()?.nativeElement;
      if (face) onCleanup(holdShareCard(face, this.motion));
    });
  }

  protected readonly card = computed(
    () => shareCards(this.facts(), this.maker.identity(), this.locale)[0] ?? null,
  );
  protected readonly label = computed(() => shareSheetTitle(this.facts()));
  protected readonly logoBroken = signal(false);
  protected readonly logoUrl = computed(() => (this.logoBroken() ? null : this.maker.logoUrl()));
  protected readonly initials = this.maker.initials;

  protected open(): void {
    this.sheets.open(this.sheet(), {
      title: this.label(),
      closeLabel: $localize`Close`,
      mode: 'dark',
    });
  }
}
