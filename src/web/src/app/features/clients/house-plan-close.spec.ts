import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CsrfService } from '../../core/security/csrf.service';
import { closedAsk, housePlanAsk } from '../../../testing/client-service-fixtures';
import { announced, button, field, fill, formSummary, press, settle } from '../../../testing/dom';
import { HousePlanAsksApi } from './house-plan-asks-api';
import { toHousePlanAsk, type HousePlanAsk } from './house-plan-asks.models';
import { HousePlanClose } from './house-plan-close';

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

const ENDED = 'This ask was already booked or closed. Reload the client to see where it stands.';

async function render(close?: unknown) {
  const api = { close: close ?? vi.fn(() => of(toHousePlanAsk(closedAsk({ id: 'ask-1' })))) };
  TestBed.configureTestingModule({
    imports: [HousePlanClose],
    providers: [
      { provide: HousePlanAsksApi, useValue: api },
      { provide: CsrfService, useValue: { refresh: vi.fn().mockResolvedValue(undefined) } },
    ],
  });
  const fixture = TestBed.createComponent(HousePlanClose);
  const ask: HousePlanAsk = toHousePlanAsk(housePlanAsk({ state: 'Asked', moneySent: null }));
  fixture.componentRef.setInput('clientId', 'client-1');
  fixture.componentRef.setInput('ask', ask);
  fixture.componentRef.setInput('firstName', 'Maya');
  const closed = vi.fn();
  const busy = vi.fn();
  const stale = vi.fn();
  fixture.componentInstance.closed.subscribe(closed);
  fixture.componentInstance.busyChange.subscribe(busy);
  fixture.componentInstance.stale.subscribe(stale);
  await settle(fixture);
  document.body.appendChild(fixture.nativeElement);
  return { fixture, host: fixture.nativeElement as HTMLElement, api, closed, busy, stale };
}

describe('Close this ask (SUB-020)', () => {
  afterEach(() => {
    document.querySelectorAll('app-house-plan-close').forEach((node) => node.remove());
    TestBed.resetTestingModule();
  });

  it('names the ask and says the trainee reads the reason', async () => {
    const { host } = await render();

    expect(textOf(host.querySelector('.plan-line'))).toBe('Pro+ Programs, 4 weeks');
    const reason = field<HTMLTextAreaElement>(host, 'Reason');
    expect(reason.getAttribute('maxlength')).toBe('500');
    expect(reason.getAttribute('dir')).toBe('auto');
    expect(textOf(document.getElementById(reason.getAttribute('aria-describedby')!))).toBe(
      'Maya reads this on their plan page. 500 characters at most.',
    );
    expect(announced(host)).toBe('');
  });

  it('sends nothing without a reason, and points at the field', async () => {
    const { fixture, host, api, closed } = await render();

    fill(host, 'Reason', '   ');
    await settle(fixture);
    press(host, 'Close ask');
    await settle(fixture);

    expect(api.close).not.toHaveBeenCalled();
    expect(closed).not.toHaveBeenCalled();
    const reason = field<HTMLTextAreaElement>(host, 'Reason');
    expect(reason.getAttribute('aria-invalid')).toBe('true');
    expect(textOf(host)).toContain('Say why. It is kept on the record.');
    expect(document.activeElement).toBe(reason);
  });

  it('closes the ask with the reason trimmed, and says it is working meanwhile', async () => {
    const answer = new Subject<HousePlanAsk>();
    const close = vi.fn(() => answer);
    const { fixture, host, closed, busy } = await render(close);

    fill(host, 'Reason', '  No money came in a week.  ');
    await settle(fixture);
    press(host, 'Close ask');
    await settle(fixture);
    expect(textOf(host.querySelector('button[type="submit"]'))).toBe('Closing…');
    // The page keeps the dialog open meanwhile, and Not now waits for the answer.
    expect(busy.mock.calls).toEqual([[true]]);
    expect(button(host, 'Not now').disabled).toBe(true);
    // A second tap while it closes sends nothing more.
    (host.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    await settle(fixture);
    expect(close).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith('client-1', 'ask-1', 'No money came in a week.');

    answer.next(toHousePlanAsk(closedAsk({ id: 'ask-1' })));
    answer.complete();
    await settle(fixture);
    expect(closed).toHaveBeenCalledWith(true);
    expect(busy.mock.calls).toEqual([[true], [false]]);
  });

  it('puts the server’s word on the reason under it until it is changed', async () => {
    const close = vi.fn(() =>
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: { errors: { reason: ['Say why, in 500 characters at most.'] } },
          }),
      ),
    );
    const { fixture, host, closed, stale } = await render(close);

    fill(host, 'Reason', 'Not now.');
    await settle(fixture);
    press(host, 'Close ask');
    await settle(fixture);

    const reason = field<HTMLTextAreaElement>(host, 'Reason');
    expect(reason.getAttribute('aria-invalid')).toBe('true');
    expect(textOf(host)).toContain('Say why, in 500 characters at most.');
    expect(textOf(formSummary(host))).toBe('Check the fields marked above.');
    expect(document.activeElement).toBe(formSummary(host));
    expect(closed).not.toHaveBeenCalled();

    fill(host, 'Reason', 'Not now, sorry.');
    await settle(fixture);
    expect(field(host, 'Reason').getAttribute('aria-invalid')).not.toBe('true');
    expect(textOf(formSummary(host))).toBe('');
    expect(stale).not.toHaveBeenCalled();
  });

  it('says an ask booked or closed meanwhile in the summary, in the server’s words', async () => {
    const close = vi.fn(() =>
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { code: 'house_plan_ask_ended', message: ENDED },
          }),
      ),
    );
    const { fixture, host, closed, stale, busy } = await render(close);

    fill(host, 'Reason', 'No money came in a week.');
    await settle(fixture);
    press(host, 'Close ask');
    await settle(fixture);

    expect(textOf(formSummary(host))).toBe(ENDED);
    expect(document.activeElement).toBe(formSummary(host));
    expect(closed).not.toHaveBeenCalled();
    // The page reads its asks again once the dialog is left.
    expect(stale).toHaveBeenCalledTimes(1);
    expect(busy.mock.calls).toEqual([[true], [false]]);
  });

  it('closes on Not now without closing the ask', async () => {
    const { host, api, closed } = await render();

    press(host, 'Not now');
    expect(closed).toHaveBeenCalledWith(false);
    expect(api.close).not.toHaveBeenCalled();
  });
});
