import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { HomeWeekMotion } from './home-week-motion';

export type MomentId =
  'hero' | 'plan' | 'train' | 'eat' | 'checkin' | 'talk' | 'progress' | 'share';

/**
 * One moment of the week the homepage tells. Every picture is the real app on the Atlas demo
 * (`scripts/home-screens.mjs` says which screen each one is), so the words must stay true to
 * what those screens show.
 */
export interface WeekMoment {
  readonly id: MomentId;
  /** The stage's day strip, Monday first. */
  readonly day: number;
  /** The stage's caption: when in the week. */
  readonly when: string;
  readonly title: string;
  readonly body: string;
  /** The number the week is about at that moment, on the stage's lime chip. */
  readonly number: string;
  /** For screen readers: what the coach's screen and the client's phone show. */
  readonly screens: string;
}

export const WEEK_MOMENTS: readonly WeekMoment[] = [
  {
    id: 'hero',
    day: 0,
    when: $localize`Monday morning`,
    title: '',
    body: '',
    number: $localize`Lower A · Back squat 3 × 5 · 52.5 kg · RPE 8.5`,
    screens: $localize`On Lea's screen: her Today, with four clients who need her and Maya's check-in waiting. On Maya's phone: her Today, with Lower A scheduled and a note from her coach.`,
  },
  {
    id: 'plan',
    day: 0,
    when: $localize`Monday · Plan`,
    title: $localize`Plan it once.`,
    body: $localize`Lea built Lean & Strong in the program builder once and assigned it. Week 4 is waiting in Maya's Training with today's session first, and nothing is recorded until she starts.`,
    number: $localize`Week 4 of 6 · Lower A today`,
    screens: $localize`On Lea's screen: the program builder, with week 1 of Lean & Strong laid out as four sessions. On Maya's phone: Training, week 4 of 6, with Lower A today and a Start workout button.`,
  },
  {
    id: 'train',
    day: 0,
    when: $localize`Monday evening · Train`,
    title: $localize`She lifts it.`,
    body: $localize`Maya logs set by set against the prescription, with last time beside her and the rest timer running. Set three goes up 2.5 kg, as Lea asked in chat. Two records land on Lea's Today the moment the workout ends.`,
    number: $localize`55 kg × 5 · new record`,
    screens: $localize`On Lea's screen: the activity feed, where Maya finished Lower A in 41 minutes with two back squat records. On Maya's phone: the workout, two sets saved, the third set at 55 kg and the rest timer at 2:59.`,
  },
  {
    id: 'eat',
    day: 1,
    when: $localize`Tuesday · Eat`,
    title: $localize`Meals with real targets.`,
    body: $localize`Maya's day shows the meals Lea planned and the four rings her targets make. Lea sees the same targets, where they came from, and which day of the meal plan Maya is on.`,
    number: $localize`2,156 kcal · 120 g protein`,
    screens: $localize`On Lea's screen: Maya's daily targets of 2,156 calories with protein, carbs and fat, and the meal plan on day 4 of 7. On Maya's phone: Meals for the day, with four rings showing 608 of 2,156 kcal so far.`,
  },
  {
    id: 'checkin',
    day: 3,
    when: $localize`Thursday · Check in`,
    title: $localize`Her week, in her words.`,
    body: $localize`Lea's questions, one at a time; Maya's answers save as she goes. Lea reads them beside last week's, with every change marked and the weight trend alongside.`,
    number: $localize`Energy 7 of 10 · "Finally enjoyed leg day."`,
    screens: $localize`On Lea's screen: the check-in review, with this week's answers beside last week's and four of them marked as changed. On Maya's phone: her weekly check-in answers, waiting for her coach.`,
  },
  {
    id: 'talk',
    day: 4,
    when: $localize`Friday · Talk`,
    title: $localize`The conversation lives with the coaching.`,
    body: $localize`Messages sit inside TB Gym, not in Lea's personal chats. Beside the thread she sees Maya's plan, her last workout and what needs her next.`,
    number: $localize`"Proud of you. Clean reps, too."`,
    screens: $localize`On Lea's screen: the thread with Maya, with Maya's plan, her last workout and what needs Lea next beside it. On Maya's phone: the same thread, with Lea's note about adding 2.5 kg on the last set.`,
  },
  {
    id: 'progress',
    day: 6,
    when: $localize`Sunday · Progress`,
    title: $localize`The trend, and the next block.`,
    body: $localize`Twelve weeks of weigh-ins become one trend both of them see. Maya's logged sets suggest a new deadlift max; Lea keeps the old one or reviews the coming weeks' weights, never silently.`,
    number: $localize`64.4 kg · down 4 kg since 9 August`,
    screens: $localize`On Lea's screen: Maya's training maxes, where logged sets suggest a deadlift max of about 80 kg, up from 77.5. On Maya's phone: Progress, 64.4 kg and 4 kg down since 9 August, with the trend chart.`,
  },
  {
    id: 'share',
    day: 6,
    when: $localize`Sunday night · Share`,
    title: $localize`A record worth sharing.`,
    body: $localize`A personal record becomes a card in Atlas Performance's colours, made on Maya's phone. She shares it or saves it; TB Gym uploads and posts nothing.`,
    number: $localize`52.5 kg × 5 · coached by Atlas Performance`,
    screens: $localize`On Karim's screen: the Brand settings, where Atlas Performance chose forest and lime. On Maya's phone: the share card, a new personal record of 52.5 kg × 5 on the back squat, coached by Atlas Performance.`,
  },
];

/**
 * The week with Maya (UI plan R6.2b): the hero, then one chapter per moment, told from both sides
 * with the real screens of the Atlas demo. On a wide screen the stage of two screens stays beside
 * the chapters while they scroll past, and `HomeWeekMotion` changes it as each chapter reaches
 * the middle of the screen; on a phone, or with reduced motion, every chapter carries its own two
 * pictures and the stage is not drawn.
 */
@Component({
  selector: 'app-home-week',
  imports: [RouterLink],
  templateUrl: './home-week.html',
  styleUrls: ['./home-week.scss', './home-week-stage.scss', './home-week-chapters.scss'],
  providers: [HomeWeekMotion],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeWeek {
  protected readonly days = [
    $localize`Mon`,
    $localize`Tue`,
    $localize`Wed`,
    $localize`Thu`,
    $localize`Fri`,
    $localize`Sat`,
    $localize`Sun`,
  ];
  protected readonly moments = WEEK_MOMENTS;
  protected readonly chapters = WEEK_MOMENTS.slice(1);
  protected readonly active = signal(0);
  protected readonly moment = computed(() => this.moments[this.active()]);

  private readonly motion = inject(HomeWeekMotion);
  protected readonly motionState = this.motion.state;

  private readonly heroCopy = viewChild.required<ElementRef<HTMLElement>>('heroCopy');
  private readonly chapterElements = viewChildren<ElementRef<HTMLElement>>('chapter');
  private readonly marker = viewChild<ElementRef<HTMLElement>>('marker');
  private readonly dayElements = viewChildren<ElementRef<HTMLElement>>('day');

  constructor() {
    inject(DestroyRef).onDestroy(() => this.motion.stop());
    afterNextRender(() => {
      void this.motion.start({
        moments: [
          this.heroCopy().nativeElement,
          ...this.chapterElements().map((chapter) => chapter.nativeElement),
        ],
        marker: this.marker()?.nativeElement ?? null,
        dayOf: (index) => this.dayElements()[this.moments[index].day]?.nativeElement ?? null,
        onMoment: (index) => this.active.set(index),
      });
    });
  }

  protected picture(moment: WeekMoment, kind: 'coach' | 'coach-small' | 'phone'): string {
    return `/images/home/${moment.id}-${kind}`;
  }

  /** The phone in two sizes: 480 px is enough where it is drawn 250 px wide, 720 px for the stage. */
  protected phoneSet(moment: WeekMoment, format: 'avif' | 'webp'): string {
    const base = this.picture(moment, 'phone');
    return `${base}-480.${format} 480w, ${base}.${format} 720w`;
  }
}
