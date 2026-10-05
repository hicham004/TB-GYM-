import { InjectionToken, signal } from '@angular/core';

/**
 * What one save came to: kept; failed for a reason that may pass (offline, a server error);
 * refused for this content, so the next change tries again (too long a program); or stopped for
 * good, because saving again cannot help (another tab moved on, a read-only coaching space).
 */
export type SaveOutcome = 'saved' | 'retry' | 'refused' | 'stopped';

/** Where the builder's changes stand, for the status line and the leave guard. */
export type AutosaveStatus = 'saved' | 'pending' | 'saving' | 'retrying' | 'refused' | 'stopped';

export interface AutosaveTiming {
  /** How long the coach pauses before the program is sent. */
  quietMs: number;
  /** The longest a change waits unsent while the coach keeps working. */
  maxWaitMs: number;
  /** The wait after a failed save; it doubles each time, up to the longest. */
  retryMs: number;
  retryMaxMs: number;
}

export const AUTOSAVE_TIMING: AutosaveTiming = {
  quietMs: 1200,
  maxWaitMs: 8000,
  retryMs: 4000,
  retryMaxMs: 60_000,
};

/** The builder's timing; a spec provides its own to save at once or to hold saves back. */
export const PROGRAM_AUTOSAVE_TIMING = new InjectionToken<AutosaveTiming>(
  'PROGRAM_AUTOSAVE_TIMING',
  {
    factory: () => AUTOSAVE_TIMING,
  },
);

/**
 * The program builder's autosave (TRN-024): one save at a time, sent once the coach pauses and
 * never more than a few seconds behind, retried with growing waits when it fails for a reason that
 * may pass. The page says how to send the program and what each answer means; this decides when.
 */
export class DraftAutosave {
  readonly status = signal<AutosaveStatus>('saved');

  private edits = 0;
  private savedEdits = 0;
  private firstUnsentAt: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private retryWait = 0;
  private held = false;
  /** Moves on every reset, so a save that lands after one changes nothing. */
  private generation = 0;

  constructor(
    private readonly send: () => Promise<SaveOutcome>,
    private readonly timing: AutosaveTiming = AUTOSAVE_TIMING,
    private readonly now: () => number = Date.now,
  ) {}

  /** True while something on screen is not on the server yet. */
  get hasUnsaved(): boolean {
    return this.edits > this.savedEdits || this.inFlight !== null;
  }

  /** An edit was made: it is sent once the coach pauses. */
  changed(): void {
    this.edits += 1;
    const status = this.status();
    if (status === 'stopped' || this.held) return;
    this.firstUnsentAt ??= this.now();
    // A save in flight sends again when it lands; a failed one keeps its wait.
    if (this.inFlight || status === 'retrying') return;
    this.status.set('pending');
    this.schedule(this.quietDelay());
  }

  /** Sends now. Resolves true once everything on screen is on the server. */
  async flush(): Promise<boolean> {
    this.clearTimer();
    for (;;) {
      if (this.inFlight) {
        await this.inFlight;
        continue;
      }
      if (this.status() === 'stopped') return false;
      if (this.edits === this.savedEdits) return true;
      await this.run();
      const after = this.status();
      if (after === 'retrying' || after === 'refused' || after === 'stopped') return false;
    }
  }

  /** Stops sending and waits for a save in flight: a discard is about to replace the draft. */
  async hold(): Promise<void> {
    this.held = true;
    this.clearTimer();
    while (this.inFlight) await this.inFlight;
  }

  /** Sends again after a hold that changed nothing. */
  release(): void {
    this.held = false;
    if (this.edits > this.savedEdits && this.status() !== 'stopped') {
      this.status.set('pending');
      this.schedule(this.quietDelay());
    }
  }

  /** The page holds what the server holds again (opened, published or discarded). */
  reset(): void {
    this.generation += 1;
    this.clearTimer();
    this.inFlight = null;
    this.edits = 0;
    this.savedEdits = 0;
    this.firstUnsentAt = null;
    this.retryWait = 0;
    this.held = false;
    this.status.set('saved');
  }

  /** The page is going: nothing more is sent from it. */
  dispose(): void {
    this.generation += 1;
    this.clearTimer();
  }

  private run(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    const generation = this.generation;
    const edits = this.edits;
    this.clearTimer();
    this.status.set('saving');
    this.firstUnsentAt = null;
    const attempt = (async () => {
      let outcome: SaveOutcome;
      try {
        outcome = await this.send();
      } catch {
        outcome = 'retry';
      }
      if (generation !== this.generation) return;
      this.inFlight = null;
      this.landed(outcome, edits);
    })();
    this.inFlight = attempt;
    return attempt;
  }

  private landed(outcome: SaveOutcome, edits: number): void {
    switch (outcome) {
      case 'saved':
        this.savedEdits = Math.max(this.savedEdits, edits);
        this.retryWait = 0;
        if (this.edits > this.savedEdits) {
          this.firstUnsentAt ??= this.now();
          this.status.set('pending');
          if (!this.held) this.schedule(this.quietDelay());
        } else {
          this.status.set('saved');
        }
        return;
      case 'retry':
        this.retryWait =
          this.retryWait === 0
            ? this.timing.retryMs
            : Math.min(this.retryWait * 2, this.timing.retryMaxMs);
        this.status.set('retrying');
        if (!this.held) this.schedule(this.retryWait);
        return;
      case 'refused':
        // Nothing is sent again until the coach changes something (`changed` resumes).
        this.status.set('refused');
        return;
      case 'stopped':
        this.status.set('stopped');
        return;
    }
  }

  private schedule(delay: number): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, delay);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** The quiet wait, cut short so no change waits unsent longer than the longest wait. */
  private quietDelay(): number {
    const waited = this.firstUnsentAt === null ? 0 : this.now() - this.firstUnsentAt;
    return Math.max(0, Math.min(this.timing.quietMs, this.timing.maxWaitMs - waited));
  }
}
