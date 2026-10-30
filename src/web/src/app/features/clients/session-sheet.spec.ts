import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import {
  enrollment,
  SERVICE_TODAY,
  sessionPack,
  unpaidPack,
} from '../../../testing/client-service-fixtures';
import {
  chooseDay,
  chooseOption,
  field,
  fill,
  formSummary,
  press,
  segment,
  settle,
} from '../../../testing/dom';
import { SessionSheet } from './session-sheet';

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

async function render(inputs: Record<string, unknown> = {}, api: Record<string, unknown> = {}) {
  const calls = { recordSession: vi.fn(() => of(sessionPack())), ...api };
  TestBed.configureTestingModule({
    imports: [SessionSheet],
    providers: [
      { provide: ApiClient, useValue: calls },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
      { provide: CsrfService, useValue: { refresh: vi.fn().mockResolvedValue(undefined) } },
    ],
  });
  const fixture = TestBed.createComponent(SessionSheet);
  const values: Record<string, unknown> = {
    clientId: 'client-1',
    firstName: 'Maya',
    today: SERVICE_TODAY,
    plans: [enrollment(), sessionPack()],
    ...inputs,
  };
  for (const [name, value] of Object.entries(values)) fixture.componentRef.setInput(name, value);
  const closed = vi.fn();
  const dirty = vi.fn();
  fixture.componentInstance.closed.subscribe(closed);
  fixture.componentInstance.dirtyChange.subscribe(dirty);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api: calls, closed, dirty };
}

const choose = (host: HTMLElement, label: string) => segment(host, 'What happened', label).click();

describe('Record a session', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('says which pack it goes on, and records a session held today with a retry-safe key', async () => {
    const { fixture, host, api, closed } = await render();

    expect(textOf(host.querySelector('.target'))).toBe(
      'Goes on Personal training: 7 of 10 left, until Sun 29 Nov.',
    );
    fill(host, 'Note (optional)', '  Legs  ');
    press(host, 'Record session');
    await settle(fixture);

    expect(api.recordSession).toHaveBeenCalledWith('client-1', {
      outcome: 'Held',
      day: SERVICE_TODAY,
      note: 'Legs',
      reason: null,
      receipt: null,
      idempotencyKey: expect.any(String),
    });
    expect(closed).toHaveBeenCalledWith(expect.objectContaining({ id: 'e-pack' }));
  });

  it('charges a no-show with a reason the client reads, starting from what happened', async () => {
    const { fixture, host, api } = await render();

    choose(host, 'No-show');
    await settle(fixture);
    expect(field<HTMLTextAreaElement>(host, 'Reason').value).toBe('No-show');
    expect(textOf(host)).toContain('Maya reads this. The session comes off their pack.');

    // The other kind changes the reason while it is untouched.
    choose(host, 'Late cancel');
    await settle(fixture);
    expect(field<HTMLTextAreaElement>(host, 'Reason').value).toBe('Late cancel');

    // Their own words stay.
    fill(host, 'Reason', 'Cancelled at 8 for a 9 o’clock');
    choose(host, 'No-show');
    await settle(fixture);
    expect(field<HTMLTextAreaElement>(host, 'Reason').value).toBe('Cancelled at 8 for a 9 o’clock');

    press(host, 'Record session');
    await settle(fixture);
    expect(api.recordSession).toHaveBeenCalledWith(
      'client-1',
      expect.objectContaining({
        outcome: 'Charged',
        note: null,
        reason: 'Cancelled at 8 for a 9 o’clock',
      }),
    );
  });

  it('refuses a charge with no reason on the spot, and marks the box', async () => {
    const { fixture, host, api, closed } = await render();

    choose(host, 'Late cancel');
    await settle(fixture);
    fill(host, 'Reason', '   ');
    press(host, 'Record session');
    await settle(fixture);

    expect(api.recordSession).not.toHaveBeenCalled();
    expect(closed).not.toHaveBeenCalled();
    expect(textOf(host)).toContain('Say why it is charged. Maya reads it.');
    expect(textOf(formSummary(host))).toBe('Check the fields marked above.');
  });

  it('takes an earlier day, with the pack that covers it', async () => {
    const earlier = sessionPack({
      id: 'earlier',
      productName: 'Earlier pack',
      startDate: '2026-08-01',
      endDateExclusive: '2026-09-15',
      lastActiveDate: '2026-09-14',
    });
    const { fixture, host, api } = await render({ plans: [sessionPack(), earlier] });

    await chooseDay(fixture, host, 'Day of the session', '2026-09-10');
    expect(textOf(host.querySelector('.target'))).toContain('Earlier pack');

    press(host, 'Record session');
    await settle(fixture);
    expect(api.recordSession).toHaveBeenCalledWith(
      'client-1',
      expect.objectContaining({ day: '2026-09-10' }),
    );
  });

  it('takes the money with the session when the pack still waits for it', async () => {
    const { fixture, host, api } = await render({ plans: [unpaidPack()] });

    expect(textOf(host.querySelector('.target'))).toBe(
      'Personal training is waiting for USD 35. Saving this records that payment too, received on the day of the session, and the session goes on it.',
    );
    await chooseOption(fixture, host, 'How it was paid', 'Mobile wallet');
    press(host, 'Record session and payment');
    await settle(fixture);

    expect(api.recordSession).toHaveBeenCalledWith(
      'client-1',
      expect.objectContaining({
        receipt: { amount: 35, currencyCode: 'USD', method: 'MobileWallet' },
      }),
    );
  });

  it('asks nothing about money when no pack waits for it', async () => {
    const { host } = await render();
    expect(textOf(host)).not.toContain('How it was paid');
    expect(textOf(host.querySelector('.target'))).not.toContain('USD');
  });

  it('keeps a refusal on screen in the server’s words, and retries with the same key', async () => {
    const refusal = new HttpErrorResponse({
      status: 409,
      error: {
        code: 'no_sessions_left',
        message: 'Maya has no sessions left on Personal training. Sell a new pack first.',
      },
    });
    const recordSession = vi
      .fn()
      .mockReturnValueOnce(throwError(() => refusal))
      .mockReturnValue(of(sessionPack()));
    const { fixture, host, closed } = await render({}, { recordSession });

    press(host, 'Record session');
    await settle(fixture);
    expect(textOf(formSummary(host))).toBe(
      'Maya has no sessions left on Personal training. Sell a new pack first.',
    );
    expect(closed).not.toHaveBeenCalled();

    press(host, 'Record session');
    await settle(fixture);
    const [first, second] = recordSession.mock.calls;
    expect(second[1].idempotencyKey).toBe(first[1].idempotencyKey);
    expect(closed).toHaveBeenCalledOnce();
  });

  it('tells the page once something is typed, and leaves it alone until then', async () => {
    const { fixture, host, closed, dirty } = await render();

    expect(dirty).not.toHaveBeenCalled();
    fill(host, 'Note (optional)', 'Legs');
    await settle(fixture);
    expect(dirty).toHaveBeenCalledWith(true);

    press(host, 'Not now');
    expect(closed).toHaveBeenCalledWith(null);
  });
});
