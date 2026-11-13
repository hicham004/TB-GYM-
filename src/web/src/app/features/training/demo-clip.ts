import {
  afterNextRender,
  afterRenderEffect,
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ButtonLink } from '../../ui/button';
import { chosenDemo, type ClipDemo, type ClipMedia, DemoClips } from './demo-clips';

type ClipState = 'waiting' | 'loading' | 'ready' | 'press' | 'tile' | 'none' | 'empty';

/** How far outside the screen a clip starts to load, so it is ready as it scrolls in. */
const AHEAD = '200px 0px';

/**
 * What takes a press's place, one at a time: the clip's own button, a link's Watch on, the picture,
 * the press again, or the words saying the demo can't be opened.
 */
const AFTER_PRESS =
  '[data-clip-toggle], [data-watch-external], img, [data-clip-press], [data-clip-empty]';

/**
 * An exercise's demo that plays like a GIF (notes plan N9b4, C20's fourth slice): an uploaded MP4 or
 * WebM plays muted, looping and inline, with no controls of the browser's, a picture stays a
 * picture, and a YouTube or Vimeo link opens on its own site (C18, MED-016). Nothing is asked for
 * until the clip is close to the screen, a clip off the screen stops, and every clip that plays by
 * itself can be paused (WCAG 2.2.2): with its own button, or, for a `decorative` clip in a list,
 * with the one button the page offers for all of them (`DemoClips.paused`). A person who asked for
 * reduced motion or less data gets the clip's first frame as a still, and a press plays it.
 *
 * The box keeps its shape while it loads (4:3, `--demo-clip-ratio`), so nothing moves when the clip
 * arrives; it disappears when there is nothing to show, unless a press asked for it, which is told
 * the demo can't be opened. Where no grant can be had now (the visit holds as many as it should, or
 * the ask failed) a clip waits for a press; a list's thumbnail, with no press of its own, stays a
 * quiet box and asks again when it next comes near, or on the list's "Play demos". Without an
 * IntersectionObserver nothing loads by itself: a clip waits for a press, a thumbnail stays quiet.
 */
@Component({
  selector: 'app-demo-clip',
  imports: [ButtonLink, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.decorative]': 'decorative()',
    '[class.is-link]': "!decorative() && media()?.kind === 'link'",
    '[class.is-none]': "state() === 'none'",
    '[attr.aria-hidden]': "decorative() ? 'true' : null",
    '[attr.data-clip-state]': 'state()',
  },
  template: `
    @if (media(); as shown) {
      @switch (shown.kind) {
        @case ('video') {
          <video
            #video
            class="media"
            muted
            loop
            playsinline
            disablepictureinpicture
            disableremoteplayback
            [muted]="true"
            [attr.preload]="still ? 'metadata' : 'auto'"
            [src]="still ? shown.url + '#t=0.001' : shown.url"
            [attr.aria-label]="decorative() ? null : altText()"
            (playing)="playing.set(true)"
            (pause)="playing.set(false)"
            (error)="failed()"
          ></video>
          @if (!decorative()) {
            <button
              type="button"
              class="toggle"
              data-clip-toggle
              [attr.aria-label]="playing() ? pauseLabel : playLabel"
              (click)="toggle()"
            >
              <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                @if (playing()) {
                  <path d="M7 5v10M13 5v10" />
                } @else {
                  <path class="fill" d="M7 4.75v10.5L15.5 10z" />
                }
              </svg>
            </button>
          }
        }
        @case ('picture') {
          <!-- Focusable by script alone, so it can take the focus a press held; its alt names it. -->
          <img
            #picture
            class="media"
            decoding="async"
            [attr.tabindex]="decorative() ? null : -1"
            [src]="shown.url"
            [alt]="decorative() ? '' : altText()"
            (error)="failed()"
          />
        }
        @case ('link') {
          @if (decorative()) {
            <ng-container [ngTemplateOutlet]="tileGlyph" />
          } @else {
            <div class="external">
              <p i18n>
                This demo is a video on {{ shown.provider }}. It opens there, in a new tab.
              </p>
              <a
                appButton
                variant="outlined"
                size="touch"
                [href]="shown.url"
                target="_blank"
                rel="noopener noreferrer"
                data-watch-external
                ><ng-container i18n>Watch on {{ shown.provider }}</ng-container
                ><span class="tb-visually-hidden" i18n> (opens in a new tab)</span></a
              >
            </div>
          }
        }
      }
    } @else if (state() === 'press' && !decorative()) {
      <button type="button" class="press" data-clip-press (click)="press()">
        <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path class="fill" d="M7 4.75v10.5L15.5 10z" />
        </svg>
        @if (showsPicture()) {
          <span i18n>Show the demo</span>
        } @else {
          <span i18n>Play the demo</span>
        }
      </button>
    } @else if (state() === 'empty') {
      <p class="empty" tabindex="-1" data-clip-empty i18n>This demo can’t be opened.</p>
    } @else if (state() === 'tile') {
      <!-- A list's link alone draws a play sign: its video waits on the exercise's page. -->
      <ng-container [ngTemplateOutlet]="tileGlyph" />
    }

    <ng-template #tileGlyph>
      <span class="tile">
        <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path class="fill" d="M7 4.75v10.5L15.5 10z" />
        </svg>
      </span>
    </ng-template>
  `,
  styles: `
    :host {
      aspect-ratio: var(--demo-clip-ratio, 4 / 3);
      background: var(--tb-surface-2);
      border-radius: var(--tb-radius-card-small);
      display: block;
      overflow: hidden;
      position: relative;
    }

    :host(.is-none) {
      display: none;
    }

    // A link's words take the room they need instead of a picture's box.
    :host(.is-link) {
      aspect-ratio: auto;
      background: none;
      overflow: visible;
    }

    .media {
      block-size: 100%;
      display: block;
      inline-size: 100%;
      object-fit: contain;
    }

    svg {
      block-size: 1.25rem;
      fill: none;
      inline-size: 1.25rem;
      stroke: currentColor;
      stroke-linecap: round;
      stroke-width: 2;
    }

    svg .fill {
      fill: currentColor;
      stroke-linejoin: round;
      stroke-width: 1;
    }

    // Over any clip, light or dark: the night colour, a little see-through.
    .toggle {
      align-items: center;
      background: color-mix(in srgb, var(--tb-night, #0d1915) 72%, transparent);
      border: 1px solid rgb(255 255 255 / 0.4);
      border-radius: 999px;
      block-size: 2.75rem;
      color: #fff;
      cursor: pointer;
      display: inline-flex;
      inline-size: 2.75rem;
      inset-block-end: 0.5rem;
      inset-inline-end: 0.5rem;
      justify-content: center;
      padding: 0;
      position: absolute;
    }

    .press {
      align-items: center;
      background: none;
      block-size: 100%;
      border: 0;
      color: var(--tb-ink);
      cursor: pointer;
      display: flex;
      flex-direction: column;
      font: inherit;
      font-weight: 600;
      gap: 0.375rem;
      inline-size: 100%;
      justify-content: center;
      padding: 0.5rem;
    }

    .press:focus-visible {
      outline: 2px solid var(--tb-focus);
      outline-offset: -4px;
    }

    // The toggle's fill is night on a light page as on a dark one: a white ring inside it always
    // shows, and the page's focus colour rings it outside.
    .toggle:focus-visible {
      box-shadow: 0 0 0 2px var(--tb-focus);
      outline: 2px solid #fff;
      outline-offset: -4px;
    }

    .empty {
      align-items: center;
      block-size: 100%;
      color: var(--tb-ink);
      display: flex;
      justify-content: center;
      margin: 0;
      padding: 0.5rem;
      text-align: center;
    }

    // A picture or these words, given the focus a press held, fill the box, which clips what is drawn
    // inside it: the ring goes round the box instead, on the page, as a button's does.
    :host(:has(img:focus-visible)),
    :host(:has(.empty:focus-visible)) {
      outline: 3px solid var(--tb-focus);
      outline-offset: 2px;
    }

    img:focus-visible,
    .empty:focus-visible {
      outline: none;
    }

    .tile {
      align-items: center;
      block-size: 100%;
      color: var(--tb-muted);
      display: flex;
      justify-content: center;
    }

    .external {
      align-items: flex-start;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;

      p {
        color: var(--tb-ink);
        margin: 0;
      }
    }
  `,
})
export class DemoClip {
  private readonly clips = inject(DemoClips);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('video');
  private readonly picture = viewChild<ElementRef<HTMLImageElement>>('picture');
  private observer: IntersectionObserver | null = null;
  private ticket = 0;
  private renewed = false;
  private destroyed = false;
  /** A thumbnail whose grant could not be had: it asks again when near, or on "Play demos". */
  private heldBack = false;
  /** Whether `watch` has run: before it, a clip is still finding out whether it can watch. */
  private watched = false;

  /** The exercise's demos in the house's order; `kind` where the pool names it. */
  readonly demos = input.required<readonly ClipDemo[]>();
  readonly exerciseName = input.required<string>();
  /** A thumbnail in a list: hidden from assistive technology, with no button of its own. */
  readonly decorative = input(false, { transform: booleanAttribute });

  protected readonly state = signal<ClipState>('waiting');
  protected readonly media = signal<ClipMedia | null>(null);
  protected readonly playing = signal(false);
  /** Whether the clip is close enough to the screen to load and to play. */
  private readonly near = signal(false);
  /** The browser refused to start it by itself (as a phone saving power can): it waits for a press. */
  private readonly refused = signal(false);
  /** Drawn as its first frame, for a person who asked for reduced motion or less data. */
  protected still = false;

  protected readonly altText = computed(
    () => $localize`How to do ${this.exerciseName()}:exercise:`,
  );
  protected readonly pauseLabel = $localize`Pause the demo`;
  protected readonly playLabel = $localize`Play the demo`;
  /** The pool says the demo it shows is a picture: a press shows it rather than plays it. */
  protected readonly showsPicture = computed(() => chosenDemo(this.demos())?.kind === 'Picture');
  /** A new array of the same demos (every read of a workout makes one) changes nothing. */
  private readonly key = computed(() =>
    this.demos()
      .map((demo) => `${demo.id}:${demo.kind ?? ''}`)
      .join(' '),
  );

  constructor() {
    effect(() => {
      this.key();
      untracked(() => this.restart());
    });
    afterNextRender(() => this.watch());
    let wasPaused = untracked(this.clips.paused);
    effect(() => {
      const paused = this.clips.paused();
      untracked(() => {
        // A press on "Play demos" (a list's one button) is the person's own ask, as this clip's is:
        // a clip the browser held back tries again, and a thumbnail held back near the screen asks
        // again, past a busy visit.
        if (!paused) {
          this.refused.set(false);
          if (wasPaused && this.heldBack && this.near()) void this.load(true);
        }
        wasPaused = paused;
      });
    });
    afterRenderEffect(() => {
      const video = this.video()?.nativeElement;
      if (!video) return;
      const play = this.near() && !this.clips.paused() && !this.refused();
      untracked(() => {
        if (play) this.start(video);
        else if (!video.paused) video.pause();
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.observer?.disconnect();
      this.release();
    });
  }

  /** Its own button: pauses or plays every clip, and this one at once, in the person's own press. */
  protected toggle(): void {
    const video = this.video()?.nativeElement;
    if (!video) return;
    if (this.playing()) {
      this.clips.pause();
      video.pause();
      return;
    }
    this.clips.play();
    this.refused.set(false);
    this.start(video);
  }

  /** "Play the demo" where nothing loaded by itself: the person's own ask, past a busy visit. */
  protected async press(): Promise<void> {
    // The button goes while the clip loads: whatever takes its place takes the focus it held.
    const focused = this.host.contains(this.host.ownerDocument.activeElement);
    this.clips.play();
    this.refused.set(false);
    await this.load(true);
    if (!focused || this.destroyed) return;
    afterNextRender(() => this.host.querySelector<HTMLElement>(AFTER_PRESS)?.focus(), {
      injector: this.injector,
    });
  }

  /**
   * The bytes were refused, as when the 30-minute grant ran out: asked again once, then given up. A
   * fresh grant that could not be asked for refuses nothing: the clip waits to be asked again.
   */
  protected async failed(): Promise<void> {
    const shown = this.media();
    if (shown === null || shown.kind === 'link') return;
    // A clip let go (no address) reports nothing worth asking again for.
    const element = this.video()?.nativeElement ?? this.picture()?.nativeElement;
    if (!element?.getAttribute('src')) return;
    if (this.renewed) {
      this.release();
      this.media.set(null);
      this.state.set('none');
      return;
    }
    this.renewed = true;
    const ticket = this.ticket;
    const renewed = await this.clips.renew(shown.id);
    if (ticket !== this.ticket || this.destroyed) return;
    if (renewed === null) {
      this.release();
      this.media.set(null);
      this.state.set('none');
      return;
    }
    if (renewed === 'press') {
      // The ask could not be sent (no connection, a server error): nothing was refused. It waits to
      // be asked again, and its bytes refused after that may ask once more.
      this.release();
      this.media.set(null);
      this.renewed = false;
      this.holdBack();
      return;
    }
    // The address is the same; the fresh grant's cookie is what changed. Loading again stops a
    // playing clip without a pause event, so it is started again where it should play.
    const video = this.video()?.nativeElement;
    if (video) {
      video.load();
      this.playing.set(false);
      if (this.near() && !this.clips.paused() && !this.refused()) this.start(video);
    }
    const picture = this.picture()?.nativeElement;
    if (picture) picture.src = shown.url;
  }

  private restart(): void {
    ++this.ticket;
    this.renewed = false;
    this.heldBack = false;
    this.refused.set(false);
    this.release();
    this.media.set(null);
    const demos = this.demos();
    if (demos.length === 0) {
      this.state.set('none');
    } else if (this.decorative() && chosenDemo(demos)?.kind === 'VideoLink') {
      // A list never asks a link's grant: a play tile says a video waits on the exercise's page.
      this.state.set('tile');
    } else {
      // Nothing says when it is near: a clip of its own waits for a press, a thumbnail stays quiet.
      const unseen = this.observer === null && this.watched && !this.decorative();
      this.state.set(unseen ? 'press' : 'waiting');
      if (untracked(this.near)) void this.load(false);
    }
  }

  private watch(): void {
    this.watched = true;
    const view = this.host.ownerDocument.defaultView;
    if (!view || typeof view.IntersectionObserver === 'undefined') {
      // A clip of its own waits for a press; a list's thumbnail, which has none, stays quiet.
      if (this.state() === 'waiting' && !this.decorative()) this.state.set('press');
      return;
    }
    this.observer = new view.IntersectionObserver(
      (entries) => {
        const near = entries.some((entry) => entry.isIntersecting);
        this.near.set(near);
        if (near && this.state() === 'waiting') void this.load(false);
      },
      { rootMargin: AHEAD },
    );
    this.observer.observe(this.host);
  }

  private async load(pressed: boolean): Promise<void> {
    const ticket = ++this.ticket;
    this.state.set('loading');
    const answer = await this.clips.show(this.demos(), pressed);
    if (ticket !== this.ticket || this.destroyed) return;
    if (answer === 'press') {
      this.holdBack();
      return;
    }
    this.heldBack = false;
    if (answer === 'none') {
      // A press is told where it was made; a clip that only came near folds away.
      this.state.set(pressed && !this.decorative() ? 'empty' : 'none');
      return;
    }
    this.still = this.clips.paused();
    if (pressed) {
      // The press asked to see it move. Without an observer nothing else says it is near; with
      // one, its own report stands (the clip may have left the screen while its grant came).
      this.still = false;
      if (this.observer === null) this.near.set(true);
    }
    this.media.set(answer);
    this.state.set('ready');
  }

  /**
   * No grant can be had now (a busy visit, or an ask that failed): a clip of its own waits for a
   * press; a list's thumbnail, which has none, goes back to its quiet box and asks again later.
   */
  private holdBack(): void {
    if (this.decorative()) {
      this.heldBack = true;
      this.state.set('waiting');
    } else {
      this.state.set('press');
    }
  }

  private start(video: HTMLVideoElement): void {
    const playing = video.play() as Promise<void> | undefined;
    playing?.catch((error: unknown) => {
      // Refused by the browser (a phone saving power): the still waits for a press. A pause or a
      // removal while it was starting (AbortError) is no refusal.
      if (error instanceof DOMException && error.name === 'NotAllowedError') this.refused.set(true);
    });
  }

  /** Stops the clip and lets its bytes go, as a list scrolls on or the screen closes. */
  private release(): void {
    const video = this.video()?.nativeElement;
    if (!video) return;
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
}
