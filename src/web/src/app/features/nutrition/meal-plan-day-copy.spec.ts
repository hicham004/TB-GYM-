import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { field, press, settle, tick } from '../../../testing/dom';
import { type CopyWeek, MealPlanDayCopy } from './meal-plan-day-copy';

/** Fifteen days in three weeks: days 3 and 10 have no meals. */
function weeks(): CopyWeek[] {
  const days = Array.from({ length: 15 }, (_, index) => ({
    key: `d${index + 1}`,
    number: index + 1,
    meals: index === 2 || index === 9 ? [] : ['Breakfast', 'Dinner'],
    kcal: '1,800 kcal',
  }));
  return [0, 1, 2].map((week) => ({
    key: `week-${week + 1}`,
    title: `Week ${week + 1}`,
    days: days.slice(week * 7, week * 7 + 7),
  }));
}

async function render(mode: 'to' | 'from', dayKey: string) {
  await TestBed.configureTestingModule({ imports: [MealPlanDayCopy] }).compileComponents();
  const fixture = TestBed.createComponent(MealPlanDayCopy);
  fixture.componentRef.setInput('mode', mode);
  fixture.componentRef.setInput('dayKey', dayKey);
  fixture.componentRef.setInput('weeks', weeks());
  const copied = vi.fn();
  fixture.componentInstance.copied.subscribe(copied);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, copied };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const picked = (host: HTMLElement) =>
  Array.from(host.querySelectorAll<HTMLInputElement>('input:checked')).map((input) =>
    input.getAttribute('aria-label'),
  );
const submit = (host: HTMLElement) =>
  host.querySelector<HTMLButtonElement>('button[type="submit"]')!;

describe('the meal-plan builder’s copy sheets (critique B5c)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('lists the plan’s days in its weeks, this day ringed and never picked', async () => {
    const { host } = await render('to', 'd2');

    expect(Array.from(host.querySelectorAll('legend')).map(textOf)).toEqual([
      'Week 1',
      'Week 2',
      'Week 3',
    ]);
    expect(host.querySelectorAll('input[type="checkbox"]')).toHaveLength(15);
    const self = field<HTMLInputElement>(host, 'Day 2, this day');
    expect(self.disabled).toBe(true);
    expect(self.closest('.chip')!.classList).toContain('self');
    expect(field<HTMLInputElement>(host, 'Day 3, no meals').closest('.chip')!.classList).toContain(
      'empty',
    );
    expect([textOf(submit(host)), submit(host).disabled]).toEqual(['Copy', true]);
  });

  it('picks every day, the same day of each week, or none, then copies to them', async () => {
    const { fixture, host, copied } = await render('to', 'd2');

    press(host, 'Every day');
    await settle(fixture);
    expect(picked(host)).toHaveLength(14);
    expect(textOf(submit(host))).toBe('Copy to 14 days');
    expect(textOf(host.querySelector('.summary'))).toBe(
      '14 days picked. 12 of them have meals now; copying replaces them.',
    );

    press(host, 'The same day of each week');
    await settle(fixture);
    expect(picked(host)).toEqual(['Day 9, 2 meals']);
    press(host, 'None');
    await settle(fixture);
    expect(picked(host)).toEqual([]);
    expect(textOf(host.querySelector('.summary'))).toBe('');

    tick(host, 'Day 10, no meals');
    tick(host, 'Day 4, 2 meals');
    await settle(fixture);
    expect(textOf(submit(host))).toBe('Copy to days 4 and 10');
    expect(textOf(host.querySelector('.summary'))).toBe(
      '2 days picked. Day 4 has meals now; copying replaces them.',
    );
    tick(host, 'Day 4, 2 meals', false);
    await settle(fixture);
    expect(textOf(host.querySelector('.summary'))).toBe('1 day picked.');
    submit(host).click();
    expect(copied).toHaveBeenCalledWith(['d10']);
  });

  it('replaces this day with one day picked, never one without meals', async () => {
    const { fixture, host, copied } = await render('from', 'd10');

    expect(host.querySelectorAll('input[type="radio"]')).toHaveLength(15);
    expect(field<HTMLInputElement>(host, 'Day 3, no meals').disabled).toBe(true);
    expect(field<HTMLInputElement>(host, 'Day 10, this day').disabled).toBe(true);
    expect(host.querySelector('.shortcuts')).toBeNull();
    expect([textOf(submit(host)), submit(host).disabled]).toEqual(['Replace day 10', true]);

    field<HTMLInputElement>(host, 'Day 8, 2 meals').click();
    await settle(fixture);
    expect(textOf(host.querySelector('.summary'))).toBe('Day 8: Breakfast and Dinner · 1,800 kcal');
    submit(host).click();
    expect(copied).toHaveBeenCalledWith(['d8']);
  });
});
