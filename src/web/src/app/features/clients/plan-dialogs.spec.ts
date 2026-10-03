import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type { CoachClientDetails } from '../../core/api/api.models';
import { CsrfService } from '../../core/security/csrf.service';
import { enrollment, SERVICE_TODAY } from '../../../testing/client-service-fixtures';
import { fill, press, settle } from '../../../testing/dom';
import { planCard } from './client-service.models';
import { AccessChange, PlanStatusChange } from './plan-dialogs';

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

const CLIENT = {
  id: 'client-1',
  firstName: 'Maya',
  lastName: 'Fakhoury',
  isCoachBlocked: false,
  version: 3,
} as CoachClientDetails;

function configure(api: Record<string, unknown>) {
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiClient, useValue: api },
      { provide: CsrfService, useValue: { refresh: vi.fn().mockResolvedValue(undefined) } },
    ],
  });
}

async function renderStatus(mode: 'pause' | 'cancel', api: Record<string, unknown> = {}) {
  const calls = {
    pauseEnrollment: vi.fn(() => of(enrollment())),
    cancelEnrollment: vi.fn(() => of(enrollment())),
    ...api,
  };
  configure(calls);
  const fixture = TestBed.createComponent(PlanStatusChange);
  const plan = planCard(enrollment(), { locale: 'en-US', today: SERVICE_TODAY, firstName: 'Maya' });
  fixture.componentRef.setInput('plan', plan);
  fixture.componentRef.setInput('mode', mode);
  fixture.componentRef.setInput('firstName', 'Maya');
  const closed = vi.fn();
  fixture.componentInstance.closed.subscribe(closed);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api: calls, closed };
}

describe('Pause or cancel a plan', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('says a pause keeps the last day, and pauses with the reason and the version on screen', async () => {
    const { fixture, host, api, closed } = await renderStatus('pause');

    expect(textOf(host)).toContain(
      'Pause Online Coaching? Maya can’t use anything it includes while it is paused. It still ends on Mon 12 Oct.',
    );
    fill(host, 'Why are you pausing it?', ' Injured knee ');
    press(host, 'Pause plan');
    await settle(fixture);

    expect(api.pauseEnrollment).toHaveBeenCalledWith('e-1', { reason: 'Injured knee', version: 2 });
    expect(closed).toHaveBeenCalledWith(true);
  });

  it('cancels only with a reason', async () => {
    const { fixture, host, api, closed } = await renderStatus('cancel');

    expect(textOf(host)).toContain(
      'Cancel Online Coaching? Maya loses what it includes from today.',
    );
    press(host, 'Cancel plan');
    await settle(fixture);
    expect(textOf(host)).toContain('Say why. It is kept on the record.');
    expect(document.activeElement).toBe(host.querySelector('textarea'));
    expect(api.cancelEnrollment).not.toHaveBeenCalled();

    fill(host, 'Why are you cancelling it?', 'Moving abroad');
    press(host, 'Cancel plan');
    await settle(fixture);
    expect(api.cancelEnrollment).toHaveBeenCalledWith('e-1', {
      reason: 'Moving abroad',
      version: 2,
    });
    expect(closed).toHaveBeenCalledWith(true);
  });

  it('keeps a stale-version refusal on screen in coach words', async () => {
    const pauseEnrollment = vi.fn(() =>
      throwError(
        () => new HttpErrorResponse({ status: 409, error: { code: 'concurrency_conflict' } }),
      ),
    );
    const { fixture, host, closed } = await renderStatus('pause', { pauseEnrollment });

    fill(host, 'Why are you pausing it?', 'Travel');
    press(host, 'Pause plan');
    await settle(fixture);

    expect(textOf(host.querySelector('[role="alert"]'))).toBe(
      'This was changed somewhere else since you opened it. The page has been reloaded: check it, then try again.',
    );
    expect(closed).not.toHaveBeenCalled();
  });
});

async function renderAccess(client: CoachClientDetails, api: Record<string, unknown> = {}) {
  const calls = {
    blockClientRelationship: vi.fn(() => of({ ...client, isCoachBlocked: true, version: 4 })),
    unblockClientRelationship: vi.fn(() => of({ ...client, isCoachBlocked: false, version: 4 })),
    ...api,
  };
  configure(calls);
  const fixture = TestBed.createComponent(AccessChange);
  fixture.componentRef.setInput('client', client);
  const closed = vi.fn();
  fixture.componentInstance.closed.subscribe(closed);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api: calls, closed };
}

describe('Block or unblock access', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('blocks in this coaching space only, with the reason and the version on screen', async () => {
    const { fixture, host, api, closed } = await renderAccess(CLIENT);

    expect(textOf(host)).toContain('Other coaching spaces aren’t affected.');
    fill(host, 'Reason', 'Unpaid for two months');
    press(host, 'Block access');
    await settle(fixture);

    expect(api.blockClientRelationship).toHaveBeenCalledWith(
      'client-1',
      'Unpaid for two months',
      3,
    );
    expect(closed).toHaveBeenCalledWith(expect.objectContaining({ isCoachBlocked: true }));
  });

  it('unblocks a blocked client rather than blocking them again', async () => {
    const { fixture, host, api } = await renderAccess({ ...CLIENT, isCoachBlocked: true });

    fill(host, 'Reason', 'Paid up');
    press(host, 'Unblock');
    await settle(fixture);

    expect(api.unblockClientRelationship).toHaveBeenCalledWith('client-1', 'Paid up', 3);
    expect(api.blockClientRelationship).not.toHaveBeenCalled();
  });

  it('changes nothing without a reason', async () => {
    const { fixture, host, api, closed } = await renderAccess(CLIENT);

    press(host, 'Block access');
    await settle(fixture);

    expect(textOf(host)).toContain('Say why. It is kept on the record.');
    expect(api.blockClientRelationship).not.toHaveBeenCalled();
    expect(closed).not.toHaveBeenCalled();
  });
});
