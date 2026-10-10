import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exercise, library } from '../../../testing/client-strength-fixtures';
import { fill, settle } from '../../../testing/dom';
import { ApiClient } from '../../core/api/api-client';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { ExercisePicker, type ExerciseChoice } from './exercise-picker';

const SUGGESTED: ExerciseChoice[] = [
  { id: 'ex-bench', name: 'Bench Press' },
  { id: 'ex-squat', name: 'Back Squat' },
];

async function render(
  searchExercises: ReturnType<typeof vi.fn> = vi.fn(() => of(library([]))),
  inputs: Record<string, unknown> = {},
) {
  await TestBed.configureTestingModule({
    imports: [ExercisePicker],
    providers: [
      { provide: ApiClient, useValue: { searchExercises } },
      { provide: TenantStore, useValue: { selectedTenantId: signal('t-1') } },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(ExercisePicker);
  fixture.componentRef.setInput('label', 'Exercise');
  for (const [name, value] of Object.entries({ suggested: SUGGESTED, ...inputs })) {
    fixture.componentRef.setInput(name, value);
  }
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, searchExercises };
}

const names = (host: ParentNode, selector: string) =>
  Array.from(host.querySelectorAll(`${selector} .choice-text`)).map((item) =>
    (item.textContent ?? '').trim(),
  );

const afterSearch = () => new Promise((resolve) => setTimeout(resolve, 380));

describe('the exercise picker', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('offers the lifts that have something on record before any search', async () => {
    const { host } = await render();

    expect(host.querySelector('legend')!.textContent).toBe('Exercise');
    expect(names(host, 'fieldset > .choices:first-of-type')).toEqual(['Bench Press', 'Back Squat']);
    expect(host.querySelectorAll('input[type="radio"]:checked').length).toBe(0);
  });

  it('chooses a lift when a coach picks it, and shows it chosen', async () => {
    const { fixture, host } = await render();

    host.querySelector<HTMLInputElement>('input[type="radio"][value="ex-squat"]')!.click();
    await settle(fixture);

    expect(fixture.componentInstance.chosen()).toEqual({ id: 'ex-squat', name: 'Back Squat' });
    expect(host.querySelector('.choice.chosen .choice-text')!.textContent!.trim()).toBe(
      'Back Squat',
    );
  });

  it('searches the library after two letters, and only the first matches are listed', async () => {
    const many = library(
      Array.from({ length: 12 }, (_, index) => [`ex-${index}`, `Row ${index}`] as const),
    );
    const searchExercises = vi.fn(() => of(many));
    const { fixture, host } = await render(searchExercises);

    fill(host, 'Another exercise', 'r');
    await afterSearch();
    expect(searchExercises).not.toHaveBeenCalled();
    fill(host, 'Another exercise', 'row');
    await afterSearch();
    await settle(fixture);

    expect(searchExercises).toHaveBeenCalledTimes(1);
    expect(searchExercises).toHaveBeenCalledWith({ query: 'row' });
    expect(names(host, '[data-matches]')).toHaveLength(8);
    expect(names(host, '[data-matches]')[0]).toBe('Row 0');
  });

  it('leaves out archived exercises and the lifts already offered', async () => {
    const result = {
      total: 3,
      items: [
        exercise('ex-squat', 'Back Squat'),
        exercise('ex-old', 'Old Row', { isArchived: true }),
        exercise('ex-row', 'Barbell Row'),
      ],
    };
    const { fixture, host } = await render(vi.fn(() => of(result)));

    fill(host, 'Another exercise', 'ba');
    await afterSearch();
    await settle(fixture);

    expect(names(host, '[data-matches]')).toEqual(['Barbell Row']);
  });

  it('keeps a pick from the search on the list while the coach searches on', async () => {
    const first = library([['ex-row', 'Barbell Row']]);
    const searchExercises = vi
      .fn()
      .mockReturnValueOnce(of(first))
      .mockReturnValue(of(library([['ex-pull', 'Pull-up']])));
    const { fixture, host } = await render(searchExercises);

    fill(host, 'Another exercise', 'row');
    await afterSearch();
    await settle(fixture);
    host.querySelector<HTMLInputElement>('input[value="ex-row"]')!.click();
    await settle(fixture);
    fill(host, 'Another exercise', 'pull');
    await afterSearch();
    await settle(fixture);

    expect(names(host, '[data-matches]')).toEqual(['Barbell Row', 'Pull-up']);
    expect(fixture.componentInstance.chosen()?.id).toBe('ex-row');
  });

  it('says when nothing matches, and when the library could not be searched', async () => {
    const searchExercises = vi
      .fn()
      .mockReturnValueOnce(of(library([])))
      .mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    const { fixture, host } = await render(searchExercises);

    fill(host, 'Another exercise', 'zzz');
    await afterSearch();
    await settle(fixture);
    expect(host.textContent).toContain('Nothing in your library is called that.');

    fill(host, 'Another exercise', 'zzzz');
    await afterSearch();
    await settle(fixture);
    expect(host.textContent).toContain('The library could not be searched. Try again.');
  });

  it('shows what is wrong when the page asks it to', async () => {
    const { host } = await render(undefined, { errors: ['Choose the exercise.'] });

    expect(host.querySelector('.problem')!.textContent).toBe('Choose the exercise.');
    expect(host.querySelector('input[type="radio"]')!.getAttribute('aria-invalid')).toBe('true');
  });
});
