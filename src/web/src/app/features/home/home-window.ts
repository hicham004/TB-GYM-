import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { type WindowPicture, windowSrc, windowSrcset } from './home-pictures';

/**
 * A window on the coach's screen: one region of the real app, drawn at 1:1 so its text keeps the
 * size a coach reads it at, as AVIF with a WebP fallback at 2x and 1x. `narrow` is the same screen
 * cropped narrower for phones, where a wide crop would shrink its text; the browser picks it below
 * the wide breakpoint.
 */
@Component({
  selector: 'app-home-window',
  template: `
    <picture>
      @if (narrow(); as narrowWindow) {
        <source
          type="image/avif"
          media="(max-width: 1099px)"
          [srcset]="srcset(narrowWindow, 'avif')"
          [attr.width]="narrowWindow.width"
          [attr.height]="narrowWindow.height"
        />
        <source
          type="image/webp"
          media="(max-width: 1099px)"
          [srcset]="srcset(narrowWindow, 'webp')"
          [attr.width]="narrowWindow.width"
          [attr.height]="narrowWindow.height"
        />
      }
      <source type="image/avif" [srcset]="avif()" />
      <img
        [src]="src()"
        [srcset]="webp()"
        [width]="window().width"
        [height]="window().height"
        [alt]="alt()"
        [attr.loading]="eager() ? null : 'lazy'"
        [attr.fetchpriority]="eager() ? 'high' : null"
        decoding="async"
      />
    </picture>
  `,
  styles: `
    :host {
      display: block;
    }

    img {
      block-size: auto;
      display: block;
      inline-size: 100%;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeWindow {
  readonly window = input.required<WindowPicture>();
  readonly narrow = input<WindowPicture | null>(null);
  readonly alt = input('');
  readonly eager = input(false);

  protected readonly avif = computed(() => windowSrcset(this.window(), 'avif'));
  protected readonly webp = computed(() => windowSrcset(this.window(), 'webp'));
  protected readonly src = computed(() => windowSrc(this.window()));

  protected srcset(window: WindowPicture, format: 'avif' | 'webp'): string {
    return windowSrcset(window, format);
  }
}
