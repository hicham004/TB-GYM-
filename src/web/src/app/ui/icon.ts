import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Glyph geometry copied from the Figma icon masters (1.5px round strokes on a 20px or 16px frame).
 * Only the glyphs a primitive or the UI lab uses are listed; add a master's path when a screen needs
 * it, rather than importing an icon library for a handful of shapes.
 */
const GLYPHS = {
  // Icon/Plus 42:4
  plus: { size: 20, path: 'M10 4V16M4 10H16' },
  // Icon/Notification 98:47 (Figma's float artifacts such as 16.1999 rounded to three decimals)
  bell: {
    size: 20,
    path:
      'M8.2 16.2C8.6 17 9.2 17.4 10 17.4C10.8 17.4 11.4 17 11.8 16.2M4.5 14.5H15.5L14.3 12.8V8.2' +
      'C14.3 7.06 13.847 5.966 13.041 5.159C12.234 4.353 11.14 3.9 10 3.9C8.86 3.9 7.766 4.353' +
      ' 6.959 5.159C6.153 5.966 5.7 7.06 5.7 8.2V12.8L4.5 14.5Z',
  },
  // Icon/Check 64:19 (drawn without the master's 14px clip frame, so no stroke is trimmed)
  'check-circle': {
    size: 16,
    path:
      'M4.5 8L6.8 10.3L11.5 5.7M15 8C15 11.866 11.866 15 8 15C4.134 15 1 11.866 1 8C1 4.134' +
      ' 4.134 1 8 1C11.866 1 15 4.134 15 8Z',
  },
} as const satisfies Record<string, { size: number; path: string }>;

export type IconName = keyof typeof GLYPHS;

/**
 * A decorative SVG glyph in the current text colour. It is always hidden from assistive technology:
 * meaning belongs to adjacent text or to the control that contains it (an icon-only button carries
 * its own accessible name), never to the picture alone.
 */
@Component({
  selector: 'app-icon',
  template: `<svg
    [attr.viewBox]="viewBox()"
    [attr.width]="glyph().size"
    [attr.height]="glyph().size"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    focusable="false"
    aria-hidden="true"
  >
    <path [attr.d]="glyph().path" />
  </svg>`,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
      line-height: 0;
    }

    svg {
      display: block;
    }
  `,
  host: { class: 'tb-icon', 'aria-hidden': 'true' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Icon {
  readonly name = input.required<IconName>();

  protected readonly glyph = computed(() => GLYPHS[this.name()]);
  protected readonly viewBox = computed(() => `0 0 ${this.glyph().size} ${this.glyph().size}`);
}
