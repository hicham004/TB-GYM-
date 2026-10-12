import { WINDOWS, type WindowPicture } from './home-pictures';

/**
 * The words of the homepage (UI plan R6.2f), beside the pictures they describe. Every picture is
 * the real app on the sample demo "Oakline Strength" (`scripts/home-pictures.mjs` names the screen
 * each one is), so the words must stay true to what those screens show, and to what the product
 * does: no payments in the app, no store app, no AI claims, no quote or outcome on a sample person.
 */
export type StageId = 'plan' | 'train' | 'checkin' | 'see';

/** One stage of the week: a chapter the copy tells and the two screens that prove it. */
export interface WeekStage {
  readonly id: StageId;
  /** The day on the Mon–Sun strip, Monday first. */
  readonly day: number;
  /** The eyebrow: when in the week. */
  readonly when: string;
  readonly title: string;
  readonly body: string;
  /** The travelling number, an upright serif numeral, and what it counts. */
  readonly numeral: string;
  readonly numeralLabel: string;
  readonly window: WindowPicture;
  /** The client's screen, by the name of its phone picture. */
  readonly phone: string;
  /** For screen readers: what the coach's screen and the client's phone show. */
  readonly screens: string;
}

export const WEEK_STAGES: readonly WeekStage[] = [
  {
    id: 'plan',
    day: 0,
    when: $localize`Monday · Plan`,
    title: $localize`You plan it.`,
    body: $localize`Lea built Lean & Strong once, in the builder, and assigned it. Week 4 is waiting in Maya's Training with today's session first; nothing is recorded until she starts.`,
    numeral: '6',
    numeralLabel: $localize`weeks, planned once`,
    window: WINDOWS.builderDark,
    phone: 'client-training',
    screens: $localize`On Lea's screen: the program builder, with week 1 of Lean & Strong as two sessions and a rest day. On Maya's phone: Training, week 4 of 6, with Lower A today and a Start workout button.`,
  },
  {
    id: 'train',
    day: 0,
    when: $localize`Monday evening · Train`,
    title: $localize`They lift it.`,
    body: $localize`Maya logs set by set against the plan, last time beside her, the rest timer running. The third set goes up 2.5 kg, as her coach asked. Her record lands on Lea's Today the moment the workout ends.`,
    numeral: '52.5',
    numeralLabel: $localize`kg × 5 · a new record`,
    window: WINDOWS.feedDark,
    phone: 'client-player',
    screens: $localize`On Lea's screen: the activity feed, where Maya finished Lower A in 41 minutes with a back squat record. On Maya's phone: the workout, two squat sets logged, the third at 55 kg and the rest timer at 2:57.`,
  },
  {
    id: 'checkin',
    day: 3,
    when: $localize`Thursday · Check in`,
    title: $localize`They check in.`,
    body: $localize`Lea's questions, one at a time on Maya's phone. Her answers land beside last week's on Lea's screen, every change marked, with the weight trend alongside.`,
    numeral: '7',
    numeralLabel: $localize`out of 10 for energy, down from 8`,
    window: WINDOWS.reviewDark,
    phone: 'client-checkin',
    screens: $localize`On Lea's screen: the check-in review, with this week's answers beside last week's and four of them marked as changed. On Maya's phone: the first of six questions, how was your energy this week.`,
  },
  {
    id: 'see',
    day: 6,
    when: $localize`Sunday · Progress`,
    title: $localize`You both see it.`,
    body: $localize`Twelve weeks of weigh-ins become one trend both of them see. Maya's logged sets suggest a new deadlift max; Lea keeps the old one or reviews the coming weeks' weights, never silently.`,
    numeral: '3.4',
    numeralLabel: $localize`kg down since 9 August`,
    window: WINDOWS.maxesDark,
    phone: 'client-progress',
    screens: $localize`On Lea's screen: Maya's training maxes, where logged sets suggest a deadlift max of about 80 kg, up from 77.5. On Maya's phone: Progress, 65 kg and 3.4 kg down since 9 August, with the trend chart.`,
  },
];

/** One of the six feature rows: the coach's screen and the client's phone for the same moment. */
export interface FeatureRow {
  readonly id: string;
  readonly eyebrow: string;
  /** A three-to-seven-word outcome. */
  readonly title: string;
  /** At most one sentence. */
  readonly body: string;
  /** The one quiet link, an invitation the registration page keeps. */
  readonly link: string;
  readonly window: WindowPicture;
  /** The same screen cropped narrower, for phones, where the window is drawn about 350 px wide. */
  readonly narrow: WindowPicture;
  readonly phone: string;
  /** Rows alternate which side the phone sits on. */
  readonly phoneFirst: boolean;
  readonly windowAlt: string;
  readonly phoneAlt: string;
}

export const FEATURE_ROWS: readonly FeatureRow[] = [
  {
    id: 'programs',
    eyebrow: $localize`Programs`,
    title: $localize`Build it once. Assign it in a tap.`,
    body: $localize`Drag exercises into the week, set the prescription and publish; every client gets their own copy, and your master stays yours.`,
    link: $localize`Build your first program`,
    window: WINDOWS.programs,
    narrow: WINDOWS.programsNarrow,
    phone: 'client-training',
    phoneFirst: false,
    windowAlt: $localize`The program builder: Lean & Strong, week 1, laid out as sessions and rest days`,
    phoneAlt: $localize`A client's Training on her phone: week 4 of 6, Lower A today, Start workout`,
  },
  {
    id: 'logging',
    eyebrow: $localize`Workout logging`,
    title: $localize`Every set, against the plan.`,
    body: $localize`Clients log weight, reps and RPE or RIR with last time beside them; what they lifted never overwrites what you planned.`,
    link: $localize`Log a first workout`,
    window: WINDOWS.weekDone,
    narrow: WINDOWS.weekDoneNarrow,
    phone: 'client-finish',
    phoneFirst: true,
    windowAlt: $localize`The client's week on the coach's screen: 1 of 4 sessions done, trained 3 minutes ago`,
    phoneAlt: $localize`A finished workout on the phone: Lower A, 44 minutes, every set logged`,
  },
  {
    id: 'meals',
    eyebrow: $localize`Meal plans`,
    title: $localize`Meals with real targets.`,
    body: $localize`Calories and macros worked out in the open, a meal plan with options per meal, and the day's rings on the client's phone.`,
    link: $localize`Set a client's targets`,
    window: WINDOWS.targets,
    narrow: WINDOWS.targetsNarrow,
    phone: 'client-nutrition',
    phoneFirst: false,
    windowAlt: $localize`Daily targets on the coach's screen: 2,156 calories a day with protein, carbs and fat, and the meal plan on day 4 of 7`,
    phoneAlt: $localize`Meals for the day on the phone: four rings, 608 of 2,156 kcal so far`,
  },
  {
    id: 'checkins',
    eyebrow: $localize`Check-ins`,
    title: $localize`Their week, in their words.`,
    body: $localize`Your questions, one at a time on their phone; their answers beside last week's on your screen, every change marked.`,
    link: $localize`Write your check-in`,
    window: WINDOWS.review,
    narrow: WINDOWS.reviewNarrow,
    phone: 'client-checkins',
    phoneFirst: true,
    windowAlt: $localize`The check-in review on the coach's screen: this week's answers beside last week's, each change marked`,
    phoneAlt: $localize`Check-ins on the phone: the weekly check-in from the coach, six questions, Start check-in`,
  },
  {
    id: 'messages',
    eyebrow: $localize`Messages`,
    title: $localize`The conversation lives with the coaching.`,
    body: $localize`Messages stay inside TB Gym, with the client's plan, last workout and what needs you next beside the thread.`,
    link: $localize`Open your inbox`,
    window: WINDOWS.thread,
    narrow: WINDOWS.threadNarrow,
    phone: 'client-messages',
    phoneFirst: false,
    windowAlt: $localize`The thread with Maya on the coach's screen, with her plan, her last workout and what needs the coach beside it`,
    phoneAlt: $localize`The same thread on the phone, with the coach's note about adding 2.5 kg on the last set`,
  },
  {
    id: 'progress',
    eyebrow: $localize`Progress`,
    title: $localize`The trend, not the noise.`,
    body: $localize`Weigh-ins become a smoothed trend on both screens, measurements and photos sit beside it, and every client's last seven days are on your list.`,
    link: $localize`Follow a client's trend`,
    window: WINDOWS.clients,
    narrow: WINDOWS.clientsNarrow,
    phone: 'client-progress',
    phoneFirst: true,
    windowAlt: $localize`The Clients list on the coach's screen: each client's status and last activity`,
    phoneAlt: $localize`Progress on the phone: 65 kg, 3.4 kg down since 9 August, with the trend chart`,
  },
];

/** Proof without a founder: facts about the product as it ships, never a quote or an outcome. */
export const PRODUCT_FACTS: readonly string[] = [
  $localize`Installs from the browser on iPhone and Android; no app store.`,
  $localize`Clients join by invitation from their coach, never from a public sign-up.`,
  $localize`Share cards are made on the phone; TB Gym uploads and posts nothing.`,
  $localize`Light or dark, each person's own choice.`,
  $localize`Your colours and logo on every client's phone.`,
];
