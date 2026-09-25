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
  // Icon/Chevron down 234:485 (the same stroke `.tb-select` draws as its background image)
  'chevron-down': { size: 20, path: 'M6 8L10 12L14 8' },
  // Show/hide password. Drawn in code on the masters' 20px, 1.5px-stroke grid; not in Figma yet.
  eye: {
    size: 20,
    path:
      'M1.9 10C3.6 6.4 6.5 4.4 10 4.4C13.5 4.4 16.4 6.4 18.1 10C16.4 13.6 13.5 15.6 10 15.6C6.5' +
      ' 15.6 3.6 13.6 1.9 10ZM12.5 10C12.5 11.381 11.381 12.5 10 12.5C8.619 12.5 7.5 11.381 7.5 10' +
      'C7.5 8.619 8.619 7.5 10 7.5C11.381 7.5 12.5 8.619 12.5 10Z',
  },
  'eye-off': {
    size: 20,
    path:
      'M3 3L17 17M8.3 4.6C8.85 4.47 9.42 4.4 10 4.4C13.5 4.4 16.4 6.4 18.1 10C17.6 11.07 16.97 12.01' +
      ' 16.24 12.8M13.9 14.3C12.74 15.14 11.42 15.6 10 15.6C6.5 15.6 3.6 13.6 1.9 10C2.64 8.43 3.64' +
      ' 7.13 4.84 6.2M8.25 8.25C7.8 8.7 7.5 9.32 7.5 10C7.5 11.381 8.619 12.5 10 12.5C10.68 12.5' +
      ' 11.3 12.2 11.75 11.75',
  },
  // The eight coach-sidebar glyphs (Desktop Navigation v1, 118:135), exported from their masters
  // with each master's subpaths joined into one path. Round caps and joins apply to all of them:
  // the masters leave caps and joins at the default only on closed curves and circles, where the
  // choice is invisible. Seven masters also carry a 0.68 group opacity that Icon/Overview lacks;
  // it is not copied, because the navigation spec gives icons the label's full 17.4:1 contrast.
  // Icon/Overview 119:137
  overview: {
    size: 20,
    path:
      'M7.3 2.5H3.7C3.037 2.5 2.5 3.037 2.5 3.7V7.3C2.5 7.963 3.037 8.5 3.7 8.5H7.3C7.963 8.5 8.5' +
      ' 7.963 8.5 7.3V3.7C8.5 3.037 7.963 2.5 7.3 2.5ZM16.3 2.5H12.7C12.037 2.5 11.5 3.037 11.5' +
      ' 3.7V7.3C11.5 7.963 12.037 8.5 12.7 8.5H16.3C16.963 8.5 17.5 7.963 17.5 7.3V3.7C17.5 3.037' +
      ' 16.963 2.5 16.3 2.5ZM7.3 11.5H3.7C3.037 11.5 2.5 12.037 2.5 12.7V16.3C2.5 16.963 3.037 17.5' +
      ' 3.7 17.5H7.3C7.963 17.5 8.5 16.963 8.5 16.3V12.7C8.5 12.037 7.963 11.5 7.3 11.5ZM16.3' +
      ' 11.5H12.7C12.037 11.5 11.5 12.037 11.5 12.7V16.3C11.5 16.963 12.037 17.5 12.7 17.5H16.3' +
      'C16.963 17.5 17.5 16.963 17.5 16.3V12.7C17.5 12.037 16.963 11.5 16.3 11.5Z',
  },
  // Icon/Clients 119:145
  clients: {
    size: 20,
    path:
      'M7.2 9.3C8.746 9.3 10 8.046 10 6.5C10 4.954 8.746 3.7 7.2 3.7C5.654 3.7 4.4 4.954 4.4 6.5' +
      'C4.4 8.046 5.654 9.3 7.2 9.3ZM2.8 16C3.1 13 4.8 11.5 7.2 11.5C9.6 11.5 11.3 13 11.6 16' +
      'M14.1 9.6C15.26 9.6 16.2 8.66 16.2 7.5C16.2 6.34 15.26 5.4 14.1 5.4C12.94 5.4 12 6.34 12' +
      ' 7.5C12 8.66 12.94 9.6 14.1 9.6ZM12.9 12.1C15.5 11.6 17.1 13.1 17.3 15.5',
  },
  // Icon/Training 174:370 (dumbbell)
  training: { size: 20, path: 'M1 8V12M19 8V12M6 10H14M6 5H3V15H6V5ZM14 5H17V15H14V5Z' },
  // Icon/Nutrition 174:377 (fork and knife)
  nutrition: { size: 20, path: 'M3 2V7C3 10 8 10 8 7V2M5.5 2V18M16 18V2C12 4 12 10 16 10' },
  // Icon/Check-ins 119:159
  'check-ins': {
    size: 20,
    path:
      'M15.25 3.5H4.75C3.645 3.5 2.75 4.395 2.75 5.5V15.25C2.75 16.355 3.645 17.25 4.75 17.25H15.25' +
      'C16.355 17.25 17.25 16.355 17.25 15.25V5.5C17.25 4.395 16.355 3.5 15.25 3.5ZM6.5 10L8.7' +
      ' 12.2L13.5 7.2',
  },
  // Icon/Messages 119:165
  messages: { size: 20, path: 'M3 4.5H17V14H8L4 17V14H3V4.5ZM6.5 8H13.5M6.5 10.8H11' },
  // Icon/Products 175:370 (tag with an eyelet)
  products: {
    size: 20,
    path:
      'M10.8 3.05H5.05C3.945 3.05 3.05 3.945 3.05 5.05V10.8L8.739 16.489C9.325 17.075 10.275' +
      ' 17.075 10.861 16.489L16.489 10.861C17.075 10.275 17.075 9.325 16.489 8.739L10.8 3.05Z' +
      'M7 8.25C7.69 8.25 8.25 7.69 8.25 7C8.25 6.31 7.69 5.75 7 5.75C6.31 5.75 5.75 6.31 5.75 7' +
      'C5.75 7.69 6.31 8.25 7 8.25Z',
  },
  // Icon/Settings 175:378 (six-tooth gear around a hub)
  settings: {
    size: 20,
    path:
      'M10 2.75C9.536 2.75 9.072 2.795 8.617 2.883L8.553 4.953C7.727 5.19 6.971 5.626 6.353 6.223' +
      'L4.528 5.244C4.224 5.594 3.953 5.973 3.721 6.375C3.489 6.777 3.296 7.201 3.145 7.64L4.906' +
      ' 8.73C4.698 9.564 4.698 10.436 4.906 11.27L3.145 12.36C3.296 12.799 3.489 13.223 3.721' +
      ' 13.625C3.953 14.027 4.224 14.406 4.528 14.756L6.353 13.777C6.971 14.374 7.727 14.81 8.553' +
      ' 15.047L8.617 17.117C9.072 17.205 9.536 17.25 10 17.25C10.464 17.25 10.928 17.205 11.383' +
      ' 17.117L11.447 15.047C12.273 14.81 13.029 14.374 13.647 13.777L15.472 14.756C15.776 14.406' +
      ' 16.047 14.027 16.279 13.625C16.511 13.223 16.704 12.799 16.855 12.36L15.094 11.27C15.302' +
      ' 10.436 15.302 9.564 15.094 8.73L16.855 7.64C16.704 7.201 16.511 6.777 16.279 6.375C16.047' +
      ' 5.973 15.776 5.594 15.472 5.244L13.647 6.223C13.029 5.626 12.273 5.19 11.447 4.953L11.383' +
      ' 2.883C10.928 2.795 10.464 2.75 10 2.75ZM10 12.25C11.243 12.25 12.25 11.243 12.25 10C12.25' +
      ' 8.757 11.243 7.75 10 7.75C8.757 7.75 7.75 8.757 7.75 10C7.75 11.243 8.757 12.25 10 12.25Z',
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
