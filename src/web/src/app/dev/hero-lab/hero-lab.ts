import {
  AfterViewInit,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  signal,
} from '@angular/core';

type Preset = 'atlas' | 'cedar' | 'ember' | 'orchid' | 'custom';
type View = 'client' | 'coach';
type Scene = 'today' | 'player' | 'summary';
interface Brand {
  brand: string;
  accent: string;
  onAccent: string;
  name: string;
  logo: string;
}
interface DemoSet {
  prev: string;
  kg: number;
  reps: number;
  done: boolean;
  pr: boolean;
}
interface DemoExercise {
  name: string;
  icon: 'bench' | 'press' | 'row';
  rx: string;
  rest: number;
  last: string;
  best: { kg: number; reps: number };
  sets: DemoSet[];
}
interface Need {
  initials: string;
  tint: string;
  heading: string;
  detail: string;
  tag: string;
  tone: string;
  action: string;
  outcome: string;
}

const PRESETS: Record<Exclude<Preset, 'custom'>, Brand> = {
  atlas: {
    brand: '#153d33',
    accent: '#d9ed94',
    onAccent: '#11201b',
    name: 'Atlas Performance',
    logo: 'AP',
  },
  cedar: {
    brand: '#15233f',
    accent: '#ffb48c',
    onAccent: '#11201b',
    name: 'Cedar Strength',
    logo: 'CS',
  },
  ember: {
    brand: '#221b18',
    accent: '#ff8a4c',
    onAccent: '#11201b',
    name: 'Ember Athletics',
    logo: 'EA',
  },
  orchid: {
    brand: '#36203a',
    accent: '#f3b4d1',
    onAccent: '#11201b',
    name: 'Orchid Studio',
    logo: 'OS',
  },
};
const INITIAL_WORKOUT: DemoExercise[] = [
  {
    name: 'Barbell bench press',
    icon: 'bench',
    rx: '4 sets · 5–8 reps · RPE 8 · rest 1:30',
    rest: 90,
    last: '60 kg × 6, 6, 6, 5',
    best: { kg: 60, reps: 6 },
    sets: [
      { prev: '60 × 6', kg: 62.5, reps: 6, done: false, pr: false },
      { prev: '60 × 6', kg: 62.5, reps: 6, done: false, pr: false },
      { prev: '60 × 6', kg: 62.5, reps: 6, done: false, pr: false },
      { prev: '60 × 5', kg: 62.5, reps: 5, done: false, pr: false },
    ],
  },
  {
    name: 'Seated dumbbell press',
    icon: 'press',
    rx: '3 sets · 8–10 reps · RPE 8 · rest 1:15',
    rest: 75,
    last: '20 kg × 10, 10, 9',
    best: { kg: 20, reps: 10 },
    sets: [
      { prev: '20 × 10', kg: 22, reps: 10, done: false, pr: false },
      { prev: '20 × 10', kg: 22, reps: 9, done: false, pr: false },
      { prev: '20 × 9', kg: 22, reps: 8, done: false, pr: false },
    ],
  },
  {
    name: 'Chest-supported row',
    icon: 'row',
    rx: '3 sets · 10–12 reps · rest 1:00',
    rest: 60,
    last: '30 kg × 12, 12, 11',
    best: { kg: 30, reps: 12 },
    sets: [
      { prev: '30 × 12', kg: 32.5, reps: 10, done: false, pr: false },
      { prev: '30 × 12', kg: 32.5, reps: 10, done: false, pr: false },
      { prev: '30 × 11', kg: 32.5, reps: 10, done: false, pr: false },
    ],
  },
];
const INITIAL_NEEDS: Need[] = [
  {
    initials: 'MR',
    tint: 'a2',
    heading: 'Maya Rahman sent her weekly check-in',
    detail: 'Weight ↓ 0.4 kg · shoulder feels better · 2 h ago',
    tag: 'Check-in',
    tone: 't-review',
    action: 'Review',
    outcome: "Maya's check-in is marked reviewed. She'll see your reply.",
  },
  {
    initials: 'RK',
    tint: 'a3',
    heading: 'Rami Khoury asked to renew',
    detail: 'Strength & Body Composition ended Mon 28 Sep',
    tag: 'Renewal',
    tone: 't-renew',
    action: 'Renew plan',
    outcome: 'Renewal started. Rami gets his new plan and payment details.',
  },
  {
    initials: 'SH',
    tint: 'a6',
    heading: "Sara Haddad's week 3 isn't shared yet",
    detail: 'Her next session is tomorrow morning',
    tag: 'Program',
    tone: 't-share',
    action: 'Share week',
    outcome: 'Week 3 is shared. Sara sees it on her Today screen now.',
  },
  {
    initials: 'ON',
    tint: 'a4',
    heading: 'Omar Nasser missed 2 sessions',
    detail: 'Last trained Fri 25 Sep · usually Mon, Wed, Fri',
    tag: 'Missed',
    tone: 't-miss',
    action: 'Message',
    outcome: 'Message sent to Omar.',
  },
  {
    initials: 'NF',
    tint: 'a5',
    heading: 'Nour Fares joined, no program yet',
    detail: 'Goal: fat loss · 3 days a week · joined yesterday',
    tag: 'New',
    tone: 't-new',
    action: 'Assign program',
    outcome: 'Hypertrophy Base is assigned to Nour, starting Monday.',
  },
];
const formatNumber = (value: number) =>
  Number.isInteger(value) ? String(value) : value.toFixed(1);

/** Angular-owned local preview of the three prototype scenes. No API or authoritative workout state. */
@Component({
  selector: 'app-hero-lab',
  templateUrl: './hero-lab.html',
  host: { class: 'tb-theme' },
})
export class HeroLab implements AfterViewInit {
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private toastTimeout?: ReturnType<typeof setTimeout>;
  private tickInterval?: ReturnType<typeof setInterval>;
  private startedAt?: number;
  private restEndsAt?: number;

  readonly preset = signal<Preset>('atlas');
  readonly mode = signal<'light' | 'dark'>('light');
  readonly view = signal<View>('client');
  readonly scene = signal<Scene>('today');
  readonly customColor = signal('#62d2c4');
  readonly brand = computed<Brand>(() => {
    const preset = this.preset();
    return preset === 'custom'
      ? {
          brand: '#143b34',
          accent: this.customColor(),
          onAccent: '#11201b',
          name: 'Your Studio',
          logo: 'YS',
        }
      : PRESETS[preset];
  });
  readonly meals = signal(2);
  readonly kcal = computed(() => (this.meals() === 2 ? 1240 : 1865));
  readonly needs = signal<Need[]>(INITIAL_NEEDS);
  readonly toast = signal('');
  readonly exerciseIndex = signal(0);
  readonly workout = signal<DemoExercise[]>(structuredClone(INITIAL_WORKOUT));
  readonly exercise = computed(() => this.workout()[this.exerciseIndex()]);
  readonly activeSetIndex = computed(() => this.exercise().sets.findIndex((set) => !set.done));
  readonly exerciseComplete = computed(() => this.activeSetIndex() === -1);
  readonly doneCount = computed(() =>
    this.workout().reduce(
      (sum, exercise) => sum + exercise.sets.filter((set) => set.done).length,
      0,
    ),
  );
  readonly personalRecords = computed(() =>
    this.workout().flatMap((exercise) =>
      exercise.sets
        .filter((set) => set.pr)
        .map((set) => ({ name: exercise.name, kg: set.kg, reps: set.reps })),
    ),
  );
  readonly volume = computed(() =>
    this.workout().reduce(
      (sum, exercise) =>
        sum +
        exercise.sets.filter((set) => set.done).reduce((sets, set) => sets + set.kg * set.reps, 0),
      0,
    ),
  );
  readonly finished = signal(false);
  readonly elapsed = signal(0);
  readonly completedMinutes = computed(() => Math.max(1, Math.round(this.elapsed() / 60)));
  readonly restRemaining = signal(0);
  readonly restTotal = signal(0);
  readonly formatNumber = formatNumber;
  readonly formatTime = (seconds: number) =>
    `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  readonly completion = (exercise: DemoExercise) =>
    (exercise.sets.filter((set) => set.done).length / exercise.sets.length) * 100;

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.toastTimeout) clearTimeout(this.toastTimeout);
      if (this.tickInterval) clearInterval(this.tickInterval);
    });
  }

  ngAfterViewInit(): void {
    this.animate('[data-in]', {
      y: 18,
      opacity: 0,
      duration: 0.6,
      ease: 'power3.out',
      stagger: 0.07,
      delay: 0.1,
    });
    this.drawPath('#spark', 0.9);
  }

  showView(view: View): void {
    this.view.set(view);
    this.animate(view === 'coach' ? '#desk' : '#phone', {
      y: 18,
      opacity: 0,
      duration: 0.5,
      ease: 'power3.out',
    });
    if (view === 'coach') this.coachIntro();
  }
  setBrand(preset: Exclude<Preset, 'custom'>): void {
    this.preset.set(preset);
    this.animate('.logo', { scale: 0.6, duration: 0.5, ease: 'back.out(3)', stagger: 0.03 });
  }
  setCustomColor(event: Event): void {
    this.customColor.set((event.target as HTMLInputElement).value);
    this.preset.set('custom');
  }
  showToast(message: string): void {
    this.toast.set(message);
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => this.toast.set(''), 3400);
  }
  logLunch(): void {
    if (this.meals() > 2) return;
    this.meals.set(3);
    this.showToast('Lunch logged as planned: chicken, rice and salad.');
  }
  resolveNeed(need: Need): void {
    this.needs.update((needs) => needs.filter((item) => item !== need));
    this.showToast(need.outcome);
  }
  openPlayer(): void {
    if (this.finished()) {
      this.scene.set('summary');
      this.animate('#summary', { y: 30, opacity: 0, duration: 0.5, ease: 'power3.out' });
      return;
    }
    if (!this.startedAt) this.startedAt = Date.now();
    this.startTicking();
    this.scene.set('player');
    this.expandPlayer();
  }
  closePlayer(): void {
    this.skipRest();
    this.scene.set('today');
  }
  stepSet(field: 'kg' | 'reps', delta: number): void {
    const exerciseIndex = this.exerciseIndex();
    const setIndex = this.activeSetIndex();
    if (setIndex < 0) return;
    this.workout.update((workout) =>
      workout.map((exercise, index) =>
        index !== exerciseIndex
          ? exercise
          : {
              ...exercise,
              sets: exercise.sets.map((set, i) =>
                i !== setIndex
                  ? set
                  : {
                      ...set,
                      [field]:
                        field === 'kg'
                          ? Math.max(0, Math.round((set.kg + delta) * 10) / 10)
                          : Math.max(1, set.reps + delta),
                    },
              ),
            },
      ),
    );
  }
  logSet(): void {
    const exerciseIndex = this.exerciseIndex();
    const setIndex = this.activeSetIndex();
    if (setIndex < 0) return;
    const exercise = this.exercise();
    const set = exercise.sets[setIndex];
    const pr =
      (set.kg > exercise.best.kg && set.reps >= exercise.best.reps) ||
      (set.kg >= exercise.best.kg && set.reps > exercise.best.reps);
    this.workout.update((workout) =>
      workout.map((item, index) =>
        index !== exerciseIndex
          ? item
          : {
              ...item,
              best: pr ? { kg: set.kg, reps: set.reps } : item.best,
              sets: item.sets.map((row, i) => (i === setIndex ? { ...row, done: true, pr } : row)),
            },
      ),
    );
    this.animate('#sets .set.done', { scale: 0.94, duration: 0.45, ease: 'back.out(2.5)' });
    if (pr) {
      this.showToast(
        `New PR! ${formatNumber(set.kg)} kg × ${set.reps} on ${exercise.name.toLowerCase()}.`,
      );
      if (!this.reducedMotion()) requestAnimationFrame(() => this.burst());
    }
    if (this.activeSetIndex() >= 0) this.startRest(exercise.rest);
    else this.skipRest();
  }
  nextExercise(): void {
    if (!this.exerciseComplete()) return;
    this.skipRest();
    if (this.exerciseIndex() < this.workout().length - 1) {
      this.exerciseIndex.update((index) => index + 1);
      this.animate('#ex-panel', { x: 50, opacity: 0, duration: 0.45, ease: 'power3.out' });
      this.host.nativeElement.querySelector('#p-body')?.scrollTo?.({ top: 0 });
      return;
    }
    this.finished.set(true);
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = undefined;
    }
    this.scene.set('summary');
    this.animate('#summary', { y: 30, opacity: 0, duration: 0.5, ease: 'power3.out' });
    this.animate('#share', {
      rotate: -10,
      y: 40,
      duration: 0.9,
      ease: 'elastic.out(1, .6)',
      delay: 0.5,
    });
    this.countUp('#s-time', Math.max(1, Math.round(this.elapsed() / 60)));
    this.countUp('#s-vol', Math.round(this.volume()));
    this.countUp('#s-sets', this.doneCount());
    this.countUp('#s-prs', this.personalRecords().length);
  }
  backToday(): void {
    this.scene.set('today');
    this.animate('#hero', { scale: 0.97, duration: 0.6, ease: 'back.out(2)' });
  }
  addRest(): void {
    if (!this.restEndsAt) return;
    this.restEndsAt += 15000;
    this.restTotal.update((seconds) => seconds + 15);
    this.restRemaining.update((seconds) => seconds + 15);
  }
  skipRest(): void {
    this.restEndsAt = undefined;
    this.restRemaining.set(0);
  }
  private startRest(seconds: number): void {
    this.restTotal.set(seconds);
    this.restRemaining.set(seconds);
    this.restEndsAt = Date.now() + seconds * 1000;
    this.animate('#rest', { y: 120, opacity: 0, duration: 0.5, ease: 'power3.out' });
  }
  private startTicking(): void {
    if (this.tickInterval) return;
    this.tickInterval = setInterval(() => {
      if (this.startedAt) this.elapsed.set(Math.floor((Date.now() - this.startedAt) / 1000));
      if (this.restEndsAt) {
        const seconds = Math.max(0, Math.ceil((this.restEndsAt - Date.now()) / 1000));
        this.restRemaining.set(seconds);
        if (seconds === 0) {
          this.restEndsAt = undefined;
          this.showToast('Rest is over. Next set when you are ready.');
        }
      }
    }, 1000);
  }
  private coachIntro(): void {
    this.animate('[data-cin]', {
      y: 18,
      opacity: 0,
      duration: 0.55,
      ease: 'power3.out',
      stagger: 0.07,
    });
    this.animate('#bars i', {
      scaleY: 0,
      duration: 0.8,
      ease: 'power3.out',
      stagger: 0.06,
      delay: 0.4,
    });
    this.drawPath('#cspark', 0.3);
    for (const [selector, value] of [
      ['[data-count="24"]', 24],
      ['[data-count="92"]', 92],
      ['[data-count="3"]', 3],
      ['[data-count="26"]', 26],
    ] as const) {
      this.countUp(selector, value);
    }
  }

  private async expandPlayer(): Promise<void> {
    if (this.reducedMotion()) return;
    const { gsap } = await import('gsap');
    const screen = this.host.nativeElement.querySelector<HTMLElement>('#screen');
    const hero = this.host.nativeElement.querySelector<HTMLElement>('#hero');
    const player = this.host.nativeElement.querySelector<HTMLElement>('#player');
    if (!screen || !hero || !player || this.scene() !== 'player') return;
    const s = screen.getBoundingClientRect();
    const h = hero.getBoundingClientRect();
    const inset = `inset(${Math.max(0, h.top - s.top)}px ${Math.max(0, s.right - h.right)}px ${Math.max(0, s.bottom - h.bottom)}px ${Math.max(0, h.left - s.left)}px round 26px)`;
    gsap.fromTo(
      player,
      { clipPath: inset },
      {
        clipPath: 'inset(0px 0px 0px 0px round 0px)',
        duration: 0.7,
        ease: 'power3.inOut',
        onComplete: () => gsap.set(player, { clearProps: 'clipPath' }),
      },
    );
    gsap.from(
      this.host.nativeElement.querySelectorAll('#player .p-top, #player .segs, #ex-panel > *'),
      { y: 14, opacity: 0, duration: 0.45, ease: 'power2.out', stagger: 0.04, delay: 0.35 },
    );
  }

  private async burst(): Promise<void> {
    if (this.reducedMotion()) return;
    const { gsap } = await import('gsap');
    const screen = this.host.nativeElement.querySelector<HTMLElement>('#screen');
    const badge = this.host.nativeElement.querySelector<HTMLElement>('#sets .pr:last-of-type');
    if (!screen || !badge || this.scene() !== 'player') return;
    const s = screen.getBoundingClientRect();
    const b = badge.getBoundingClientRect();
    gsap.fromTo(badge, { scale: 0 }, { scale: 1, duration: 0.55, ease: 'back.out(4)' });
    for (let index = 0; index < 16; index++) {
      const dot = document.createElement('span');
      dot.className = 'burst';
      dot.style.left = `${b.left - s.left + b.width / 2 - 4}px`;
      dot.style.top = `${b.top - s.top + b.height / 2 - 4}px`;
      if (index % 3 === 0) dot.style.background = '#fff';
      screen.append(dot);
      const angle = (Math.PI * 2 * index) / 16;
      const distance = 40 + (index % 3) * 9;
      gsap.to(dot, {
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance,
        scale: 0.3,
        opacity: 0,
        duration: 0.85,
        ease: 'power2.out',
        onComplete: () => dot.remove(),
      });
    }
  }

  private async drawPath(selector: string, delay: number): Promise<void> {
    if (this.reducedMotion()) return;
    const { gsap } = await import('gsap');
    const path = this.host.nativeElement.querySelector<SVGPathElement>(selector);
    if (!path) return;
    const length = path.getTotalLength();
    gsap.fromTo(
      path,
      { strokeDasharray: length, strokeDashoffset: length },
      { strokeDashoffset: 0, duration: 1.1, delay, ease: 'power2.out' },
    );
  }

  private async countUp(selector: string, value: number): Promise<void> {
    if (this.reducedMotion()) return;
    const { gsap } = await import('gsap');
    const element = this.host.nativeElement.querySelector<HTMLElement>(selector);
    if (!element) return;
    const counter = { value: 0 };
    gsap.to(counter, {
      value,
      duration: 1.1,
      ease: 'power2.out',
      onUpdate: () => {
        element.textContent = Math.round(counter.value).toLocaleString();
      },
    });
  }

  private reducedMotion(): boolean {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  private async animate(selector: string, from: Record<string, string | number>): Promise<void> {
    if (this.reducedMotion()) return;
    const { gsap } = await import('gsap');
    const elements = this.host.nativeElement.querySelectorAll(selector);
    if (elements.length) gsap.from(elements, from);
  }
}
