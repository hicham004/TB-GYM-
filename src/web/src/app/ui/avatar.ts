import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The seven Identity/Avatar presentations drawn in Figma (66:29), named for where they are used.
 * Presets rather than free size/tone/shape inputs, so only approved combinations exist.
 */
export type AvatarPresentation =
  | 'coach-account' // 36 circle, neutral
  | 'top-bar-user' // 32 circle, inverse
  | 'client' // 40 circle, neutral
  | 'client-warning' // 40 circle, warning
  | 'client-danger' // 40 circle, danger
  | 'mobile-account' // 48 rounded, accent
  | 'message-sender'; // 40 rounded, neutral

/**
 * Initials-only identity mark. Always hidden from assistive technology: the person's name is the
 * adjacent visible text, and an interactive wrapper (never the avatar) owns the touch target and
 * the accessible name. Tone is decoration and must never be the only signal of a client's state.
 * `dir="auto"` keeps initials from another script in their own reading order.
 */
@Component({
  selector: 'app-avatar',
  template: `{{ initials() }}`,
  styles: `
    :host {
      --avatar-size: var(--control-height-40);
      align-items: center;
      background-color: var(--color-surface-subtle);
      block-size: var(--avatar-size);
      border-radius: var(--radius-full);
      color: var(--color-text-primary);
      display: inline-flex;
      flex: none;
      font-size: var(--text-metadata-size);
      font-weight: var(--font-weight-strong);
      inline-size: var(--avatar-size);
      justify-content: center;
      line-height: var(--text-metadata-line-height);
      overflow: hidden;
      user-select: none;
      white-space: nowrap;
    }

    :host(.coach-account) {
      --avatar-size: 36px;
    }

    :host(.top-bar-user) {
      --avatar-size: var(--control-height-32);
      background-color: var(--color-text-primary);
      color: var(--color-on-accent);
    }

    :host(.client-warning) {
      background-color: var(--color-warning-subtle);
      color: var(--color-warning);
    }

    :host(.client-danger) {
      background-color: var(--color-danger-subtle);
      color: var(--color-danger);
    }

    :host(.mobile-account) {
      --avatar-size: var(--control-height-48);
      background-color: var(--color-accent-subtle);
      border-radius: var(--radius-8);
      color: var(--color-accent);
      font-size: var(--text-compact-size);
      line-height: var(--text-compact-line-height);
    }

    :host(.message-sender) {
      border-radius: var(--radius-8);
    }
  `,
  host: {
    'aria-hidden': 'true',
    dir: 'auto',
    '[class]': 'presentation()',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Avatar {
  /** One or two characters, as the caller wants them shown; nothing is derived from a name here. */
  readonly initials = input.required<string>();
  readonly presentation = input<AvatarPresentation>('client');
}
