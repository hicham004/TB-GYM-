import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type { ClientTrainingDayResult } from '../../core/api/generated';
import { TenantStore } from '../../core/tenancy/tenant.store';
import type { UpcomingTraining } from '../training/training-read.models';
import { settle, press } from '../../../testing/dom';
import { ClientToday } from './client-today';

const emptyDay: ClientTrainingDayResult = {
  isAllowed: true,
  accessReason: 'Granted',
  localDate: '2026-09-11',
  workouts: [],
};
const upcoming: UpcomingTraining = {
  isAllowed: true,
  accessReason: 'Granted',
  localDate: '2026-09-11',
  hasAssignedProgram: false,
  hasVisibleSessions: false,
  searchThrough: '2026-12-10',
  nextSession: null,
  unfinishedWorkouts: [],
  nextSkip: null,
};

async function render(value: Partial<UpcomingTraining> = {}, api: Partial<ApiClient> = {}) {
  const tenant = signal('tenant-1');
  await TestBed.configureTestingModule({
    imports: [ClientToday],
    providers: [
      provideRouter([]),
      { provide: TenantStore, useValue: { selectedTenantId: tenant } },
      {
        provide: ApiClient,
        useValue: {
          getMyTrainingToday: vi.fn(() => of(emptyDay)),
          getMyUpcomingTraining: vi.fn(() => of({ ...upcoming, ...value })),
          ...api,
        },
      },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(ClientToday);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, tenant };
}

describe('ClientToday', () => {
  afterEach(() => TestBed.resetTestingModule());
  it('distinguishes no program, an unshared program and a rest day', async () => {
    const { fixture, host } = await render();
    expect(host.textContent).toContain('Nothing assigned yet');
    const api = TestBed.inject(ApiClient);
    vi.mocked(api.getMyUpcomingTraining).mockReturnValue(
      of({ ...upcoming, hasAssignedProgram: true }),
    );
    // Retry uses the same rendered control after a load failure.
    vi.mocked(api.getMyTrainingToday).mockReturnValueOnce(throwError(() => new Error()));
    await (fixture.componentInstance as unknown as { load(): Promise<void> }).load();
    await settle(fixture);
    press(host, 'Retry');
    await settle(fixture);
    expect(host.textContent).toContain('No sessions shared yet');
    vi.mocked(api.getMyUpcomingTraining).mockReturnValue(
      of({ ...upcoming, hasAssignedProgram: true, hasVisibleSessions: true }),
    );
    await (fixture.componentInstance as unknown as { load(): Promise<void> }).load();
    await settle(fixture);
    expect(host.textContent).toContain('Rest day');
  });
  it('shows the next shared session and discoverable progress without nutrition links', async () => {
    const { host } = await render({
      hasAssignedProgram: true,
      hasVisibleSessions: true,
      nextSession: { sessionId: 'next', name: 'Upper B', date: '2026-09-12' },
    });
    expect(host.textContent).toContain('Upper B');
    expect(host.querySelector('a[href="/progress/dashboard"]')).not.toBeNull();
    expect(host.querySelector('a[href*="nutrition"]')).toBeNull();
  });
  it('never renders a rest day while loading and ignores a late response from another tenant', async () => {
    const delayed = new Subject<ClientTrainingDayResult>();
    const { fixture, host, tenant } = await render(
      {},
      { getMyTrainingToday: vi.fn().mockReturnValueOnce(delayed).mockReturnValue(of(emptyDay)) },
    );
    expect(host.textContent).toContain('Loading your workout');
    expect(host.textContent).not.toContain('Rest day');
    tenant.set('tenant-2');
    await settle(fixture);
    delayed.next({ ...emptyDay, isAllowed: false, accessReason: 'Expired' });
    delayed.complete();
    await settle(fixture);
    expect(host.textContent).toContain('Nothing assigned yet');
    expect(host.textContent).not.toContain('plan has ended');
  });
});
