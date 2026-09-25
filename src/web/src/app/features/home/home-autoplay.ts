import { DestroyRef, ElementRef, afterNextRender, computed, inject, signal } from '@angular/core';

type HoldSource = 'pointer' | 'focus';

/**
 * Auto-advancing steps for the homepage demos (the coaching loop and the product tour).
 *
 * The active step's progress bar is a CSS animation and its `animationend` calls `advance`, so the
 * bar and the step cannot disagree, and pausing the animation pauses the timer. The demo runs only
 * while it is on screen in a visible tab, the visitor is neither pointing at it nor focused inside
 * it, has not pressed pause, and has not asked the system for reduced motion. Moving content that
 * starts by itself needs a pause control (WCAG 2.2.2); `togglePaused` backs it.
 */
export class Autoplay {
  readonly active = signal(0);
  readonly paused = signal(false);
  private readonly onScreen = signal(false);
  private readonly pageVisible = signal(true);
  private readonly holds = signal<ReadonlySet<HoldSource>>(new Set());

  readonly running = computed(
    () =>
      !this.reducedMotion &&
      !this.paused() &&
      this.onScreen() &&
      this.pageVisible() &&
      this.holds().size === 0,
  );

  constructor(
    readonly count: number,
    readonly reducedMotion: boolean,
  ) {}

  select(index: number): void {
    this.active.set(index);
  }

  advance(): void {
    this.active.update((index) => (index + 1) % this.count);
  }

  togglePaused(): void {
    this.paused.update((paused) => !paused);
  }

  hold(source: HoldSource, held: boolean): void {
    this.holds.update((current) => {
      const next = new Set(current);
      if (held) next.add(source);
      else next.delete(source);
      return next;
    });
  }

  /** Focus moving between controls inside the demo keeps it held; leaving the demo releases it. */
  focusOut(event: FocusEvent): void {
    const region = event.currentTarget as Node | null;
    const next = event.relatedTarget as Node | null;
    if (!region?.contains(next)) this.hold('focus', false);
  }

  setOnScreen(onScreen: boolean): void {
    this.onScreen.set(onScreen);
  }

  setPageVisible(visible: boolean): void {
    this.pageVisible.set(visible);
  }
}

/** Creates an `Autoplay` that watches its component's host for visibility. */
export function injectAutoplay(count: number): Autoplay {
  const host: HTMLElement = inject(ElementRef).nativeElement;
  const destroyRef = inject(DestroyRef);
  const reducedMotion =
    typeof globalThis.matchMedia === 'function' &&
    globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const autoplay = new Autoplay(count, reducedMotion);

  afterNextRender(() => {
    const document = host.ownerDocument;
    const onVisibility = () => autoplay.setPageVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onVisibility);

    let observer: IntersectionObserver | undefined;
    if (typeof IntersectionObserver === 'function') {
      observer = new IntersectionObserver(
        ([entry]) => autoplay.setOnScreen(entry?.isIntersecting ?? false),
        { threshold: 0.35 },
      );
      observer.observe(host);
    } else {
      autoplay.setOnScreen(true);
    }

    destroyRef.onDestroy(() => {
      document.removeEventListener('visibilitychange', onVisibility);
      observer?.disconnect();
    });
  });

  return autoplay;
}
