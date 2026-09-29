import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { field, settle } from '../../../testing/dom';
import { ClientTraining } from './client-training';

const emptyPage = { items: [], total: 0, skip: 0, take: 25 };

const block = {
  id: 'block-1',
  name: 'Strength block',
  startDate: '2026-09-07',
  // Half-open: the block's last training day is Sunday 4 October.
  endDateExclusive: '2026-10-05',
  status: 'Active',
  revealAllWeeks: false,
  loadUnit: 'Kilogram',
  timeZoneId: 'Asia/Beirut',
  version: 1,
  lifecycle: [
    {
      id: 'event-1',
      eventType: 'Assigned',
      occurredAtUtc: '2026-09-05T10:10:38.231992+00:00',
      reason: 'First block',
    },
  ],
  weeks: [],
};

async function render(): Promise<HTMLElement> {
  await TestBed.configureTestingModule({
    imports: [ClientTraining],
    providers: [
      {
        provide: ApiClient,
        useValue: {
          getWorkspace: vi.fn(() =>
            of({ timeZoneId: 'Asia/Beirut', weekStartsOn: 'Monday', currentDate: '2026-09-21' }),
          ),
          getClientCommercialOverview: vi.fn(() =>
            of({
              enrollments: [
                {
                  id: 'enrollment-1',
                  productName: 'Online Coaching',
                  offerLabel: '12 weeks',
                  startDate: '2026-09-01',
                  lastActiveDate: '2026-11-23',
                  storedStatus: 'Active',
                  features: ['Training'],
                },
              ],
            }),
          ),
          listProgramTemplates: vi.fn(() => of(emptyPage)),
          searchExercises: vi.fn(() => of(emptyPage)),
          listStrengthMaxes: vi.fn(() =>
            of({
              ...emptyPage,
              total: 1,
              items: [
                {
                  id: 'max-1',
                  exerciseId: 'squat',
                  exerciseName: 'Back squat',
                  kind: 'CoachWorkingMax',
                  value: 100,
                  unit: 'Kilogram',
                  effectiveDate: '2026-09-01',
                  methodKey: 'CoachEntry',
                  methodVersion: '1.0',
                },
              ],
            }),
          ),
          listClientMesocycles: vi.fn(() =>
            of([
              { id: 'block-1', name: 'Strength block', startDate: '2026-09-07', status: 'Active' },
            ]),
          ),
          getTrainingMesocycle: vi.fn(() => of(block)),
          listSavedSessions: vi.fn(() => of([])),
        },
      },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      { provide: TenantStore, useValue: { selectedTenantId: signal('workspace-a') } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(ClientTraining);
  fixture.componentRef.setInput('clientId', 'client-1');
  await settle(fixture);
  return fixture.nativeElement as HTMLElement;
}

/** UI-REDESIGN-PLAN §6: the coach reads coaching words and readable dates, never the engine's. */
describe('ClientTraining words', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('speaks of programs and plans, not snapshots, mesocycles or enrollments', async () => {
    const text = (await render()).textContent ?? '';

    expect(text).toContain('Assign program');
    expect(text).toContain('Program blocks');
    expect(text).toContain('Training max');
    for (const word of ['snapshot', 'mesocycle', 'enrollment', 'Working max', 'transform']) {
      expect(text.toLowerCase()).not.toContain(word.toLowerCase());
    }
  });

  it('names a plan by product, price option and dates', async () => {
    const host = await render();

    const labels = Array.from(field<HTMLSelectElement>(host, 'Plan').options).map((option) =>
      option.textContent?.trim(),
    );
    expect(labels).toEqual(['Select plan...', 'Online Coaching · 12 weeks · 1 Sep – 23 Nov 2026']);
  });

  it('shows dates as people read them, and a block by its last training day', async () => {
    const text = ((await render()).textContent ?? '').replace(/\s+/g, ' ');

    expect(text).toContain('Mon 7 Sep – Sun 4 Oct 2026');
    expect(text).toContain('1 Sep 2026');
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(text).not.toContain('Asia/Beirut');
  });

  it('says who entered a max instead of the internal method key', async () => {
    const text = (await render()).textContent ?? '';

    expect(text).toContain('Entered by coach');
    expect(text).not.toContain('CoachEntry');
  });
});
