import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  ViewEncapsulation,
  afterNextRender,
  inject,
  signal,
} from '@angular/core';
import { Icon } from './icon';

/**
 * Wraps one password input with a show/hide eye button:
 *
 *   <label for="sign-in-password"><span>Password</span></label>
 *   <app-password-reveal><input id="sign-in-password" type="password" … /></app-password-reveal>
 *
 * Keep it outside the input's <label>: a button inside a label is invalid HTML and is read out as
 * part of the field's name. A shown password has spellcheck off, so no browser spelling service
 * receives it, and the field turns back into a password field whenever its form submits, so
 * password managers still recognise what was entered.
 */
@Component({
  selector: 'app-password-reveal',
  imports: [Icon],
  template: `
    <ng-content />
    <button
      type="button"
      class="password-reveal__toggle"
      [attr.aria-controls]="inputId()"
      (click)="show(!visible())"
    >
      <app-icon [name]="visible() ? 'eye-off' : 'eye'" />
      <span class="tb-visually-hidden">
        @if (visible()) {
          <ng-container i18n>Hide password</ng-container>
        } @else {
          <ng-container i18n>Show password</ng-container>
        }
      </span>
    </button>
  `,
  // Unscoped so the rule can reach the projected input; every selector is prefixed by the element.
  styles: `
    app-password-reveal {
      display: block;
      position: relative;
    }

    app-password-reveal > input {
      padding-inline-end: 48px;
    }

    .password-reveal__toggle {
      align-items: center;
      background: none;
      border: 0;
      border-radius: 5px;
      color: var(--muted-text);
      cursor: pointer;
      display: flex;
      inline-size: 44px;
      inset-block: 0;
      inset-inline-end: 0;
      justify-content: center;
      padding: 0;
      position: absolute;
    }

    .password-reveal__toggle:hover {
      color: var(--text);
    }
  `,
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PasswordReveal {
  private readonly host: HTMLElement = inject(ElementRef).nativeElement;
  private input: HTMLInputElement | null = null;

  protected readonly visible = signal(false);
  protected readonly inputId = signal<string | null>(null);

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const input = this.host.querySelector('input');
      if (input === null) return;

      this.input = input;
      input.spellcheck = false;
      input.setAttribute('autocapitalize', 'none');
      this.inputId.set(input.id || null);

      const form = input.form;
      const hide = () => this.show(false);
      form?.addEventListener('submit', hide);
      destroyRef.onDestroy(() => form?.removeEventListener('submit', hide));
    });
  }

  protected show(visible: boolean): void {
    if (this.input === null) return;
    this.input.type = visible ? 'text' : 'password';
    this.visible.set(visible);
  }
}
