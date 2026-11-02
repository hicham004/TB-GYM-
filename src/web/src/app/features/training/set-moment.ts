import type { ClientTrainingDayResult, WorkoutSetSaveView } from '../../core/api/generated';
import { backOut, EASE, linearEasing, type Motion } from '../../core/motion/motion';

/**
 * The set tick and the record burst (docs/MOTION-PLAN-2026-11.md, W3). A set is done when the
 * server says so, so the moment runs on the answer, never on the tap: the row springs into its done
 * form, its tick draws, the exercise's segment fills, and on a personal record the PR chip pops and
 * dots burst from it, the full burst for the workout's first record and a smaller one for every
 * later one. Everything runs on the Web Animations API through `Motion` (no GSAP), nothing is
 * inserted into the sets, and with reduced motion or the switch on the final state is what the
 * template already drew: the tick and the chip appear at once, with no dots.
 *
 * `planSetMoment` reads what the answer changes before the page updates (pure, tested);
 * `playSetMoment` plays it on the rendered rows after the next render.
 */

/** The row of the motion plan this moment belongs to, so `tb-motion-off = W3` turns it off alone. */
export const SET_MOMENT = 'W3';

export interface SetMoment {
  readonly setId: string;
  readonly exerciseName: string;
  /** `first` is the workout's first record (the full burst), `again` a later one (fewer dots). */
  readonly record: 'none' | 'first' | 'again';
  /** The exercise's segment, from its completion before the save to after, in percent. */
  readonly segment: { readonly index: number; readonly from: number; readonly to: number } | null;
}

/** Dots in the first record's burst, and in a later record's. */
export const BURST_DOTS = { first: 16, again: 8 } as const;

/**
 * What the answer changes on the page, read before the day updates: the exercise's completion before
 * and after this set, and whether the set turned into a record just now (a set edited and saved
 * again never bursts twice: it is already in `recordsBefore`).
 */
export function planSetMoment(
  day: ClientTrainingDayResult | null,
  recorded: WorkoutSetSaveView,
  recordsBefore: ReadonlySet<string>,
): SetMoment | null {
  const workout = day?.workouts.find(
    (item) => item.workoutExecutionId === recorded.workoutExecutionId,
  );
  if (!workout) return null;
  const setId = recorded.setPerformanceId;
  const index = workout.exercises.findIndex((exercise) =>
    exercise.sets.some((set) => set.performanceId === setId),
  );
  if (index < 0) return null;
  const exercise = workout.exercises[index];
  const total = exercise.sets.length;
  const doneBefore = exercise.sets.filter((set) => set.isCompleted).length;
  const wasDone = exercise.sets.some((set) => set.performanceId === setId && set.isCompleted);
  const doneAfter = doneBefore + (recorded.isCompleted && !wasDone ? 1 : 0);
  const newRecord = recorded.isPersonalRecord === true && !recordsBefore.has(setId);
  return {
    setId,
    exerciseName: exercise.actualExerciseName,
    record: !newRecord ? 'none' : recordsBefore.size === 0 ? 'first' : 'again',
    segment:
      total > 0 && doneAfter !== doneBefore
        ? { index, from: (100 * doneBefore) / total, to: (100 * doneAfter) / total }
        : null,
  };
}

/** The pinned pill's sentence on a record: "New personal record · Back squat 52.5 kg × 5". */
export function recordNotice(exerciseName: string, recorded: WorkoutSetSaveView): string {
  const unit =
    recorded.actualLoadUnit === 'Kilogram' ? 'kg' : recorded.actualLoadUnit === 'Pound' ? 'lb' : '';
  const load =
    recorded.actualLoad === null || recorded.actualLoad === undefined
      ? ''
      : `${recorded.actualLoad} ${unit}`.trim();
  const reps =
    recorded.actualRepetitions === null || recorded.actualRepetitions === undefined
      ? ''
      : `× ${recorded.actualRepetitions}`;
  const detail = [exerciseName, load, reps].filter((part) => part !== '').join(' ');
  return $localize`New personal record · ${detail}:detail:`;
}

/** The buzz where the phone gives one: 25 ms for a tick, the app's own pattern for a record. */
export function buzzSet(record: boolean, navigator: Navigator): void {
  if (typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(record ? [80, 40, 80] : 25);
  } catch {
    // A browser that refuses: the moment is the same without it.
  }
}

/** The tick draws in with GSAP's `back.out(3)`, the chip pops with `back.out(4)`. */
const TICK_EASE = /* @__PURE__ */ linearEasing(backOut(3));
const CHIP_EASE = /* @__PURE__ */ linearEasing(backOut(4));

/**
 * Plays the moment on the rendered rows: the done row springs from scale .96 (450 ms), its tick
 * draws from scale .4 and a turn of -30° (500 ms), and a record pops its chip from scale .5 (550 ms) and bursts dots
 * from the chip's centre in a fixed, `aria-hidden` layer that leaves when the last dot has gone
 * (under 1.2 s). Nothing here blocks the next tap. The exercise's segment grows on its own: its
 * bar is clipped to its share and the stylesheet transitions the clip (W9, today-training.scss), so
 * this moment no longer scales it (it did until W9, which would have doubled the growth).
 */
export function playSetMoment(host: HTMLElement, moment: SetMoment, motion: Motion): void {
  if (!motion.allowed(SET_MOMENT)) return;
  const row = findRow(host, moment.setId);
  if (row) {
    row.animate([{ transform: 'scale(0.96)' }, { transform: 'none' }], {
      duration: 450,
      easing: EASE.backOut,
    });
    row
      .querySelector('.done-tick')
      ?.animate([{ transform: 'scale(0.4) rotate(-30deg)' }, { transform: 'none' }], {
        duration: 500,
        easing: TICK_EASE,
      });
  }
  if (moment.record !== 'none' && row) {
    const chip = row.querySelector('.pr-badge');
    if (chip) {
      chip.animate([{ transform: 'scale(0.5)' }, { transform: 'none' }], {
        duration: 550,
        easing: CHIP_EASE,
      });
      burst(host, chip, BURST_DOTS[moment.record]);
    }
  }
}

/** The set's row, found by the id the template writes on it (a GUID, so the selector is safe). */
function findRow(host: HTMLElement, setId: string): HTMLElement | null {
  if (!/^[\w-]+$/.test(setId)) return null;
  return host.querySelector<HTMLElement>(`.set-card[data-set-id="${setId}"]`);
}

/**
 * `count` dots from the anchor's centre, every third one white, 34 to 68 px out, shrinking to .3 and
 * fading over 0.8 to 1.1 s, in a layer over the page that no tap can hit. The layer is removed once
 * every dot has finished, however the animations end.
 */
function burst(host: HTMLElement, anchor: Element, count: number): void {
  const document = host.ownerDocument;
  const rect = anchor.getBoundingClientRect();
  const centreX = rect.left + rect.width / 2;
  const centreY = rect.top + rect.height / 2;
  const layer = document.createElement('div');
  layer.className = 'set-burst';
  layer.setAttribute('aria-hidden', 'true');
  Object.assign(layer.style, {
    position: 'fixed',
    inset: '0',
    overflow: 'hidden',
    pointerEvents: 'none',
    zIndex: '18',
  });
  const finished: Promise<unknown>[] = [];
  for (let index = 0; index < count; index++) {
    const dot = document.createElement('span');
    Object.assign(dot.style, {
      position: 'absolute',
      left: `${centreX - 4}px`,
      top: `${centreY - 4}px`,
      width: '8px',
      height: '8px',
      borderRadius: '50%',
      background: index % 3 === 0 ? '#ffffff' : 'var(--tb-accent, #d9ed94)',
    });
    layer.append(dot);
    const angle = (Math.PI * 2 * index) / count + Math.random() * 0.3;
    const distance = 34 + Math.random() * 34;
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance;
    const animation = dot.animate(
      [
        { transform: 'none', opacity: 1 },
        { transform: `translate(${x}px, ${y}px) scale(0.3)`, opacity: 0 },
      ],
      { duration: 800 + Math.random() * 300, easing: EASE.out, fill: 'forwards' },
    );
    finished.push(animation.finished.catch(() => undefined));
  }
  host.append(layer);
  void Promise.all(finished).then(() => layer.remove());
}
