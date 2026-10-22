import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { query, settle } from '../../testing/dom';
import { TYPEAHEAD_PAUSE_MS, UiSelect, type SelectOption } from './select';

const EQUIPMENT: SelectOption[] = [
  { value: 'Barbell', label: 'Barbell' },
  { value: 'Bands', label: 'Bands', hint: 'Light, medium or heavy' },
  { value: 'Bodyweight', label: 'Bodyweight' },
  { value: 'Cable', label: 'Cable', disabled: true },
  { value: 'Dumbbell', label: 'Dumbbell' },
  { value: 'Kettlebell', label: 'Kettlebell' },
];

@Component({
  imports: [UiSelect],
  template: `
    <button type="button" id="before">Before</button>
    <app-select
      label="Equipment"
      placeholder="Choose equipment…"
      [options]="options()"
      [help]="help()"
      [errors]="errors()"
      [(value)]="value"
      (touched)="touched()"
    />
    <button type="button" id="after">After</button>
  `,
})
class Host {
  readonly options = signal<SelectOption[]>(EQUIPMENT);
  readonly value = signal('');
  readonly help = signal<string | null>(null);
  readonly errors = signal<string[] | null>(null);
  readonly outer = vi.fn<(event: KeyboardEvent) => void>();
  readonly touched = vi.fn();
}

@Component({
  imports: [UiSelect, ReactiveFormsModule],
  template: `<app-select label="Equipment" [options]="options" [formControl]="control" />`,
})
class FormHost {
  readonly options = EQUIPMENT;
  readonly control = new FormControl('Dumbbell', { nonNullable: true });
}

async function render() {
  await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  await settle(fixture);
  const host = fixture.nativeElement as HTMLElement;
  // What a sheet around the field would see: any key the field lets through.
  host.addEventListener('keydown', (event) => fixture.componentInstance.outer(event));
  document.body.appendChild(host);
  return { fixture, host, component: fixture.componentInstance };
}

type Rendered = Awaited<ReturnType<typeof render>>;

const trigger = (host: HTMLElement) => query<HTMLButtonElement>(host, 'button.trigger');
const option = (host: HTMLElement, value: string) =>
  query<HTMLElement>(host, `[role="option"][data-value="${value}"]`);
const active = () => document.activeElement as HTMLElement | null;

async function open({ fixture, host }: Rendered) {
  trigger(host).click();
  await settle(fixture);
}

async function press(
  { fixture }: Rendered,
  key: string,
  options: KeyboardEventInit = {},
): Promise<KeyboardEvent> {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
  (document.activeElement ?? document.body).dispatchEvent(event);
  await settle(fixture);
  return event;
}

describe('UiSelect', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
    TestBed.resetTestingModule();
  });

  it('says what to choose, then the choice, and is named by its label and the choice together', async () => {
    const { fixture, host, component } = await render();

    expect(trigger(host).textContent?.trim()).toBe('Choose equipment…');
    expect(trigger(host).getAttribute('aria-haspopup')).toBe('listbox');
    expect(trigger(host).getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('[role="listbox"]')).toBeNull();

    component.value.set('Kettlebell');
    await settle(fixture);

    expect(trigger(host).textContent?.trim()).toBe('Kettlebell');
    const names = trigger(host)
      .getAttribute('aria-labelledby')!
      .split(' ')
      .map((id) => host.querySelector(`#${id}`)?.textContent?.trim());
    expect(names).toEqual(['Equipment', 'Kettlebell']);
    expect(host.querySelector('label')?.getAttribute('for')).toBe(trigger(host).id);
  });

  it('opens its list under the button on the chosen option, the only one in the tab order', async () => {
    const view = await render();
    view.component.value.set('Bodyweight');
    await settle(view.fixture);
    await open(view);

    const list = query(view.host, '[role="listbox"]');
    expect(trigger(view.host).getAttribute('aria-expanded')).toBe('true');
    expect(trigger(view.host).getAttribute('aria-controls')).toBe(list.id);
    expect(list.getAttribute('aria-labelledby')).toBe(query(view.host, 'label').id);
    expect(active()).toBe(option(view.host, 'Bodyweight'));
    expect(option(view.host, 'Bodyweight').getAttribute('aria-selected')).toBe('true');
    expect(option(view.host, 'Bodyweight').getAttribute('tabindex')).toBe('0');
    expect(option(view.host, 'Barbell').getAttribute('aria-selected')).toBe('false');
    expect(option(view.host, 'Barbell').getAttribute('tabindex')).toBe('-1');
    expect(option(view.host, 'Bands').textContent).toContain('Light, medium or heavy');
    expect(option(view.host, 'Cable').getAttribute('aria-disabled')).toBe('true');
  });

  it('opens on the first option when nothing is chosen', async () => {
    const view = await render();
    await open(view);
    expect(active()).toBe(option(view.host, 'Barbell'));
  });

  it('moves with the arrow keys, Home, End and the page keys, and chooses with Enter', async () => {
    const view = await render();
    await open(view);

    await press(view, 'ArrowDown');
    expect(active()).toBe(option(view.host, 'Bands'));
    await press(view, 'ArrowUp');
    await press(view, 'ArrowUp');
    expect(active()).toBe(option(view.host, 'Barbell'));
    await press(view, 'End');
    expect(active()).toBe(option(view.host, 'Kettlebell'));
    await press(view, 'ArrowDown');
    expect(active()).toBe(option(view.host, 'Kettlebell'));
    await press(view, 'Home');
    expect(active()).toBe(option(view.host, 'Barbell'));
    await press(view, 'PageDown');
    expect(active()).toBe(option(view.host, 'Kettlebell'));
    await press(view, 'PageUp');
    expect(active()).toBe(option(view.host, 'Barbell'));

    await press(view, 'ArrowDown');
    const enter = await press(view, 'Enter');

    expect(enter.defaultPrevented).toBe(true);
    expect(view.component.value()).toBe('Bands');
    expect(view.host.querySelector('[role="listbox"]')).toBeNull();
    expect(active()).toBe(trigger(view.host));
    expect(trigger(view.host).textContent?.trim()).toBe('Bands');
    expect(view.component.touched).toHaveBeenCalled();
  });

  it('chooses with Space and with a click', async () => {
    const view = await render();
    await open(view);
    await press(view, 'End');
    const space = await press(view, ' ');
    expect(space.defaultPrevented).toBe(true);
    expect(view.component.value()).toBe('Kettlebell');

    await open(view);
    option(view.host, 'Dumbbell').click();
    await settle(view.fixture);
    expect(view.component.value()).toBe('Dumbbell');
    expect(view.host.querySelector('[role="listbox"]')).toBeNull();
  });

  it('jumps to the option a typed letter begins, steps on with the same letter, and reads a word', async () => {
    // Only the clock the letters are timed by is faked; the page's own timers run.
    vi.useFakeTimers({ toFake: ['Date'] });
    const pause = () => vi.setSystemTime(Date.now() + TYPEAHEAD_PAUSE_MS + 1);
    const view = await render();
    await open(view);

    await press(view, 'b');
    expect(active()).toBe(option(view.host, 'Bands'));
    await press(view, 'b');
    expect(active()).toBe(option(view.host, 'Bodyweight'));
    await press(view, 'b');
    expect(active()).toBe(option(view.host, 'Barbell'));

    pause();
    await press(view, 'k');
    expect(active()).toBe(option(view.host, 'Kettlebell'));
    pause();
    await press(view, 'b');
    await press(view, 'o');
    expect(active()).toBe(option(view.host, 'Bodyweight'));
    expect(view.component.value()).toBe('');
  });

  it('applies each key from where the last one left focus, before the page draws again', async () => {
    const view = await render();
    await open(view);
    for (const key of ['ArrowDown', 'ArrowDown', 'ArrowDown']) {
      (document.activeElement as HTMLElement).dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
      );
    }
    expect(active()).toBe(option(view.host, 'Cable'));
  });

  it('opens from the closed button on the option a typed letter begins, or on Home and End', async () => {
    const view = await render();
    view.component.value.set('Barbell');
    await settle(view.fixture);
    trigger(view.host).focus();

    await press(view, 'k');
    expect(view.host.querySelector('[role="listbox"]')).not.toBeNull();
    expect(active()).toBe(option(view.host, 'Kettlebell'));
    await press(view, 'Escape');

    await press(view, 'End');
    expect(active()).toBe(option(view.host, 'Kettlebell'));
    await press(view, 'Escape');
    await press(view, 'Home');
    expect(active()).toBe(option(view.host, 'Barbell'));
    await press(view, 'Escape');

    // A letter nothing begins leaves it closed.
    await press(view, 'z');
    expect(view.host.querySelector('[role="listbox"]')).toBeNull();
  });

  it('never chooses a disabled option', async () => {
    const view = await render();
    await open(view);
    option(view.host, 'Cable').click();
    await settle(view.fixture);
    expect(view.component.value()).toBe('');
    expect(view.host.querySelector('[role="listbox"]')).not.toBeNull();
  });

  it('closes on Escape without a change and keeps that Escape from the sheet around it', async () => {
    const view = await render();
    view.component.value.set('Barbell');
    await settle(view.fixture);
    await open(view);
    await press(view, 'ArrowDown');

    const escape = await press(view, 'Escape');

    expect(escape.defaultPrevented).toBe(true);
    expect(view.component.outer).not.toHaveBeenCalledWith(
      expect.objectContaining({ key: 'Escape' }),
    );
    expect(view.component.value()).toBe('Barbell');
    expect(view.host.querySelector('[role="listbox"]')).toBeNull();
    expect(active()).toBe(trigger(view.host));

    // Closed, an Escape is the sheet's again.
    await press(view, 'Escape');
    expect(view.component.outer).toHaveBeenCalledWith(expect.objectContaining({ key: 'Escape' }));
  });

  it('opens from the button with Down on the chosen option, or Up on the last when none is', async () => {
    const view = await render();
    trigger(view.host).focus();
    await press(view, 'ArrowUp');
    expect(active()).toBe(option(view.host, 'Kettlebell'));
    await press(view, 'Escape');

    view.component.value.set('Bands');
    await settle(view.fixture);
    await press(view, 'ArrowDown');
    expect(active()).toBe(option(view.host, 'Bands'));
  });

  it('takes the arrows back into the open list from its button', async () => {
    const view = await render();
    await open(view);
    await press(view, 'ArrowDown');
    trigger(view.host).focus();
    await settle(view.fixture);

    await press(view, 'ArrowDown');

    expect(view.host.querySelector('[role="listbox"]')).not.toBeNull();
    expect(active()).toBe(option(view.host, 'Bands'));
  });

  it('closes on a press outside it, says it was left, and keeps a press on its own parts for itself', async () => {
    const view = await render();
    await open(view);

    // A press on the button or the label keeps focus where it is, so the press's click closes it.
    const onButton = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    trigger(view.host).dispatchEvent(onButton);
    expect(onButton.defaultPrevented).toBe(true);
    const onLabel = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    query(view.host, 'label').dispatchEvent(onLabel);
    expect(onLabel.defaultPrevented).toBe(true);
    // Focus going to nothing (a browser that focuses no button on a press) does not close it.
    option(view.host, 'Barbell').dispatchEvent(
      new FocusEvent('focusout', { bubbles: true, relatedTarget: null }),
    );
    await settle(view.fixture);
    expect(view.host.querySelector('[role="listbox"]')).not.toBeNull();
    expect(view.component.touched).not.toHaveBeenCalled();

    query(view.host, '#before').dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await settle(view.fixture);

    expect(view.host.querySelector('[role="listbox"]')).toBeNull();
    expect(view.component.touched).toHaveBeenCalledTimes(1);

    // Closed, a press on the button is an ordinary one.
    const again = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    trigger(view.host).dispatchEvent(again);
    expect(again.defaultPrevented).toBe(false);
  });

  it('closes when focus leaves it, says it was left, and stays open while focus is inside', async () => {
    const view = await render();
    await open(view);
    await press(view, 'ArrowDown');
    expect(view.component.touched).not.toHaveBeenCalled();

    query<HTMLButtonElement>(view.host, '#after').focus();
    await settle(view.fixture);

    expect(view.host.querySelector('[role="listbox"]')).toBeNull();
    expect(view.component.touched).toHaveBeenCalledTimes(1);
    expect(view.component.value()).toBe('');
  });

  it('shows its help, or its messages with the box marked wrong, and describes the button by them', async () => {
    const { fixture, host, component } = await render();
    component.help.set('What the exercise needs.');
    await settle(fixture);
    const help = query(host, '.tb-field__support');
    expect(trigger(host).getAttribute('aria-describedby')).toBe(help.id);
    expect(trigger(host).hasAttribute('aria-invalid')).toBe(false);

    component.errors.set(['Choose the equipment this exercise uses.']);
    await settle(fixture);
    const error = query(host, '.tb-field__support--error');
    expect(error.textContent).toContain('Choose the equipment this exercise uses.');
    expect(trigger(host).getAttribute('aria-describedby')).toBe(error.id);
    expect(trigger(host).getAttribute('aria-invalid')).toBe('true');
  });

  it('cannot be opened with nothing to choose, yet still takes focus for its message', async () => {
    const { fixture, host, component } = await render();
    component.options.set([]);
    component.errors.set(['Choose the equipment this exercise uses.']);
    await settle(fixture);

    expect(trigger(host).disabled).toBe(false);
    expect(trigger(host).getAttribute('aria-disabled')).toBe('true');
    trigger(host).click();
    await settle(fixture);
    expect(host.querySelector('[role="listbox"]')).toBeNull();

    // A refused form brings focus to its first wrong box: this one.
    host.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    expect(active()).toBe(trigger(host));
  });

  it('serves a reactive form: shows its value, writes the choice back and follows disable', async () => {
    await TestBed.configureTestingModule({ imports: [FormHost] }).compileComponents();
    const fixture = TestBed.createComponent(FormHost);
    await settle(fixture);
    const host = fixture.nativeElement as HTMLElement;
    document.body.appendChild(host);
    const control = fixture.componentInstance.control;

    expect(trigger(host).textContent?.trim()).toBe('Dumbbell');

    trigger(host).click();
    await settle(fixture);
    option(host, 'Barbell').click();
    await settle(fixture);
    expect(control.value).toBe('Barbell');
    expect(control.touched).toBe(true);

    control.setValue('Bodyweight');
    await settle(fixture);
    expect(trigger(host).textContent?.trim()).toBe('Bodyweight');

    control.disable();
    await settle(fixture);
    expect(trigger(host).disabled).toBe(true);
  });
});
