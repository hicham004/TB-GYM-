import type { GsapModules } from './home-motion';

/** One feature row: its two screens arrive from opposite sides, and its phone drifts. */
export interface MotionRow {
  readonly row: HTMLElement;
  /** The coach's window, which slides in from its own side of the row. */
  readonly window: HTMLElement;
  /** The client's phone, which comes in from the other side, rising. */
  readonly phone: HTMLElement;
  /** The eyebrow, the sentence and the link, which follow the screens in (the headline has its own). */
  readonly words: readonly HTMLElement[];
  /** Whether the phone sits at the row's start, so its window comes in from the end. */
  readonly phoneFirst: boolean;
}

/** The finale: its closing line, what follows the line in, its light and its lime pill. */
export interface MotionFinale {
  readonly section: HTMLElement;
  readonly title: HTMLElement;
  /** The eyebrow and the two ways in, which follow the closing line. */
  readonly after: readonly HTMLElement[];
  /** The hero's green light, which drifts toward the pointer. */
  readonly glow: HTMLElement;
  /** What holds the lime pill, which leans toward a pointer that comes close. */
  readonly magnet: HTMLElement;
}

/** What the motion below the week needs (UI plan R6.2k). */
export interface HomeMotionBelow {
  readonly rows: readonly MotionRow[];
  /** The product facts: the list, and its items, whose dots are drawn at the scale `--dot`. */
  readonly facts: { readonly list: HTMLElement; readonly items: readonly HTMLElement[] } | null;
  /** Who it's for: the halves, and the two screens that rise in as they arrive. */
  readonly who: { readonly halves: HTMLElement; readonly shots: readonly HTMLElement[] } | null;
  readonly finale: MotionFinale | null;
}

/**
 * Finds the parts below the week in the rendered page, by the classes their stylesheets draw them
 * with. It lives here, in the chunk that loads with GSAP, so a phone never downloads it.
 */
export function findBelow(page: ParentNode): HomeMotionBelow {
  const all = (within: ParentNode, selector: string) =>
    Array.from(within.querySelectorAll<HTMLElement>(selector));
  const rows = all(page, '.row').flatMap((row) => {
    const window = row.querySelector<HTMLElement>('.pair__window');
    const phone = row.querySelector<HTMLElement>('.pair__phone');
    if (!window || !phone) return [];
    return [
      {
        row,
        window,
        phone,
        words: all(row, '.row__eyebrow, .row__body, .row__link'),
        phoneFirst: row.classList.contains('row--phone-first'),
      },
    ];
  });
  const list = page.querySelector<HTMLElement>('.facts__list');
  const halves = page.querySelector<HTMLElement>('.who__halves');
  const section = page.querySelector<HTMLElement>('.finale');
  const title = section?.querySelector<HTMLElement>('.finale__title');
  const glow = section?.querySelector<HTMLElement>('.finale__glow');
  const magnet = section?.querySelector<HTMLElement>('.finale__magnet');
  return {
    rows,
    facts: list ? { list, items: all(list, ':scope > li') } : null,
    who: halves ? { halves, shots: all(halves, '.half__shot') } : null,
    finale:
      section && title && glow && magnet
        ? {
            section,
            title,
            after: all(section, '.finale__eyebrow, .finale__start, .finale__talk'),
            glow,
            magnet,
          }
        : null,
  };
}

/** How far down the screen each part has to reach before it plays in. */
const LINE = { row: 0.72, facts: 0.85, who: 0.78, finale: 0.86 } as const;

/** How close the pointer comes before the lime pill leans toward it, in CSS px. */
const PULL_RADIUS = 130;

/** Only a part still below its line is hidden ahead of its entrance; what the reader sees stays. */
function ahead(element: Element, line: number): boolean {
  return element.getBoundingClientRect().top > innerHeight * line;
}

function at(line: number): string {
  return `top ${Math.round(line * 100)}%`;
}

/** A mouse or a trackpad: the light and the pill follow a pointer, never a finger. */
function finePointer(): boolean {
  return (
    typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches
  );
}

/**
 * The motion below the week (UI plan R6.2k), set up inside HomeMotion's wide-screen context so
 * GSAP reverts every tween and trigger when the query stops matching. Each entrance plays once and
 * starts from the finished page: a part is hidden ahead of it only while it is still below its
 * line, and its inline styles are cleared when it ends, so the stylesheet's own states (the band's
 * hover, the rows' fit) hold again. Fades use opacity, never visibility, so a link that has not
 * arrived yet is still reached by the keyboard, whose focus scrolls it in and plays it.
 *
 * 5a and 5b: a row's window slides in from its own side and its phone from the other, rising, with
 * the eyebrow, the sentence and the link after them; while the row scrolls past, the phone's
 * picture drifts a little slower than the page. 5d: the facts come in one after another, each dot
 * popping on. 5e: who it's for's two screens rise in. 5f: the finale's closing line rises word by
 * word once the fonts are in, its eyebrow and ways in follow, and for a mouse the green light
 * drifts toward the pointer and the lime pill leans toward it.
 *
 * Returns what undoes the parts the context cannot: the finale's listeners and its split.
 */
export function startBelow(
  { gsap, SplitText }: GsapModules,
  below: HomeMotionBelow,
  fonts: Promise<unknown>,
): () => void {
  let live = true;
  const undo: (() => void)[] = [];
  const settled = { ease: 'power3.out', clearProps: 'transform,opacity' };

  for (const row of below.rows) {
    if (ahead(row.row, LINE.row)) {
      gsap
        .timeline({
          scrollTrigger: { trigger: row.row, start: at(LINE.row), once: true },
          defaults: settled,
        })
        .from(row.window, { x: row.phoneFirst ? 110 : -110, opacity: 0, duration: 1.2 }, 0)
        .from(row.phone, { x: row.phoneFirst ? -110 : 110, y: 50, opacity: 0, duration: 1.2 }, 0.1)
        .from(row.words, { y: 18, opacity: 0, duration: 0.7, stagger: 0.08 }, 0.05);
    }
    // The phone's picture, not the phone, so the drift never fights the entrance.
    const picture = row.phone.firstElementChild;
    if (picture) {
      gsap.fromTo(
        picture,
        { y: -26 },
        {
          y: 26,
          ease: 'none',
          scrollTrigger: { trigger: row.row, start: 'top bottom', end: 'bottom top', scrub: 0.4 },
        },
      );
    }
  }

  const facts = below.facts;
  if (facts && ahead(facts.list, LINE.facts)) {
    gsap
      .timeline({ scrollTrigger: { trigger: facts.list, start: at(LINE.facts), once: true } })
      .from(facts.items, { y: 16, opacity: 0, duration: 0.7, stagger: 0.07, ...settled }, 0)
      .from(facts.items, { '--dot': 0, duration: 0.55, stagger: 0.07, ease: 'back.out(3)' }, 0.18);
  }

  const who = below.who;
  if (who && ahead(who.halves, LINE.who)) {
    gsap.from(who.shots, {
      y: 70,
      opacity: 0,
      duration: 1.2,
      stagger: 0.16,
      ...settled,
      scrollTrigger: { trigger: who.halves, start: at(LINE.who), once: true },
    });
  }

  const finale = below.finale;
  if (finale) {
    if (ahead(finale.title, LINE.finale)) {
      gsap.from(finale.after, {
        y: 16,
        opacity: 0,
        duration: 0.7,
        stagger: 0.08,
        delay: 0.35,
        ...settled,
        scrollTrigger: { trigger: finale.title, start: at(LINE.finale), once: true },
      });
      // The words are split once the fonts are in, so they are the ones the reader sees.
      void fonts.then(() => {
        if (!live) return;
        const split = SplitText.create(finale.title, {
          type: 'words',
          mask: 'words',
          autoSplit: true,
          onSplit: (self) =>
            gsap.from(self.words, {
              yPercent: 115,
              duration: 1.05,
              stagger: 0.075,
              ease: 'power4.out',
              scrollTrigger: { trigger: finale.title, start: at(LINE.finale), once: true },
            }),
        });
        undo.push(() => split.revert());
      });
    }
    if (finePointer()) undo.push(followThePointer(gsap, finale));
  }

  return () => {
    live = false;
    for (const step of undo) step();
  };
}

/**
 * 5f for a mouse: the finale's green light drifts toward the pointer, and the lime pill leans
 * toward it once it comes within reach, springing back when it leaves. Positions come from the
 * layout (offsets), which the movement itself never changes.
 */
function followThePointer(gsap: GsapModules['gsap'], finale: MotionFinale): () => void {
  const lightX = gsap.quickTo(finale.glow, 'x', { duration: 1.4, ease: 'power3.out' });
  const lightY = gsap.quickTo(finale.glow, 'y', { duration: 1.4, ease: 'power3.out' });
  const pillX = gsap.quickTo(finale.magnet, 'x', { duration: 0.45, ease: 'power3.out' });
  const pillY = gsap.quickTo(finale.magnet, 'y', { duration: 0.45, ease: 'power3.out' });
  let pulled = false;

  const release = () => {
    pulled = false;
    gsap.to(finale.magnet, {
      x: 0,
      y: 0,
      duration: 0.9,
      ease: 'elastic.out(1, 0.45)',
      overwrite: true,
    });
  };

  const move = (event: PointerEvent) => {
    const area = finale.section.getBoundingClientRect();
    lightX(event.clientX - area.left - (finale.glow.offsetLeft + finale.glow.offsetWidth / 2));
    lightY(event.clientY - area.top - (finale.glow.offsetTop + finale.glow.offsetHeight / 2));

    const holder = (finale.magnet.offsetParent as HTMLElement | null) ?? finale.section;
    const origin = holder.getBoundingClientRect();
    const dx =
      event.clientX - (origin.left + finale.magnet.offsetLeft + finale.magnet.offsetWidth / 2);
    const dy =
      event.clientY - (origin.top + finale.magnet.offsetTop + finale.magnet.offsetHeight / 2);
    if (Math.hypot(dx, dy) < PULL_RADIUS) {
      pulled = true;
      pillX(dx * 0.22);
      pillY(dy * 0.32);
    } else if (pulled) {
      release();
    }
  };

  const leave = () => {
    lightX(0);
    lightY(0);
    if (pulled) release();
  };

  finale.section.addEventListener('pointermove', move);
  finale.section.addEventListener('pointerleave', leave);
  return () => {
    finale.section.removeEventListener('pointermove', move);
    finale.section.removeEventListener('pointerleave', leave);
  };
}
