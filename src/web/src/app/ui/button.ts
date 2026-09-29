import { booleanAttribute, DestroyRef, Directive, ElementRef, inject, input } from '@angular/core';

/** Action/Button emphasis. Filled is the one primary action in a region. */
export type ButtonVariant = 'filled' | 'accent' | 'outlined' | 'text';
/** Pointer / 40 for desktop; Touch / 48 for touch-first client screens and primary mobile CTAs. */
export type ButtonSize = 'pointer' | 'touch';
export type ButtonType = 'button' | 'submit' | 'reset';

/**
 * Swallows every activation of a busy button before anything else can react to it. Pointer clicks,
 * Enter, Space and a form's implicit submission all reach a button as a `click` event, so one
 * capture-phase listener on the button covers them: at-target capture listeners run before the
 * bubble-phase `(click)` handlers Angular registers, whatever order they were added in, and
 * cancelling the click also cancels the form submission it would have caused.
 */
function blockActivationWhile(isBusy: () => boolean): void {
  const button = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  const guard = (event: Event) => {
    if (!isBusy()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  button.addEventListener('click', guard, { capture: true });
  inject(DestroyRef).onDestroy(() => button.removeEventListener('click', guard, { capture: true }));
}

/**
 * A native `<button>` styled as Action/Button.
 *
 * `type` is required, so every button states whether it submits: an omitted type would silently
 * submit the surrounding form. Use the native `disabled` property only when the action cannot
 * apply; while a request is in flight use `loading` instead. It keeps the button focusable (native
 * `disabled` drops focus to the page), announces it as unavailable through `aria-disabled`, and
 * cancels any further activation. Keep swapping the label to "Saving…" so the state is in text.
 */
@Directive({
  selector: 'button[appButton]',
  host: {
    class: 'tb-button',
    '[attr.type]': 'type()',
    '[class.tb-button--filled]': "variant() === 'filled'",
    '[class.tb-button--accent]': "variant() === 'accent'",
    '[class.tb-button--outlined]': "variant() === 'outlined'",
    '[class.tb-button--text]': "variant() === 'text'",
    '[class.tb-button--touch]': "size() === 'touch'",
    '[class.tb-button--loading]': 'loading()',
    '[attr.aria-disabled]': "loading() ? 'true' : null",
  },
})
export class Button {
  readonly type = input.required<ButtonType>();
  readonly variant = input<ButtonVariant>('filled');
  readonly size = input<ButtonSize>('pointer');
  readonly loading = input(false, { transform: booleanAttribute });

  constructor() {
    blockActivationWhile(() => this.loading());
  }
}

/**
 * A native link styled as Action/Button, for navigation that looks like an action. It stays a real
 * link — href, middle-click, "open in new tab" — so it has no `type`, `disabled` or `loading`: a
 * destination that cannot be followed should not be rendered as a link at all.
 */
@Directive({
  selector: 'a[appButton]',
  host: {
    class: 'tb-button',
    '[class.tb-button--filled]': "variant() === 'filled'",
    '[class.tb-button--accent]': "variant() === 'accent'",
    '[class.tb-button--outlined]': "variant() === 'outlined'",
    '[class.tb-button--text]': "variant() === 'text'",
    '[class.tb-button--touch]': "size() === 'touch'",
  },
})
export class ButtonLink {
  readonly variant = input<ButtonVariant>('filled');
  readonly size = input<ButtonSize>('pointer');
}

/**
 * A native `<button>` styled as Action/Icon button: 40px pointer or 48px touch target holding one
 * decorative `<app-icon>`. `label` is required and becomes the accessible name, because an icon
 * alone names nothing. `type` and `loading` behave as on `appButton`.
 */
@Directive({
  selector: 'button[appIconButton]',
  host: {
    class: 'tb-icon-button',
    '[attr.type]': 'type()',
    '[attr.aria-label]': 'label()',
    '[class.tb-icon-button--touch]': "size() === 'touch'",
    '[class.tb-icon-button--loading]': 'loading()',
    '[attr.aria-disabled]': "loading() ? 'true' : null",
  },
})
export class IconButton {
  readonly type = input.required<ButtonType>();
  readonly label = input.required<string>();
  readonly size = input<ButtonSize>('pointer');
  readonly loading = input(false, { transform: booleanAttribute });

  constructor() {
    blockActivationWhile(() => this.loading());
  }
}
