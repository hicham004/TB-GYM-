import type { ComponentFixture } from '@angular/core/testing';

/**
 * Test helpers for driving a component through its rendered controls rather than its methods.
 *
 * A spec that calls component methods proves the method works. It cannot prove the screen works,
 * because nothing in it depends on the template being wired to that method at all. Phase 6A-3 paid
 * for that distinction: `checkin-clients` computed its assign-form errors from a plain field, so
 * the computed never re-evaluated, Assign stayed disabled however the form was filled in, and 88
 * green tests reported nothing because not one of them touched a control.
 */

export type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/**
 * Angular's control-value accessors write through the forms pipeline rather than synchronously, so
 * one change-detection pass is not enough: the first flushes the DOM event into the control, the
 * second re-evaluates whatever reads it, and only the third renders the result. Any spec that sets
 * an input and then asserts on a disabled button or a rendered value needs all three.
 *
 * The macrotask yield in the middle drains the microtask queue outright. `whenStable` settles a
 * bounded number of continuations, which is enough for a handler that awaits one or two calls but
 * not for the deeper chains — refresh the token, post, reload the session, reload the workspace,
 * then navigate — where the last step is exactly the one the test is about.
 */
export async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve));
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

/**
 * Finds a control the test is about to drive, and fails naming the selector when it is absent.
 * Without this a renamed or removed control surfaces as `Cannot read properties of null`, which
 * reads like a broken test rather than a missing control.
 */
export function query<T extends Element>(host: ParentNode, selector: string): T {
  const found = host.querySelector<T>(selector);
  if (found === null) {
    throw new Error(`No element matched "${selector}".`);
  }

  return found;
}

function normalize(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Finds a control by the caption a user reads beside it, rather than by the binding that wires it
 * up. A selector written as `input[formControlName="x"]` cannot fail the way the screen fails,
 * because it names the very attribute whose absence is the defect; the caption is what the user
 * aims at, so a control that has lost its binding is still found and still asserted against.
 *
 * Matches the caption element rather than the whole label, so help text under a field does not
 * change how that field is addressed. Dense controls that carry an `aria-label` instead of a
 * visible caption are found by that, since it is the name the control actually announces.
 */
export function field<T extends Control = HTMLInputElement>(host: ParentNode, label: string): T {
  const wanted = normalize(label);
  const captioned = Array.from(host.querySelectorAll('label')).filter((candidate) => {
    const caption = candidate.querySelector('span');
    return normalize(caption?.textContent ?? candidate.textContent) === wanted;
  });

  if (captioned.length > 1) {
    throw new Error(`${captioned.length} fields are labelled "${label}".`);
  }

  if (captioned.length === 1) {
    const control = captioned[0].querySelector<T>('input, select, textarea');
    if (control === null) {
      throw new Error(`The field labelled "${label}" has no control in it.`);
    }

    return control;
  }

  const described = Array.from(
    host.querySelectorAll<T>('input[aria-label], select[aria-label], textarea[aria-label]'),
  ).filter((candidate) => normalize(candidate.getAttribute('aria-label')) === wanted);

  if (described.length === 0) {
    throw new Error(`No field is labelled "${label}".`);
  }

  if (described.length > 1) {
    throw new Error(`${described.length} fields are labelled "${label}".`);
  }

  return described[0];
}

/**
 * Sets a control's value and reports it the way that kind of control reports. Selects announce
 * through `change`, not `input`, so a select driven with an input event silently keeps its old
 * value and the spec ends up asserting against a form the user never actually changed.
 */
function write<T extends Control>(control: T, value: string): T {
  control.value = value;
  control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input'));
  return control;
}

/** Fills the control captioned `label` — text, number, date, textarea or select alike. */
export function fill(host: ParentNode, label: string, value: string): Control {
  return write(field<Control>(host, label), value);
}

/** Ticks or unticks the checkbox captioned `label`. Checkboxes also announce through `change`. */
export function tick(host: ParentNode, label: string, checked = true): HTMLInputElement {
  const box = field<HTMLInputElement>(host, label);
  box.checked = checked;
  box.dispatchEvent(new Event('change'));
  return box;
}

/** Types into a control found by selector, for the ones no label points at. */
export function type(host: ParentNode, selector: string, value: string): Control {
  return write(query<Control>(host, selector), value);
}

/** Picks an option in a select found by selector. */
export function choose(host: ParentNode, selector: string, value: string): HTMLSelectElement {
  return write(query<HTMLSelectElement>(host, selector), value);
}

/** Clicks a control, failing if it is disabled, because a user cannot click a disabled button. */
export function click(host: ParentNode, selector: string): HTMLElement {
  const target = query<HTMLElement>(host, selector);
  if ('disabled' in target && (target as { disabled: boolean }).disabled) {
    throw new Error(`"${selector}" is disabled, so a user could not have clicked it.`);
  }

  target.click();
  return target;
}

/**
 * Clicks the button whose visible text is `label`. Screens with several actions side by side are
 * addressed the way a user addresses them, rather than by position in the document.
 */
export function button(host: ParentNode, label: string): HTMLButtonElement {
  const wanted = normalize(label);
  const matches = Array.from(host.querySelectorAll('button')).filter(
    (candidate) => normalize(candidate.textContent) === wanted,
  );

  if (matches.length === 0) {
    throw new Error(`No button is labelled "${label}".`);
  }

  if (matches.length > 1) {
    throw new Error(`${matches.length} buttons are labelled "${label}".`);
  }

  return matches[0];
}

/** Presses the button captioned `label`, failing if it is disabled. */
export function press(host: ParentNode, label: string): HTMLButtonElement {
  const target = button(host, label);
  if (target.disabled) {
    throw new Error(`The "${label}" button is disabled, so a user could not have pressed it.`);
  }

  target.click();
  return target;
}

/** The visible text of the whole rendered component, for asserting what a user can read. */
export function text(fixture: ComponentFixture<unknown>): string {
  return (fixture.nativeElement as HTMLElement).textContent ?? '';
}
