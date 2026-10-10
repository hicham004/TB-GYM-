import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { query, settle } from '../../testing/dom';
import { DateField } from './date-field';

@Component({
  imports: [DateField],
  template: `
    <div [dir]="direction()">
      <app-date-field
        label="Received on"
        [help]="help()"
        [errors]="errors()"
        [(value)]="value"
        [min]="min()"
        [max]="max()"
        [today]="today()"
        [firstDay]="firstDay()"
        [clearable]="clearable()"
        (touched)="touched()"
      />
    </div>
  `,
})
class Host {
  readonly value = signal('');
  readonly min = signal<string | null>(null);
  readonly max = signal<string | null>(null);
  readonly today = signal<string | null>('2026-10-09');
  readonly firstDay = signal<number | null>(1);
  readonly clearable = signal(false);
  readonly help = signal<string | null>(null);
  readonly errors = signal<string[] | null>(null);
  readonly direction = signal('ltr');
  readonly outer = vi.fn<(event: KeyboardEvent) => void>();
  readonly touched = vi.fn();
}

async function render() {
  await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  await settle(fixture);
  const host = fixture.nativeElement as HTMLElement;
  // What a sheet around the field would see: any key the field lets through.
  host.addEventListener('keydown', (event) => fixture.componentInstance.outer(event));
  return { fixture, host, component: fixture.componentInstance };
}

type Rendered = Awaited<ReturnType<typeof render>>;

const trigger = (host: HTMLElement) => query<HTMLButtonElement>(host, 'button.trigger');
const day = (host: HTMLElement, iso: string) =>
  query<HTMLButtonElement>(host, `button.day[data-date="${iso}"]`);
const monthTitle = (host: HTMLElement) => query(host, '.month').textContent?.trim();
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

describe('DateField', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('shows what to do, then the chosen day in words, under its label', async () => {
    const view = await render();
    const { fixture, host, component } = view;

    expect(trigger(host).textContent).toContain('Choose a day');
    expect(trigger(host).getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('.panel')).toBeNull();

    component.value.set('2026-10-09');
    await settle(fixture);

    expect(trigger(host).textContent).toContain('Fri, Oct 9, 2026');
    // The button is named by the label and the day together, so a screen reader hears both.
    const names = trigger(host)
      .getAttribute('aria-labelledby')!
      .split(' ')
      .map((id) => host.querySelector(`#${id}`)?.textContent?.trim());
    expect(names).toEqual(['Received on', 'Fri, Oct 9, 2026']);
    expect(host.querySelector('label')?.getAttribute('for')).toBe(trigger(host).id);
  });

  it('opens on the chosen month with the chosen day in the tab order and under the keyboard', async () => {
    const view = await render();
    view.component.value.set('2026-11-15');
    await settle(view.fixture);
    await open(view);

    expect(trigger(view.host).getAttribute('aria-expanded')).toBe('true');
    expect(monthTitle(view.host)).toBe('November 2026');
    expect(active()).toBe(day(view.host, '2026-11-15'));
    expect(day(view.host, '2026-11-15').getAttribute('tabindex')).toBe('0');
    expect(day(view.host, '2026-11-14').getAttribute('tabindex')).toBe('-1');
    expect(day(view.host, '2026-11-15').closest('td')?.getAttribute('aria-selected')).toBe('true');
    expect(day(view.host, '2026-11-15').getAttribute('aria-label')).toBe(
      'Sunday, November 15, 2026',
    );
  });

  it('opens on today when nothing is chosen, and marks it', async () => {
    const view = await render();
    await open(view);

    expect(monthTitle(view.host)).toBe('October 2026');
    expect(active()).toBe(day(view.host, '2026-10-09'));
    expect(day(view.host, '2026-10-09').getAttribute('aria-current')).toBe('date');
    expect(day(view.host, '2026-10-10').getAttribute('aria-current')).toBeNull();
  });

  it('starts the week on the day it is told to and names each column in full', async () => {
    const view = await render();
    await open(view);
    const heads = Array.from(view.host.querySelectorAll('th'));
    expect(heads.map((head) => head.textContent?.trim())).toEqual([
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat',
      'Sun',
    ]);
    expect(heads[0].getAttribute('abbr')).toBe('Monday');

    view.component.firstDay.set(7);
    await settle(view.fixture);
    expect(view.host.querySelector('th')?.textContent?.trim()).toBe('Sun');
  });

  it('chooses a day, closes the calendar and puts focus back on the button', async () => {
    const view = await render();
    await open(view);

    day(view.host, '2026-10-14').click();
    await settle(view.fixture);

    expect(view.component.value()).toBe('2026-10-14');
    expect(view.host.querySelector('.panel')).toBeNull();
    expect(active()).toBe(trigger(view.host));
    expect(trigger(view.host).textContent).toContain('Wed, Oct 14, 2026');
    expect(view.component.touched).toHaveBeenCalled();
  });

  it('greys out days outside the range and ignores them', async () => {
    const view = await render();
    view.component.min.set('2026-10-05');
    view.component.max.set('2026-10-20');
    await settle(view.fixture);
    await open(view);

    expect(day(view.host, '2026-10-04').getAttribute('aria-disabled')).toBe('true');
    expect(day(view.host, '2026-10-21').getAttribute('aria-disabled')).toBe('true');
    expect(day(view.host, '2026-10-05').getAttribute('aria-disabled')).toBeNull();
    expect(day(view.host, '2026-10-20').getAttribute('aria-disabled')).toBeNull();

    day(view.host, '2026-10-04').click();
    await settle(view.fixture);
    expect(view.component.value()).toBe('');
    expect(view.host.querySelector('.panel')).not.toBeNull();
  });

  it('opens inside the range when today is outside it', async () => {
    const view = await render();
    view.component.max.set('2026-10-03');
    await settle(view.fixture);
    await open(view);

    expect(active()).toBe(day(view.host, '2026-10-03'));
    expect(
      Array.from(view.host.querySelectorAll('.foot .link')).find(
        (link) => link.textContent?.trim() === 'Today',
      ),
    ).toHaveProperty('disabled', true);
  });

  it('moves with the arrow keys, Home and End, and stops at the range', async () => {
    const view = await render();
    view.component.max.set('2026-10-20');
    await settle(view.fixture);
    await open(view);

    await press(view, 'ArrowRight');
    expect(active()).toBe(day(view.host, '2026-10-10'));
    await press(view, 'ArrowDown');
    expect(active()).toBe(day(view.host, '2026-10-17'));
    await press(view, 'ArrowLeft');
    expect(active()).toBe(day(view.host, '2026-10-16'));
    await press(view, 'ArrowUp');
    expect(active()).toBe(day(view.host, '2026-10-09'));
    await press(view, 'Home');
    expect(active()).toBe(day(view.host, '2026-10-05'));
    await press(view, 'End');
    expect(active()).toBe(day(view.host, '2026-10-11'));
    await press(view, 'ArrowDown');
    await press(view, 'ArrowDown');
    expect(active()).toBe(day(view.host, '2026-10-20'));
    expect(day(view.host, '2026-10-20').getAttribute('tabindex')).toBe('0');
  });

  it('turns the page by a month, or with Shift by a year, and keeps focus on a day', async () => {
    const view = await render();
    await open(view);

    await press(view, 'PageDown');
    expect(monthTitle(view.host)).toBe('November 2026');
    expect(active()).toBe(day(view.host, '2026-11-09'));

    await press(view, 'PageUp', { shiftKey: true });
    expect(monthTitle(view.host)).toBe('November 2025');
    expect(active()).toBe(day(view.host, '2025-11-09'));

    await press(view, 'ArrowLeft');
    await press(view, 'ArrowUp');
    expect(active()).toBe(day(view.host, '2025-11-01'));
    await press(view, 'ArrowLeft');
    expect(monthTitle(view.host)).toBe('October 2025');
    expect(active()).toBe(day(view.host, '2025-10-31'));
  });

  it('reverses the arrows in a right-to-left page', async () => {
    const view = await render();
    view.component.direction.set('rtl');
    await settle(view.fixture);
    await open(view);

    await press(view, 'ArrowLeft');
    expect(active()).toBe(day(view.host, '2026-10-10'));
    await press(view, 'ArrowRight');
    await press(view, 'ArrowRight');
    expect(active()).toBe(day(view.host, '2026-10-08'));
  });

  it('shows the month before or after with its buttons', async () => {
    const view = await render();
    await open(view);

    query<HTMLButtonElement>(view.host, 'button[aria-label="Next month"]').click();
    await settle(view.fixture);
    expect(monthTitle(view.host)).toBe('November 2026');
    expect(day(view.host, '2026-11-09').getAttribute('tabindex')).toBe('0');

    query<HTMLButtonElement>(view.host, 'button[aria-label="Previous month"]').click();
    query<HTMLButtonElement>(view.host, 'button[aria-label="Previous month"]').click();
    await settle(view.fixture);
    expect(monthTitle(view.host)).toBe('September 2026');
  });

  it('closes on Escape without letting the sheet around it close too', async () => {
    const view = await render();
    await open(view);

    const event = await press(view, 'Escape');

    expect(view.host.querySelector('.panel')).toBeNull();
    expect(active()).toBe(trigger(view.host));
    expect(event.defaultPrevented).toBe(true);
    expect(view.component.outer).not.toHaveBeenCalled();
    expect(view.component.value()).toBe('');
  });

  it('offers Today, and Clear only when the field may be left empty', async () => {
    const view = await render();
    await open(view);
    expect(view.host.textContent).not.toContain('Clear');

    const today = Array.from(view.host.querySelectorAll<HTMLButtonElement>('.foot .link')).find(
      (link) => link.textContent?.trim() === 'Today',
    )!;
    today.click();
    await settle(view.fixture);
    expect(view.component.value()).toBe('2026-10-09');

    view.component.clearable.set(true);
    await settle(view.fixture);
    await open(view);
    const clear = Array.from(view.host.querySelectorAll<HTMLButtonElement>('.foot .link')).find(
      (link) => link.textContent?.trim() === 'Clear',
    )!;
    clear.click();
    await settle(view.fixture);
    expect(view.component.value()).toBe('');
    expect(trigger(view.host).textContent).toContain('Choose a day');
  });

  it('says what is wrong in words and points the button at it', async () => {
    const view = await render();
    view.component.help.set('The day the money arrived.');
    await settle(view.fixture);
    expect(view.host.textContent).toContain('The day the money arrived.');
    expect(trigger(view.host).getAttribute('aria-invalid')).toBeNull();

    view.component.errors.set(['Choose a day from 1 Oct up to today.']);
    await settle(view.fixture);

    expect(view.host.textContent).toContain('Choose a day from 1 Oct up to today.');
    expect(view.host.textContent).not.toContain('The day the money arrived.');
    expect(trigger(view.host).getAttribute('aria-invalid')).toBe('true');
    const described = view.host.querySelector(
      `#${trigger(view.host).getAttribute('aria-describedby')}`,
    );
    expect(described?.textContent).toContain('Choose a day from 1 Oct up to today.');
  });

  it('closes when focus moves on to another control', async () => {
    const view = await render();
    await open(view);

    const elsewhere = document.createElement('button');
    document.body.append(elsewhere);
    day(view.host, '2026-10-09').dispatchEvent(
      new FocusEvent('focusout', { bubbles: true, relatedTarget: elsewhere }),
    );
    await settle(view.fixture);
    elsewhere.remove();

    expect(view.host.querySelector('.panel')).toBeNull();
    expect(view.component.touched).toHaveBeenCalled();
  });

  it('does not open when it is disabled', async () => {
    await TestBed.configureTestingModule({ imports: [DateField] }).compileComponents();
    const fixture = TestBed.createComponent(DateField);
    fixture.componentRef.setInput('label', 'Last day');
    fixture.componentRef.setInput('disabled', true);
    await settle(fixture);

    const button = query<HTMLButtonElement>(fixture.nativeElement, 'button.trigger');
    expect(button.disabled).toBe(true);
  });
});
