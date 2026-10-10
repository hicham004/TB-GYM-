import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { query, settle, type } from '../../testing/dom';
import { DateInput, type DateInputStatus } from './date-input';

@Component({
  imports: [DateInput],
  template: `
    <app-date-input
      label="Date of birth"
      help="For example, 27 3 1990"
      autocompleteName="bday"
      [errors]="errors()"
      [disabled]="disabled()"
      [(value)]="value"
      (status)="statuses.push($event)"
      (touched)="touched()"
    />
  `,
})
class Host {
  readonly value = signal('');
  readonly errors = signal<string[] | null>(null);
  readonly disabled = signal(false);
  readonly statuses: DateInputStatus[] = [];
  readonly touched = vi.fn();
}

async function render() {
  await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  await settle(fixture);
  const host = fixture.nativeElement as HTMLElement;
  return { fixture, host, component: fixture.componentInstance };
}

const box = (host: HTMLElement, part: 'day' | 'month' | 'year') =>
  query<HTMLInputElement>(host, `input.${part}`);

async function typeDate(
  view: Awaited<ReturnType<typeof render>>,
  day: string,
  month: string,
  year: string,
) {
  type(view.host, 'input.day', day);
  type(view.host, 'input.month', month);
  type(view.host, 'input.year', year);
  await settle(view.fixture);
}

describe('DateInput', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('is one group named by its label, with a box each for the day, month and year', async () => {
    const { host } = await render();

    expect(query(host, 'legend').textContent).toBe('Date of birth');
    expect(Array.from(host.querySelectorAll('.part span')).map((part) => part.textContent)).toEqual(
      ['Day', 'Month', 'Year'],
    );
    expect(box(host, 'day').getAttribute('inputmode')).toBe('numeric');
    expect(box(host, 'day').getAttribute('autocomplete')).toBe('bday-day');
    expect(box(host, 'month').getAttribute('autocomplete')).toBe('bday-month');
    expect(box(host, 'year').getAttribute('autocomplete')).toBe('bday-year');
    expect(host.textContent).toContain('For example, 27 3 1990');
  });

  it('makes a real day of three boxes, with the month and day padded', async () => {
    const view = await render();

    await typeDate(view, '7', '3', '1990');

    expect(view.component.value()).toBe('1990-03-07');
    expect(view.component.statuses.at(-1)).toBe('valid');
  });

  it('keeps only digits and no more than a box can hold', async () => {
    const view = await render();

    type(view.host, 'input.day', 'a2b7c');
    type(view.host, 'input.year', '19x90y12');
    await settle(view.fixture);

    expect(box(view.host, 'day').value).toBe('27');
    expect(box(view.host, 'year').value).toBe('1990');
  });

  it('says a date is incomplete while a part is missing or the year is short, and gives no value', async () => {
    const view = await render();

    type(view.host, 'input.day', '27');
    await settle(view.fixture);
    expect(view.component.statuses.at(-1)).toBe('incomplete');
    expect(view.component.value()).toBe('');

    await typeDate(view, '27', '3', '90');
    expect(view.component.statuses.at(-1)).toBe('incomplete');
    expect(view.component.value()).toBe('');
  });

  it('says a day that does not exist is invalid, and gives no value', async () => {
    const view = await render();

    await typeDate(view, '31', '2', '1990');

    expect(view.component.statuses.at(-1)).toBe('invalid');
    expect(view.component.value()).toBe('');
    await typeDate(view, '29', '2', '1992');
    expect(view.component.value()).toBe('1992-02-29');
  });

  it('is empty again when every box is cleared', async () => {
    const view = await render();
    await typeDate(view, '27', '3', '1990');

    await typeDate(view, '', '', '');

    expect(view.component.statuses.at(-1)).toBe('empty');
    expect(view.component.value()).toBe('');
  });

  it('fills the boxes from a value set outside, and typing a part does not erase the others', async () => {
    const view = await render();

    view.component.value.set('1988-03-27');
    await settle(view.fixture);
    expect([
      box(view.host, 'day').value,
      box(view.host, 'month').value,
      box(view.host, 'year').value,
    ]).toEqual(['27', '3', '1988']);

    type(view.host, 'input.day', '');
    await settle(view.fixture);
    expect(view.component.statuses.at(-1)).toBe('incomplete');
    expect(box(view.host, 'month').value).toBe('3');
    expect(box(view.host, 'year').value).toBe('1988');
  });

  it('names what is wrong on every box and points them at the message', async () => {
    const view = await render();
    view.component.errors.set(['That day does not exist.']);
    await settle(view.fixture);

    for (const part of ['day', 'month', 'year'] as const) {
      expect(box(view.host, part).getAttribute('aria-invalid')).toBe('true');
      const described = box(view.host, part)
        .getAttribute('aria-describedby')!
        .split(' ')
        .map((id) => view.host.querySelector(`#${id}`)?.textContent?.trim());
      expect(described).toEqual(['For example, 27 3 1990', 'That day does not exist.']);
    }
  });

  it('tells the page when a box is left, and can be disabled', async () => {
    const view = await render();

    box(view.host, 'month').dispatchEvent(new Event('blur'));
    expect(view.component.touched).toHaveBeenCalledTimes(1);

    view.component.disabled.set(true);
    await settle(view.fixture);
    expect(box(view.host, 'year').disabled).toBe(true);
  });
});
