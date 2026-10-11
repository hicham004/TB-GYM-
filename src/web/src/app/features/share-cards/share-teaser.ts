import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  LOCALE_ID,
  signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import { Button } from '../../ui/button';
import { Icon } from '../../ui/icon';
import { UiSheet } from '../../ui/sheet';
import { ShareCardMaker } from './share-card-maker';
import { shareCards, type ShareFact } from './share-card.models';
import { ShareSheet, shareSheetTitle } from './share-sheet';

/**
 * The share card on the workout's finish summary (M2, M9): the prototype's tilted card in the coach's
 * accent, showing the first card the workout gave (the program it finished, else its first record),
 * and one button that opens the sheet to see the picture and share or save it. The player is always
 * dark, so the sheet is too.
 */
@Component({
  selector: 'app-share-teaser',
  imports: [Button, Icon, ShareSheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (card(); as shown) {
      <div class="card">
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
      animation: share-teaser-in 900ms cubic-bezier(0.34, 1.56, 0.64, 1) 350ms both;
      background: var(--tb-accent);
      border-radius: 1.6rem;
      box-shadow: 0 30px 40px -24px rgb(0 0 0 / 70%);
      color: var(--tb-on-accent);
      // Inset enough that the tilted corners stay on screen at phone width.
      margin-inline: 0.5rem;
      max-inline-size: min(26rem, calc(100% - 1rem));
      padding: 1.15rem 1.15rem 1rem;
      transform: rotate(-2deg);
    }

    @keyframes share-teaser-in {
      from {
        opacity: 0;
        transform: translateY(2.5rem) rotate(-10deg);
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
  `,
})
export class ShareTeaser {
  private readonly maker = inject(ShareCardMaker);
  private readonly sheets = inject(UiSheet);
  private readonly locale = inject(LOCALE_ID);
  private readonly sheet = viewChild.required<TemplateRef<unknown>>('sheet');

  readonly facts = input.required<readonly ShareFact[]>();

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
