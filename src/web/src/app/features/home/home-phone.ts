import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { PHONE_SIZE, phoneSrc, phoneSrcset } from './home-pictures';

/**
 * The client's phone: a screen of the sample demo under Apple's iPhone 17 bezel, as AVIF with a
 * WebP fallback at three widths, so the browser fetches the one its slot and screen need. Lazy by
 * default: a phone the layout does not draw (the stage's, on a phone) is never fetched.
 */
@Component({
  selector: 'app-home-phone',
  template: `
    <picture>
      <source type="image/avif" [srcset]="avif()" [sizes]="sizes()" />
      <img
        [src]="src()"
        [srcset]="webp()"
        [sizes]="sizes()"
        [width]="size.width"
        [height]="size.height"
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
export class HomePhone {
  /** The picture's name in public/images/home, for example `client-today`. */
  readonly screen = input.required<string>();
  /** The `sizes` the slot draws the phone at, so the right width is fetched. */
  readonly sizes = input('330px');
  /** Empty where a nearby text says what the screen shows (the figure is decorative then). */
  readonly alt = input('');
  /** The hero's phone on a wide screen: fetched with the document, ahead of the rest. */
  readonly eager = input(false);

  protected readonly size = PHONE_SIZE;
  protected readonly avif = computed(() => phoneSrcset(this.screen(), 'avif'));
  protected readonly webp = computed(() => phoneSrcset(this.screen(), 'webp'));
  protected readonly src = computed(() => phoneSrc(this.screen()));
}
