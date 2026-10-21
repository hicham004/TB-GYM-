import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError, type Observable } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  PreviewWeekProgressionRequest,
  WeekProgressionPreviewView,
} from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { fill, formSummary, settle } from '../../../testing/dom';
import { ProgramBuilderApi } from './program-builder-api';
import { ProgramWeekProgression } from './program-week-progression';
import {
  type DraftSet,
  emptyExercise,
  emptyProgram,
  emptySet,
  type ProgramDraft,
  toWeekRequest,
} from './training-builder.models';

const set = (overrides: Partial<DraftSet>): DraftSet => ({ ...emptySet(), ...overrides });

function program(): ProgramDraft {
  const draft = emptyProgram();
  const squat = emptyExercise('squat', true, 'Back squat');
  squat.sets = [
    set({ loadStrategy: 'PercentageWorkingMax', loadValue: 70, exertionTarget: 6 }),
    set({ loadStrategy: 'RpeChart', exertionTarget: 7 }),
  ];
  const bench = emptyExercise('bench', false, 'Bench press');
  bench.sets = [set({ loadStrategy: 'Direct', loadValue: 100, exertionTarget: 7 })];
  draft.weeks[0].sessions[0].name = 'Lower A';
  draft.weeks[0].sessions[0].exercises = [squat, bench];
  return draft;
}

/** What the server would send back: each copy a half RPE point further on than the one before. */
function previewFor(
  draft: ProgramDraft,
  request: PreviewWeekProgressionRequest,
): WeekProgressionPreviewView {
  const source = toWeekRequest(draft.weeks[0]);
  return {
    transformKey: 'WeekStep',
    transformVersion: '1.0',
    weeks: Array.from({ length: Number(request.copies) }, (_, index) => ({
      ...source,
      sessions: source.sessions.map((session) => ({
        ...session,
        exercises: session.exercises.map((exercise) => ({
          ...exercise,
          sets: exercise.sets.map((requested) => ({
            ...requested,
            targetRpe: Number(requested.targetRpe) + 0.5 * (index + 1),
          })),
        })),
      })),
    })),
  };
}

type Answer = (
  request: PreviewWeekProgressionRequest,
  draft: ProgramDraft,
) => Observable<WeekProgressionPreviewView>;

async function render(answer: Answer = (request, draft) => of(previewFor(draft, request))) {
  const draft = program();
  const api = {
    previewWeekProgression: vi.fn((request: PreviewWeekProgressionRequest) =>
      answer(request, draft),
    ),
  };
  const csrf = { refresh: vi.fn().mockResolvedValue(undefined) };
  TestBed.configureTestingModule({
    providers: [
      { provide: ProgramBuilderApi, useValue: api },
      { provide: CsrfService, useValue: csrf },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
    ],
  });
  const fixture = TestBed.createComponent(ProgramWeekProgression);
  fixture.componentRef.setInput('draft', draft);
  fixture.componentRef.setInput('weekKey', draft.weeks[0].key);
  const added = vi.fn();
  const cancelled = vi.fn();
  fixture.componentInstance.added.subscribe(added);
  fixture.componentInstance.cancelled.subscribe(cancelled);
  await settle(fixture);
  const host = fixture.nativeElement as HTMLElement;
  const press = async (label: string) => {
    const target = Array.from(host.querySelectorAll('button')).find(
      (candidate) => (candidate.textContent ?? '').trim() === label,
    );
    if (!target) throw new Error(`No button says "${label}".`);
    target.click();
    await settle(fixture);
  };
  const text = (selector: string) =>
    Array.from(host.querySelectorAll(selector)).map((node) =>
      (node.textContent ?? '').replace(/\s+/g, ' ').trim(),
    );
  const addButton = () => host.querySelector<HTMLButtonElement>('.footer button:last-child');
  return { fixture, host, api, csrf, added, cancelled, press, text, addButton };
}

describe('Duplicate with progression', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('says what each step would move in this week before the coach sets one', async () => {
    const { host, text, addButton } = await render();

    expect(text('.tb-field__label')).toEqual([
      'Copies',
      'RPE a week',
      'Reps a week',
      '% of training max a week',
      'Weight a week (kg)',
    ]);
    expect(text('.tb-field__support')).toEqual([
      'Added right after week 1. Up to 12 fit.',
      'Sets moved: 3. Warm-ups stay as they are.',
      'Sets moved: 3.',
      'Sets moved: 1.',
      'Sets moved: 1, fixed or typed weights.',
    ]);
    expect(host.querySelector('.result')).toBeNull();
    expect(addButton()?.disabled).toBe(true);
  });

  it('shows the weeks the server calculated, marks what changed, and adds only what was read', async () => {
    const { fixture, host, api, csrf, added, press, text, addButton } = await render();

    fill(host, 'Copies', '2');
    fill(host, 'RPE a week', '1');
    fill(host, 'Reps a week', '1');
    await settle(fixture);
    await press('Show the new weeks');

    expect(csrf.refresh).toHaveBeenCalledOnce();
    expect(api.previewWeekProgression).toHaveBeenCalledOnce();
    const request = api.previewWeekProgression.mock.calls[0][0];
    expect(request.copies).toBe(2);
    expect(request.steps).toEqual({
      rpeStep: 1,
      repetitionsStep: 1,
      percentageStep: 0,
      loadStep: 0,
    });
    expect(request.weeksInProgram).toBe(1);
    expect(request.sourceWeek.sessions[0].exercises).toHaveLength(2);

    expect(text('.result h3')).toEqual(['2 new weeks after week 1']);
    expect(text('.week h4')).toEqual(['Week 2', 'Week 3']);
    const firstWeek = host.querySelector('.week');
    expect(
      Array.from(firstWeek?.querySelectorAll('.exercise-name') ?? []).map(
        (node) => node.textContent,
      ),
    ).toEqual(['Back squat', 'Bench press']);
    expect(
      Array.from(firstWeek?.querySelectorAll('.set') ?? []).map((node) => node.textContent?.trim()),
    ).toEqual([
      '5 · 70% of training max · RPE 6.5',
      '5 · Load from RTS chart & effort · RPE 7.5',
      '5 · 100 kg · RPE 7.5',
    ]);
    // Every line differs from the source week, so every line is marked.
    expect(host.querySelectorAll('.set.changed')).toHaveLength(6);
    expect(addButton()?.textContent?.trim()).toBe('Add 2 weeks');
    expect(addButton()?.disabled).toBe(false);

    addButton()?.click();
    expect(added).toHaveBeenCalledOnce();
    expect((added.mock.calls[0][0] as WeekProgressionPreviewView).weeks).toHaveLength(2);
  });

  it('will not add weeks the settings no longer describe, until they are shown again', async () => {
    const { fixture, host, api, press, text, addButton } = await render();
    await press('Show the new weeks');
    expect(addButton()?.disabled).toBe(false);

    fill(host, 'Reps a week', '2');
    await settle(fixture);

    expect(text('.stale')).toEqual([
      'You changed the settings after the weeks below were calculated. Show the new weeks again to add them.',
    ]);
    expect(host.querySelector('.result')).toBeNull();
    expect(addButton()?.disabled).toBe(true);

    await press('Show the new weeks');
    expect(api.previewWeekProgression).toHaveBeenCalledTimes(2);
    expect(host.querySelector('.stale')).toBeNull();
    expect(addButton()?.disabled).toBe(false);
  });

  it('refuses obvious mistakes before asking the server and says which field', async () => {
    const { fixture, host, api, press, text } = await render();

    fill(host, 'Copies', '0');
    fill(host, 'Reps a week', '2.5');
    fill(host, '% of training max a week', '51');
    await settle(fixture);
    await press('Show the new weeks');

    expect(api.previewWeekProgression).not.toHaveBeenCalled();
    expect(text('.tb-field__support--error')).toEqual([
      'Choose 1 to 12 copies.',
      'Use a whole number from -20 to 20.',
      'Use -50 to 50 points, with at most two decimals.',
    ]);
    expect(text('[role="alert"]')).toEqual(['Choose 1 to 12 copies.']);
    expect(document.activeElement).toBe(formSummary(host));
  });

  it('shows what the server refused, in its words, and adds nothing', async () => {
    const refusal =
      'Copy 3, Lower A, Back squat, set 2: RPE would be 10.5, and RPE runs from 5 to 10. Use a smaller step or fewer copies.';
    const { host, press, text, addButton } = await render(() =>
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: { title: 'Validation', errors: { progression: [refusal] } },
          }),
      ),
    );

    await press('Show the new weeks');

    expect(text('[role="alert"]')).toEqual([refusal]);
    expect(document.activeElement).toBe(formSummary(host));
    expect(host.querySelector('.result')).toBeNull();
    expect(addButton()?.disabled).toBe(true);
  });

  it('closes without adding when the coach cancels', async () => {
    const { added, cancelled, press } = await render();

    await press('Cancel');

    expect(cancelled).toHaveBeenCalledOnce();
    expect(added).not.toHaveBeenCalled();
  });
});
