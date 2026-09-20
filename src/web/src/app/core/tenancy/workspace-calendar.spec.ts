import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../api/api-client';
import { WorkspaceDetails } from '../api/api.models';
import { TenantContext } from './tenant-context';
import { TenantStore } from './tenant.store';
import { WorkspaceCalendar } from './workspace-calendar';

// 01:00 on 21 September in Asia/Beirut. The browser's UTC calendar still reads the 20th, so a
// date derived from the browser and a date derived from the workspace disagree.
const instant = new Date('2026-09-20T22:00:00Z');

const workspace: WorkspaceDetails = {
  id: 'workspace-a',
  name: 'Beirut Strength & Conditioning',
  slug: 'beirut-strength',
  timeZoneId: 'Asia/Beirut',
  defaultCulture: 'en-LB',
  defaultCurrencyCode: 'USD',
  weekStartsOn: 'Monday',
  currentDate: '2026-09-21',
  version: 1,
};

function configure(
  getWorkspace: ReturnType<typeof vi.fn>,
  tenantId = signal<string | null>('workspace-a'),
) {
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiClient, useValue: { getWorkspace } },
      { provide: TenantStore, useValue: { selectedTenantId: tenantId } },
    ],
  });
  return tenantId;
}

describe('WorkspaceCalendar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(instant);
  });

  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it("answers with the workspace's own calendar date, not the browser's", async () => {
    configure(vi.fn(() => of(workspace)));
    const calendar = TestBed.inject(WorkspaceCalendar);

    await expect(calendar.resolveToday()).resolves.toBe('2026-09-21');
    expect(calendar.today()).toBe('2026-09-21');
  });

  it('reads the workspace once and shares one request between concurrent callers', async () => {
    const getWorkspace = vi.fn(() => of(workspace));
    configure(getWorkspace);
    const calendar = TestBed.inject(WorkspaceCalendar);

    const [first, second] = await Promise.all([calendar.resolveToday(), calendar.resolveToday()]);
    await calendar.resolveToday();

    expect([first, second]).toEqual(['2026-09-21', '2026-09-21']);
    expect(getWorkspace).toHaveBeenCalledTimes(1);
  });

  it('drops the cached date when the active workspace changes', async () => {
    const getWorkspace = vi.fn(() => of(workspace));
    const tenantId = configure(getWorkspace);
    const calendar = TestBed.inject(WorkspaceCalendar);
    await calendar.resolveToday();

    getWorkspace.mockReturnValue(
      of({ ...workspace, id: 'workspace-b', currentDate: '2026-09-20' }),
    );
    tenantId.set('workspace-b');
    TestBed.inject(TenantContext).invalidate();

    await expect(calendar.resolveToday()).resolves.toBe('2026-09-20');
    expect(getWorkspace).toHaveBeenCalledTimes(2);
  });

  it("falls back to the browser's local calendar date when the workspace cannot be read", async () => {
    configure(vi.fn(() => throwError(() => new Error('offline'))));
    const calendar = TestBed.inject(WorkspaceCalendar);

    // Under TZ=Asia/Beirut the local date is the 21st; the point is that it never returns blank.
    await expect(calendar.resolveToday()).resolves.toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
