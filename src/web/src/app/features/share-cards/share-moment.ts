import { EASE, linearEasing, type Motion } from '../../core/motion/motion';

/**
 * The share card in the hand (docs/MOTION-PLAN-2026-11.md, W10). On the finish summary the share
 * card's face follows the pointer: a mouse over it presses the face down where the pointer is (up
 * to 12° each way, `--rx` and `--ry` written once per frame, the card's own `perspective`) and a
 * sheen slides across it; a finger (or a held mouse) drags it, shifting and turning it against a
 * rubber band (iOS's `c·d·x / (c·x + d)`, c = 0.55, so it never travels past 120 px), and when let
 * go a spring returns it to its rest over 650 ms on the teaser's own landing curve. A gesture's
 * first touch brings the face to the pointer over 150 ms, from wherever a spring left it, so
 * nothing snaps. The face keeps its touches from the player's swipe. Everything writes the DOM
 * directly on the Web Animations API through `Motion`'s read (no signals, no change detection per
 * frame, no GSAP); with reduced motion or the switch on the card stays as it is.
 */

/** The row of the motion plan this moment belongs to, so `tb-motion-off = W10` turns it off alone. */
export const SHARE_HAND = 'W10';
/** The tilt at the card's edge, in degrees. */
export const TILT_MAX = 12;
/** How far a drag can take the card, in px: the rubber band's asymptote. */
export const DRAG_LIMIT = 120;
/** iOS's rubber-band constant. */
export const DRAG_RESISTANCE = 0.55;
/** The turn at the drag's limit, in degrees. */
export const TURN_MAX = 6;
/** The face comes to the pointer over this long when a gesture starts. */
export const APPROACH_MS = 150;
/** The spring back to rest, when let go. */
export const SPRING_MS = 650;
/** The sheen's reach across the face, as a percentage of its width each way. */
const SHEEN_REACH = 50;

/** GSAP's `elastic.out(1, period)`, the teaser's landing curve (period .6). */
export function elasticOut(period: number): (t: number) => number {
  const shift = period / 4;
  return (t) =>
    t === 0 || t === 1
      ? t
      : Math.pow(2, -10 * t) * Math.sin(((t - shift) * 2 * Math.PI) / period) + 1;
}

/** The spring as the browser draws it: `elastic.out(1, .6)` through 32 steps (about 330 bytes). */
export const SPRING = /* @__PURE__ */ linearEasing(elasticOut(0.6), 32);

/**
 * iOS's rubber band: the card follows `distance` closely at first and ever less, never reaching
 * `limit` however far the finger goes.
 */
export function rubberBand(
  distance: number,
  limit = DRAG_LIMIT,
  resistance = DRAG_RESISTANCE,
): number {
  const x = Math.abs(distance);
  const pulled = (resistance * limit * x) / (resistance * x + limit);
  return distance < 0 ? -pulled : pulled;
}

export interface Pose {
  /** Degrees around the horizontal axis: positive presses the top edge away. */
  readonly rx: number;
  /** Degrees around the vertical axis: positive presses the right edge away. */
  readonly ry: number;
  /** The drag's shift, in px. */
  readonly dx: number;
  readonly dy: number;
  /** The drag's turn, in degrees. */
  readonly rz: number;
  /** Where the sheen sits, as a percentage of the face's width from its centre. */
  readonly sx: number;
}

/** The face at rest. */
export const REST: Pose = { rx: 0, ry: 0, dx: 0, dy: 0, rz: 0, sx: 0 };

/**
 * Where a pointer is on a box, -1 to 1 each way from its centre (past that beyond its edges): the
 * card's rest box, so the face's own tilt never feeds back into the reading.
 */
export function placeOn(
  box: { left: number; top: number; width: number; height: number },
  x: number,
  y: number,
): { nx: number; ny: number } {
  return {
    nx: box.width > 0 ? ((x - box.left) / box.width) * 2 - 1 : 0,
    ny: box.height > 0 ? ((y - box.top) / box.height) * 2 - 1 : 0,
  };
}

/**
 * The pose for a pointer at (nx, ny), pulled (pullX, pullY) px from where it grabbed: pressed down
 * where the pointer is, shifted against the rubber band, turned with the shift, the sheen under
 * the pointer.
 */
export function poseFor(nx: number, ny: number, pullX = 0, pullY = 0): Pose {
  const dx = rubberBand(pullX);
  const dy = rubberBand(pullY);
  return {
    rx: 0 - clamp(ny) * TILT_MAX,
    ry: clamp(nx) * TILT_MAX,
    dx,
    dy,
    rz: (dx / DRAG_LIMIT) * TURN_MAX,
    sx: clamp(nx) * SHEEN_REACH,
  };
}

/** The face's transform for a pose, in the order its stylesheet composes it; `none` at rest. */
export function transformOf(pose: Pose): string {
  if (pose.rx === 0 && pose.ry === 0 && pose.dx === 0 && pose.dy === 0 && pose.rz === 0) {
    return 'none';
  }
  return (
    `translate(${round(pose.dx)}px, ${round(pose.dy)}px) rotate(${round(pose.rz)}deg) ` +
    `rotateX(${round(pose.rx)}deg) rotateY(${round(pose.ry)}deg)`
  );
}

const POSE_PROPERTIES = ['--rx', '--ry', '--dx', '--dy', '--rz'] as const;
const TOUCHES = ['touchstart', 'touchmove', 'touchend', 'touchcancel'] as const;

/**
 * Puts the card's face in the hand until the returned function lets it go: the pointer's moves
 * pose it (one frame at a time), a press grabs it with pointer capture, a release or a leave
 * springs it back. The card (the face's parent, which never tilts) is what listens and what the
 * pointer is read against: a pressed edge moves inward on the screen, and a listener on the face
 * itself would lose the pointer there, let go and take it again in a flicker. `motion` is asked
 * once per gesture, so reduced motion and the switch leave the card still; the touch events stop
 * at the card either way, so the player's swipe never sees them.
 */
export function holdShareCard(face: HTMLElement, motion: Motion): () => void {
  const view = face.ownerDocument.defaultView;
  if (!view) return noop;
  const hand = face.parentElement ?? face;
  const keep = (event: Event) => event.stopPropagation();
  for (const type of TOUCHES) hand.addEventListener(type, keep, { passive: true });

  let pointer: { x: number; y: number } | null = null;
  let grab: { id: number; x: number; y: number } | null = null;
  let held = false;
  let frame = 0;
  let pose = REST;
  let approach: Animation | null = null;
  let approachFrom = 'none';
  let spring: Animation | null = null;

  const canAnimate = () => typeof face.animate === 'function';
  const current = () => view.getComputedStyle(face).transform || 'none';

  /** One write per frame: the pose from the latest pointer, the approach retargeted to it. */
  const paint = () => {
    frame = 0;
    if (!pointer) return;
    const { nx, ny } = placeOn(hand.getBoundingClientRect(), pointer.x, pointer.y);
    pose = grab ? poseFor(nx, ny, pointer.x - grab.x, pointer.y - grab.y) : poseFor(nx, ny);
    const style = face.style;
    style.setProperty('--rx', `${round(pose.rx)}deg`);
    style.setProperty('--ry', `${round(pose.ry)}deg`);
    style.setProperty('--dx', `${round(pose.dx)}px`);
    style.setProperty('--dy', `${round(pose.dy)}px`);
    style.setProperty('--rz', `${round(pose.rz)}deg`);
    style.setProperty('--sx', `${round(pose.sx)}%`);
    if (approach) {
      (approach.effect as KeyframeEffect | null)?.setKeyframes([
        { transform: approachFrom },
        { transform: transformOf(pose) },
      ]);
    }
  };
  const schedule = () => {
    if (!frame) frame = view.requestAnimationFrame(paint);
  };

  /** A gesture's first touch: the face comes to the pointer over 150 ms from wherever it was. */
  const take = () => {
    if (held) return;
    held = true;
    face.classList.add('held');
    const from = spring ? current() : 'none';
    spring?.cancel();
    spring = null;
    approach?.cancel();
    approach = null;
    if (!canAnimate()) return;
    approachFrom = from;
    const own = face.animate([{ transform: from }, { transform: from }], {
      duration: APPROACH_MS,
      easing: EASE.out,
    });
    approach = own;
    const done = () => {
      if (approach === own) approach = null;
    };
    own.finished.then(done, done);
  };

  /** Let go: the face springs back to rest over 650 ms and the sheen fades. */
  const release = () => {
    if (!held) return;
    held = false;
    grab = null;
    pointer = null;
    if (frame) {
      view.cancelAnimationFrame(frame);
      frame = 0;
    }
    face.classList.remove('held');
    const from = approach ? current() : transformOf(pose);
    approach?.cancel();
    approach = null;
    pose = REST;
    for (const name of POSE_PROPERTIES) face.style.removeProperty(name);
    if (from === 'none' || !canAnimate()) return;
    const own = face.animate([{ transform: from }, { transform: 'none' }], {
      duration: SPRING_MS,
      easing: SPRING,
    });
    spring = own;
    const done = () => {
      if (spring === own) spring = null;
    };
    own.finished.then(done, done);
  };

  const onMove = (event: PointerEvent) => {
    if (grab) {
      if (event.pointerId !== grab.id) return;
    } else if (event.pointerType === 'touch' || (!held && !motion.allowed(SHARE_HAND))) {
      return;
    } else {
      take();
    }
    pointer = { x: event.clientX, y: event.clientY };
    schedule();
  };
  const onDown = (event: PointerEvent) => {
    if (grab || (event.pointerType === 'mouse' && event.button !== 0)) return;
    if (!held && !motion.allowed(SHARE_HAND)) return;
    grab = { id: event.pointerId, x: event.clientX, y: event.clientY };
    try {
      hand.setPointerCapture?.(event.pointerId);
    } catch {
      // A pointer already gone: the drag ends with its next event anyway.
    }
    // No text selection under a mouse that drags the card.
    if (event.pointerType !== 'touch') event.preventDefault();
    take();
    pointer = { x: event.clientX, y: event.clientY };
    schedule();
  };
  const onUp = (event: PointerEvent) => {
    if (!grab || event.pointerId !== grab.id) return;
    release();
  };
  const onLeave = () => {
    if (!grab) release();
  };

  hand.addEventListener('pointermove', onMove);
  hand.addEventListener('pointerdown', onDown);
  hand.addEventListener('pointerup', onUp);
  hand.addEventListener('pointercancel', onUp);
  hand.addEventListener('pointerleave', onLeave);

  return () => {
    hand.removeEventListener('pointermove', onMove);
    hand.removeEventListener('pointerdown', onDown);
    hand.removeEventListener('pointerup', onUp);
    hand.removeEventListener('pointercancel', onUp);
    hand.removeEventListener('pointerleave', onLeave);
    for (const type of TOUCHES) hand.removeEventListener(type, keep);
    // Let go without a spring: the card is leaving the page.
    held = false;
    grab = null;
    pointer = null;
    if (frame) view.cancelAnimationFrame(frame);
    frame = 0;
    approach?.cancel();
    approach = null;
    spring?.cancel();
    spring = null;
    pose = REST;
    face.classList.remove('held');
    for (const name of [...POSE_PROPERTIES, '--sx']) face.style.removeProperty(name);
  };
}

function clamp(value: number): number {
  return Math.min(1, Math.max(-1, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function noop(): void {
  // No window to listen in.
}
