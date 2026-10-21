import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  Injector,
} from '@angular/core';

/**
 * A form's one summary region (ARCHITECTURE §8): an assertive live region that is in the page from the
 * form's first render, so assistive technology has registered it before anything lands in it, and that
 * says nothing until a submit is refused. Empty, it is out of sight and out of the form's gap but stays
 * in the accessibility tree; with something to say, it is the tinted box the refusal reads in.
 * `tabindex="-1"` lets it take focus without entering the tab order.
 *
 * The form writes what it says: "Check the fields marked above." when the form refused the submit
 * itself, and the first wrong box takes focus then; or the server's own words, which `focus()` brings
 * to the person. Put it inside the form, just above the actions.
 */
@Component({
  selector: 'app-form-summary',
  template: '<ng-content />',
  host: { role: 'alert', tabindex: '-1' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      background: var(--tb-danger-soft);
      border-radius: var(--tb-radius-control);
      color: var(--tb-danger);
      display: block;
      font-weight: 600;
      margin: 0;
      overflow-wrap: anywhere;
      padding: 0.625rem 0.875rem;
      // Focus and a scroll bring it clear of a sheet's sticky action bar below it.
      scroll-margin-block: 1rem 5rem;
    }

    :host(:focus) {
      outline: none;
    }

    :host(:focus-visible) {
      outline: 3px solid var(--tb-focus);
      outline-offset: 2px;
    }

    // Empty: registered for assistive technology, but taking no room and showing nothing.
    :host(:empty) {
      block-size: 1px;
      clip-path: inset(50%);
      inline-size: 1px;
      overflow: hidden;
      padding: 0;
      position: absolute;
      white-space: nowrap;
    }
  `,
})
export class FormSummary {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);

  /**
   * Moves focus here once what it says is drawn, so a refusal is read where the person already is, and
   * scrolls it into view above a sticky action bar. A summary with nothing to say is left alone.
   */
  focus(): void {
    afterNextRender(
      () => {
        if (!this.element.textContent?.trim()) return;
        this.element.focus({ preventScroll: true });
        this.element.scrollIntoView?.({ block: 'nearest' });
      },
      { injector: this.injector },
    );
  }
}
