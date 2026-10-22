import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { query, settle } from '../../testing/dom';
import { SegmentedControl, type SegmentOption } from './segmented-control';

const PERIODS: SegmentOption[] = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year', disabled: true },
];

const UNITS: SegmentOption[] = [
  { value: 'kg', label: 'kg' },
  { value: 'lb', label: 'lb' },
];

@Component({
  imports: [SegmentedControl],
  template: `
    <app-segmented-control id="period" label="Period" [options]="periods" [(selected)]="period" />
    <app-segmented-control id="unit" label="Unit" hideLabel [options]="units" [(selected)]="unit" />
  `,
})
class Host {
  readonly periods = PERIODS;
  readonly units = UNITS;
  readonly period = signal('week');
  readonly unit = signal('');
}

async function render() {
  await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  await settle(fixture);
  return {
    fixture,
    element: fixture.nativeElement as HTMLElement,
    host: fixture.componentInstance,
  };
}

const control = (element: HTMLElement, id: string) => query<HTMLElement>(element, `#${id}`);
const radios = (element: HTMLElement, id: string) =>
  Array.from(control(element, id).querySelectorAll<HTMLInputElement>('input[type="radio"]'));
const radio = (element: HTMLElement, id: string, label: string) => {
  const found = Array.from(control(element, id).querySelectorAll('label')).find(
    (candidate) => candidate.querySelector('span')?.textContent?.trim() === label,
  );
  if (!found) throw new Error(`No option "${label}" in #${id}.`);
  return query<HTMLInputElement>(found, 'input[type="radio"]');
};
const checked = (element: HTMLElement, id: string) =>
  radios(element, id)
    .filter((input) => input.checked)
    .map((input) => input.value);

describe('SegmentedControl', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('names the choice in a legend, kept for screen readers alone where the options name themselves', async () => {
    const { element } = await render();

    const period = query<HTMLElement>(control(element, 'period'), 'fieldset > legend');
    expect(period.textContent?.trim()).toBe('Period');
    expect(period.classList).not.toContain('tb-visually-hidden');
    const unit = query<HTMLElement>(control(element, 'unit'), 'fieldset > legend');
    expect(unit.textContent?.trim()).toBe('Unit');
    expect(unit.classList).toContain('tb-visually-hidden');
  });

  it('offers one radio per option, captioned by it, in a group no other control on the page shares', async () => {
    const { element } = await render();

    const periods = radios(element, 'period');
    expect(periods.map((input) => input.value)).toEqual(['week', 'month', 'year']);
    expect(
      periods.map((input) => input.closest('label')?.querySelector('span')?.textContent?.trim()),
    ).toEqual(['Week', 'Month', 'Year']);
    const group = periods[0].name;
    expect(group).not.toBe('');
    expect(periods.every((input) => input.name === group)).toBe(true);

    const units = radios(element, 'unit');
    expect(units.every((input) => input.name === units[0].name)).toBe(true);
    expect(units[0].name).not.toBe(group);
  });

  it('shows the option the page chose, nothing when none is, and follows the page’s change', async () => {
    const { fixture, element, host } = await render();
    expect(checked(element, 'period')).toEqual(['week']);
    expect(checked(element, 'unit')).toEqual([]);

    host.period.set('month');
    host.unit.set('lb');
    await settle(fixture);

    expect(checked(element, 'period')).toEqual(['month']);
    expect(checked(element, 'unit')).toEqual(['lb']);
  });

  it('tells the page what the person chose', async () => {
    const { fixture, element, host } = await render();

    radio(element, 'period', 'Month').click();
    await settle(fixture);

    expect(host.period()).toBe('month');
    expect(checked(element, 'period')).toEqual(['month']);
    // The other control keeps its own answer.
    expect(host.unit()).toBe('');
  });

  it('never chooses an option that is not available', async () => {
    const { fixture, element, host } = await render();
    const year = radio(element, 'period', 'Year');

    expect(year.disabled).toBe(true);
    year.click();
    await settle(fixture);

    expect(host.period()).toBe('week');
    expect(checked(element, 'period')).toEqual(['week']);
  });
});
