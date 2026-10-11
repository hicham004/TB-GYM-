import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  signal,
} from '@angular/core';

/** How long "Rest is over" stays on screen. */
const OVER_NOTE_MS = 6_000;
/** An end first noticed this late (a phone left locked) is shown, not buzzed or played. */
const LATE_END_MS = 3_000;
const BUZZ = [200, 100, 200];
/** The ring's circumference (2π × 25), as `stroke-dasharray` in the styles. */
const RING = 157;

/**
 * The workout player's rest timer (plan §4 `RestTimer`, M2). A logged set starts it, and it counts
 * from the clock, not from ticks, so a locked phone or a throttled tab still ends on time. At zero
 * it says "Rest is over" on screen and to a screen reader, buzzes where the phone can, and plays a
 * short tone where the browser allows one: an iPhone keeps it silent on the silent switch, and the
 * tone needs `prepareSound` inside the tap that started the rest. While the card is up, focus never
 * scrolls a control underneath it (WCAG 2.4.11).
 */
@Component({
  selector: 'app-rest-timer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="tb-visually-hidden" aria-live="polite" aria-atomic="true">{{ announcement() }}</p>
    @if (remaining() > 0) {
      <aside class="rest" role="timer" aria-label="Rest timer" i18n-aria-label>
        <svg viewBox="0 0 60 60" width="60" height="60" aria-hidden="true">
          <circle class="track" cx="30" cy="30" r="25" />
          <circle
            class="fill"
            cx="30"
            cy="30"
            r="25"
            transform="rotate(-90 30 30)"
            [attr.stroke-dashoffset]="ring()"
          />
        </svg>
        <div class="time">
          <small i18n>Rest</small><strong>{{ clock() }}</strong>
        </div>
        <button type="button" (click)="add()" i18n>+15 s</button>
        <button type="button" (click)="stop()" i18n>Skip</button>
      </aside>
    } @else if (over()) {
      <div class="rest over">
        <div class="time">
          <strong i18n>Rest is over</strong><small i18n>Next set when you’re ready.</small>
        </div>
        <button type="button" (click)="dismiss()" i18n>Dismiss</button>
      </div>
    }
  `,
  styles: `
    .rest {
      align-items: center;
      background: var(--tb-brand-strong);
      border-radius: 1.25rem;
      box-shadow: 0 1rem 2rem #0007;
      box-sizing: border-box;
      color: #fff;
      display: flex;
      gap: 0.8rem;
      inset-block-end: calc(var(--tb-client-tabs-block-size, env(safe-area-inset-bottom)) + 1rem);
      inset-inline: 1rem;
      margin-inline: auto;
      max-inline-size: 36rem;
      padding: 0.8rem;
      position: fixed;
      z-index: 21;
    }
    .time {
      display: grid;
      min-inline-size: 0;
    }
    strong {
      font-size: 1.6rem;
      font-variant-numeric: tabular-nums;
    }
    .over strong {
      font-size: 1.15rem;
    }
    small {
      color: #c9d6cd;
    }
    .track,
    .fill {
      fill: none;
      stroke-width: 6;
    }
    .track {
      stroke: #ffffff33;
    }
    .fill {
      stroke: var(--tb-accent);
      stroke-dasharray: 157;
      stroke-linecap: round;
    }
    button {
      background: #ffffff1c;
      border: 0;
      border-radius: 0.75rem;
      color: inherit;
      cursor: pointer;
      font: inherit;
      font-weight: 650;
      min-block-size: 2.75rem;
      padding: 0.6rem 0.9rem;
      touch-action: manipulation;
    }
    button:first-of-type {
      margin-inline-start: auto;
    }
    button:focus-visible {
      outline: 3px solid var(--tb-accent);
      outline-offset: 3px;
    }
    .over {
      background: var(--tb-accent);
      color: var(--tb-on-accent);
    }
    .over small {
      color: inherit;
    }
    .over button {
      background: #11201b1f;
    }
    .over button:focus-visible {
      outline-color: var(--tb-on-accent);
    }
    @media (prefers-reduced-motion: no-preference) {
      .rest {
        animation: rest-in 200ms cubic-bezier(0.22, 1, 0.36, 1);
      }
      @keyframes rest-in {
        from {
          opacity: 0;
          transform: translateY(1rem);
        }
      }
    }
    @media (forced-colors: active) {
      .rest {
        border: 1px solid CanvasText;
      }
    }
  `,
})
export class RestTimer {
  private readonly root = inject(DOCUMENT).documentElement;
  private readonly tone = new EndTone();
  private readonly until = signal<number | null>(null);
  private readonly total = signal(0);
  private readonly now = signal(Date.now());
  private ticks: ReturnType<typeof setInterval> | null = null;
  private overNote: ReturnType<typeof setTimeout> | null = null;

  protected readonly over = signal(false);
  protected readonly announcement = signal('');
  protected readonly remaining = computed(() => {
    const until = this.until();
    return until === null ? 0 : Math.max(0, Math.ceil((until - this.now()) / 1000));
  });
  protected readonly ring = computed(() => RING * (1 - this.remaining() / (this.total() || 1)));
  protected readonly clock = computed(() => {
    const seconds = this.remaining();
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  });

  constructor() {
    effect(() => {
      // Room for the card at the foot of the page, so focus never lands underneath it.
      this.root.style.scrollPaddingBlockEnd = this.remaining() > 0 || this.over() ? '8rem' : '';
    });
    inject(DestroyRef).onDestroy(() => {
      this.clearTimers();
      this.root.style.scrollPaddingBlockEnd = '';
      this.tone.close();
    });
  }

  /** Call inside the tap that may start a rest: browsers play a later tone only once a tap allowed it. */
  prepareSound(): void {
    this.tone.prepare();
  }

  /** Starts a rest of `seconds`, replacing any rest or "Rest is over" on screen. */
  start(seconds: number): void {
    if (!(seconds > 0)) return;
    this.clearTimers();
    this.over.set(false);
    this.announcement.set('');
    const now = Date.now();
    this.now.set(now);
    this.total.set(seconds);
    this.until.set(now + seconds * 1000);
    this.ticks = setInterval(() => this.tick(), 250);
  }

  /** Ends a rest without a word: Skip, a finished workout, another coaching space. */
  stop(): void {
    this.clearTimers();
    this.until.set(null);
    this.dismiss();
    this.tone.rest();
  }

  protected add(): void {
    this.until.update((until) => (until ?? Date.now()) + 15_000);
    this.total.update((total) => total + 15);
  }

  protected dismiss(): void {
    if (this.overNote) clearTimeout(this.overNote);
    this.overNote = null;
    this.over.set(false);
    this.announcement.set('');
  }

  private tick(): void {
    const now = Date.now();
    this.now.set(now);
    const until = this.until();
    if (until !== null && now >= until) this.finish(now - until);
  }

  private finish(lateBy: number): void {
    this.clearTimers();
    this.until.set(null);
    this.over.set(true);
    this.announcement.set($localize`Rest is over.`);
    if (lateBy < LATE_END_MS) {
      if ('vibrate' in navigator) navigator.vibrate(BUZZ);
      this.tone.play();
    } else {
      this.tone.rest();
    }
    this.overNote = setTimeout(() => this.dismiss(), OVER_NOTE_MS);
  }

  private clearTimers(): void {
    if (this.ticks) clearInterval(this.ticks);
    this.ticks = null;
    if (this.overNote) clearTimeout(this.overNote);
    this.overNote = null;
  }
}

type AudioContextClass = typeof AudioContext;

/**
 * Two short beeps through Web Audio, best effort: no tone where the browser has no Web Audio or has
 * not been allowed to play. The context only runs between the tap that prepares it and the tone.
 */
class EndTone {
  private context: AudioContext | null = null;

  prepare(): void {
    const Context =
      globalThis.AudioContext ??
      (globalThis as { webkitAudioContext?: AudioContextClass }).webkitAudioContext;
    if (!Context) return;
    try {
      this.context ??= new Context();
      if (this.context.state !== 'running') void this.context.resume().catch(() => undefined);
    } catch {
      this.context = null;
    }
  }

  play(): void {
    const context = this.context;
    if (!context || context.state !== 'running') return;
    try {
      const start = context.currentTime;
      for (const offset of [0, 0.22]) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.frequency.value = 880;
        gain.gain.setValueAtTime(0.0001, start + offset);
        gain.gain.exponentialRampToValueAtTime(0.3, start + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.16);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(start + offset);
        oscillator.stop(start + offset + 0.18);
      }
    } catch {
      // A tone is a courtesy; the screen and the screen reader already said it.
    }
    setTimeout(() => this.rest(), 600);
  }

  /** Lets the audio hardware sleep until the next tap prepares it again. */
  rest(): void {
    if (this.context?.state === 'running') void this.context.suspend().catch(() => undefined);
  }

  close(): void {
    void this.context?.close().catch(() => undefined);
    this.context = null;
  }
}
