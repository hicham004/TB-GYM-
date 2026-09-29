import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  viewChildren,
} from '@angular/core';
import { injectAutoplay } from './home-autoplay';

type TourId = 'training' | 'nutrition' | 'checkins' | 'progress' | 'messages';

interface TourTab {
  readonly id: TourId;
  readonly label: string;
  readonly title: string;
  readonly body: string;
  readonly note: string;
}

/**
 * The product tour: an ARIA tab set whose panel shows the client's phone for each feature. It
 * advances by itself (see `Autoplay`) until the visitor points at it, focuses it or pauses it.
 * Copy here must stay true to shipped features; the phone pictures are sample data.
 */
@Component({
  selector: 'app-home-tour',
  templateUrl: './home-tour.html',
  styleUrls: [
    './home-tour.scss',
    './home-tour-mobile.scss',
    './home-tour-screens.scss',
    './home-tour-screens-steps.scss',
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeTour {
  protected readonly tabs: readonly TourTab[] = [
    {
      id: 'training',
      label: $localize`Training`,
      title: $localize`Programs that fit each client`,
      body: $localize`Build reusable programs and give every client their own copy. Prescribe sets, reps and effort with RPE or RIR. Clients log what they actually lifted, and your plan stays intact.`,
      note: $localize`Edit the program, and Maya's copy stays hers.`,
    },
    {
      id: 'nutrition',
      label: $localize`Nutrition`,
      title: $localize`Meal plans with real targets`,
      body: $localize`Set a daily calorie target and macros, offer a choice for each meal, and see what your client actually picked.`,
      note: $localize`Daily target: 1,950 kcal, 140 g protein`,
    },
    {
      id: 'checkins',
      label: $localize`Check-ins`,
      title: $localize`Check-ins in your own words`,
      body: $localize`Write your own check-in questions with scales, numbers, text and choices, and read every answer in one timeline.`,
      note: $localize`Scale, number, text or choice`,
    },
    {
      id: 'progress',
      label: $localize`Progress`,
      title: $localize`Progress you can both see`,
      body: $localize`Bodyweight with a smoothed trend, body measurements and progress photos, together in one progress dashboard.`,
      note: $localize`The trend smooths out day-to-day swings`,
    },
    {
      id: 'messages',
      label: $localize`Messages`,
      title: $localize`Coaching out of your personal chats`,
      body: $localize`Message each client directly inside TB Gym, so the conversation sits with their coaching instead of between your friends and family.`,
      note: $localize`1 new message from Maya`,
    },
  ];

  protected readonly autoplay = injectAutoplay(this.tabs.length);
  protected readonly tab = computed(() => this.tabs[this.autoplay.active()]);
  private readonly tabButtons = viewChildren<ElementRef<HTMLButtonElement>>('tabButton');

  /** Arrow keys, Home and End move between tabs and select them (WAI-ARIA tabs pattern). */
  protected onKeydown(event: KeyboardEvent, index: number): void {
    const last = this.tabs.length - 1;
    const rtl =
      (event.currentTarget as HTMLElement).closest('[dir]')?.getAttribute('dir') === 'rtl';
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
    const backward = rtl ? 'ArrowRight' : 'ArrowLeft';

    let next: number;
    if (event.key === 'ArrowDown' || event.key === forward) next = index === last ? 0 : index + 1;
    else if (event.key === 'ArrowUp' || event.key === backward)
      next = index === 0 ? last : index - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    else return;

    event.preventDefault();
    this.autoplay.select(next);
    this.tabButtons()[next]?.nativeElement.focus();
  }
}
