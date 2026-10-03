import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { runningBlock } from '../../../testing/client-program-fixtures';
import { fill, press, query, settle, tick } from '../../../testing/dom';
import { blockCard, type ProgramContext } from './client-program.models';
import { ProgramNextBlock } from './program-next-block';

const context: ProgramContext = { locale: 'en-US', today: '2026-10-01', firstName: 'Maya' };

function preview(overrides: Record<string, unknown> = {}) {
  return {
    previewHash: 'hash-1',
    transformKey: 'RpeProgression',
    transformVersion: '1',
    resultingWeekCount: 9,
    resultingEndDateExclusive: '2026-11-16',
    isInsideTrainingCoverage: true,
    coverageMessage: null,
    generatedWeeks: [7, 8, 9].map((weekNumber) => ({
      weekNumber,
      sessions: [
        {
          name: 'Lower A',
          exercises: [
            {
              id: `exercise-${weekNumber}`,
              exerciseName: 'Back squat',
              coachNotes: null,
              sets: [
                {
                  repetitionsMinimum: 5,
                  repetitionsMaximum: 5,
                  prescribedLoad: 60 + weekNumber,
                  targetRpe: 7 + (weekNumber - 6) * 0.5,
                },
              ],
            },
          ],
        },
      ],
    })),
    ...overrides,
  };
}

async function render(api: Record<string, unknown> = {}) {
  const calls = {
    getTrainingMesocycle: vi.fn(() => of({ loadUnit: 'Kilogram' })),
    previewTrainingProgression: vi.fn(() => of(preview())),
    applyTrainingProgression: vi.fn(() => of({})),
    ...api,
  };
  const csrf = { refresh: vi.fn().mockResolvedValue(undefined) };
  TestBed.configureTestingModule({
    imports: [ProgramNextBlock],
    providers: [
      { provide: ApiClient, useValue: calls },
      { provide: CsrfService, useValue: csrf },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
    ],
  });
  const fixture = TestBed.createComponent(ProgramNextBlock);
  fixture.componentRef.setInput('block', blockCard(runningBlock(), context));
  fixture.componentRef.setInput('firstName', 'Maya');
  const closed = vi.fn();
  fixture.componentInstance.closed.subscribe(closed);
  document.body.append(fixture.nativeElement);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api: calls, closed };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('Build next block', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    TestBed.resetTestingModule();
  });

  it('starts from the last week, three more weeks and half a step of effort', async () => {
    const { host } = await render();

    const boxes = Array.from(
      host.querySelectorAll<HTMLInputElement>('fieldset input[type="checkbox"]'),
    );
    expect(boxes).toHaveLength(6);
    expect(boxes.map((box) => box.checked)).toEqual([false, false, false, false, false, true]);
    expect(textOf(Array.from(host.querySelectorAll('fieldset label')).at(-1))).toBe(
      'Week 6 · 19–25 Oct',
    );
    expect(query<HTMLInputElement>(host, 'input[type="number"]').value).toBe('3');
    expect(host.querySelectorAll<HTMLInputElement>('input[type="number"]')[1].value).toBe('0.5');
  });

  it('shows the new weeks before anything is added, and sends the version it saw', async () => {
    const { fixture, host, api } = await render();

    press(host, 'Preview the new weeks');
    await settle(fixture);

    expect(api['previewTrainingProgression']).toHaveBeenCalledWith('block-lean', {
      sourceWeekIds: ['block-lean-week6'],
      iterations: 3,
      rpeIncrement: 0.5,
      mesocycleVersion: 4,
    });
    expect(api['applyTrainingProgression']).not.toHaveBeenCalled();
    const section = query<HTMLElement>(host, '.preview');
    expect(textOf(section.querySelector('.preview-line'))).toBe(
      '3 new weeks. The program would end Sun 15 Nov 2026.',
    );
    expect(Array.from(section.querySelectorAll('.preview-title')).map(textOf)).toEqual([
      'Week 7',
      'Week 8',
      'Week 9',
    ]);
    expect(textOf(section.querySelector('li strong'))).toBe('Back squat');
    expect(textOf(section.querySelector('li span'))).toBe('5 reps · 67 kg · RPE 7.5');
  });

  it('adds the weeks with the preview’s hash, then closes', async () => {
    const { fixture, host, api, closed } = await render();
    press(host, 'Preview the new weeks');
    await settle(fixture);

    press(host, 'Add these weeks');
    await settle(fixture);

    expect(api['applyTrainingProgression']).toHaveBeenCalledWith('block-lean', {
      sourceWeekIds: ['block-lean-week6'],
      iterations: 3,
      rpeIncrement: 0.5,
      previewHash: 'hash-1',
      mesocycleVersion: 4,
    });
    expect(closed).toHaveBeenCalledWith(true);
  });

  it('forgets a preview as soon as anything it was built from changes', async () => {
    const { fixture, host } = await render();
    press(host, 'Preview the new weeks');
    await settle(fixture);
    expect(host.querySelector('.preview')).not.toBeNull();

    fill(host, 'Weeks to add', '4');
    await settle(fixture);
    expect(host.querySelector('.preview')).toBeNull();

    press(host, 'Preview the new weeks');
    await settle(fixture);
    tick(host, 'Week 5 · 12–18 Oct');
    await settle(fixture);
    expect(host.querySelector('.preview')).toBeNull();
  });

  it('asks for a week, a sensible number of weeks and a step of half a point, and sends nothing until it has them', async () => {
    const { fixture, host, api } = await render();
    tick(host, 'Week 6 · 19–25 Oct', false);
    fill(host, 'Weeks to add', '0');
    fill(host, 'Effort change per week', '0.3');
    await settle(fixture);

    press(host, 'Preview the new weeks');
    await settle(fixture);

    expect(api['previewTrainingProgression']).not.toHaveBeenCalled();
    expect(textOf(host.querySelector('ul.problem'))).toBe(
      'Choose at least one week to build on.Add between 1 and 12 weeks.The effort change must be between -2 and 2, in steps of 0.5.',
    );
  });

  it('does not let weeks be added that run past the plan, and says so in coach words', async () => {
    const outside = preview({
      isInsideTrainingCoverage: false,
      coverageMessage: 'The entire mesocycle must remain inside its training entitlement period.',
    });
    const { fixture, host, api } = await render({
      previewTrainingProgression: vi.fn(() => of(outside)),
    });

    press(host, 'Preview the new weeks');
    await settle(fixture);

    expect(textOf(host.querySelector('.preview .problem-text'))).toBe(
      'These weeks run past the end of Maya’s plan.',
    );
    const add = Array.from(host.querySelectorAll('button')).find(
      (b) => textOf(b) === 'Add these weeks',
    );
    expect(add?.disabled).toBe(true);
    expect(api['applyTrainingProgression']).not.toHaveBeenCalled();
  });

  it('says another change got there first, without engine words', async () => {
    const conflict = new HttpErrorResponse({
      status: 409,
      error: {
        code: 'concurrency_conflict',
        message: 'Training data was changed by another request.',
      },
    });
    const { fixture, host, closed } = await render({
      applyTrainingProgression: vi.fn(() => throwError(() => conflict)),
    });
    press(host, 'Preview the new weeks');
    await settle(fixture);

    press(host, 'Add these weeks');
    await settle(fixture);

    expect(textOf(host.querySelector('.body > .problem-text'))).toContain('changed somewhere else');
    expect(closed).not.toHaveBeenCalled();
  });
});
