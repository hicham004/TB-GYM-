import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { bookedAsk, housePlanAsk } from '../../../testing/client-service-fixtures';
import { announced, button, field, fill, formSummary, press, settle } from '../../../testing/dom';
import { maxAsk } from '../../../testing/max-staff-fixtures';
import { HousePlanAsksApi } from './house-plan-asks-api';
import { toHousePlanAsk, type HousePlanAsk } from './house-plan-asks.models';
import { HousePlanBook } from './house-plan-book';

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

const AMOUNT_REFUSAL =
  'Record the plan’s exact price, USD 47.50. A part books nothing: wait for the rest, or close the ask.';

async function render(ask: HousePlanAsk = toHousePlanAsk(housePlanAsk()), book?: unknown) {
  const api = { book: book ?? vi.fn(() => of(toHousePlanAsk(bookedAsk({ id: ask.id })))) };
  TestBed.configureTestingModule({
    imports: [HousePlanBook],
    providers: [
      { provide: HousePlanAsksApi, useValue: api },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
      { provide: CsrfService, useValue: { refresh: vi.fn().mockResolvedValue(undefined) } },
    ],
  });
  const fixture = TestBed.createComponent(HousePlanBook);
  fixture.componentRef.setInput('clientId', 'client-1');
  fixture.componentRef.setInput('ask', ask);
  fixture.componentRef.setInput('firstName', 'Maya');
  const closed = vi.fn();
  const dirty = vi.fn();
  const busy = vi.fn();
  const stale = vi.fn();
  fixture.componentInstance.closed.subscribe(closed);
  fixture.componentInstance.dirtyChange.subscribe(dirty);
  fixture.componentInstance.busyChange.subscribe(busy);
  fixture.componentInstance.stale.subscribe(stale);
  await settle(fixture);
  document.body.appendChild(fixture.nativeElement);
  return { fixture, host: fixture.nativeElement as HTMLElement, api, closed, dirty, busy, stale };
}

describe('Book the plan (SUB-020)', () => {
  afterEach(() => {
    document.querySelectorAll('app-house-plan-book').forEach((node) => node.remove());
    TestBed.resetTestingModule();
  });

  it('says what is booked, what to check first and where the trainee says the money came from', async () => {
    const { host } = await render();

    // The option is named by its length, so the length is not said twice.
    expect(textOf(host.querySelector('.plan-line'))).toBe('Pro+ Programs, 4 weeks');
    expect(textOf(host)).toContain(
      'Check the Whish account for USD 47.50 first. Booking starts Maya’s plan today, or the day after their current plan ends, and records the money as received by Whish today.',
    );
    expect(textOf(host.querySelector('.sent'))).toBe(
      'Maya says they sent it from Maya Fakhoury, +961 70 123 456 on Wed 30 Sep.',
    );
    const number = host.querySelector('.sent .number')!;
    expect([number.getAttribute('dir'), number.getAttribute('translate')]).toEqual(['ltr', 'no']);
    expect(host.querySelector('.sent span[dir="auto"]')?.textContent).toBe('Maya Fakhoury');
    // The price asked for, in its own currency and with its cents, which the staff never type.
    const amount = field(host, 'Amount received');
    expect([amount.value, amount.type, amount.getAttribute('inputmode'), amount.step]).toEqual([
      '47.50',
      'number',
      'decimal',
      '0.01',
    ]);
    expect(textOf(host.querySelector('.unit'))).toBe('USD');
    const reference = field(host, 'Reference (optional)');
    expect(reference.maxLength).toBe(200);
    expect(textOf(document.getElementById(reference.getAttribute('aria-describedby')!))).toBe(
      'The Whish transaction number, to find it later.',
    );
    expect(announced(host)).toBe('');
  });

  it('says the length of an option named otherwise, and fills a whole price without cents', async () => {
    const { fixture, host, api } = await render(
      toHousePlanAsk(housePlanAsk({ optionLabel: 'Starter month', priceAmount: 45 })),
    );

    expect(textOf(host.querySelector('.plan-line'))).toBe('Pro+ Programs, Starter month · 4 weeks');
    expect(field(host, 'Amount received').value).toBe('45');
    press(host, 'Book plan');
    await settle(fixture);
    expect(api.book).toHaveBeenCalledWith(
      'client-1',
      'ask-1',
      expect.objectContaining({ amount: 45, currencyCode: 'USD' }),
    );
  });

  it('says only the day once the Whish details were erased, and nothing before the money was said sent', async () => {
    const erased = await render(
      toHousePlanAsk(
        housePlanAsk({ moneySent: { whishName: null, whishNumber: null, sentOn: '2026-09-30' } }),
      ),
    );
    expect(textOf(erased.host.querySelector('.sent'))).toBe(
      'Maya says they sent it on Wed 30 Sep.',
    );
    erased.host.remove();
    TestBed.resetTestingModule();

    const asked = await render(toHousePlanAsk(housePlanAsk({ state: 'Asked', moneySent: null })));
    expect(asked.host.querySelector('.sent')).toBeNull();
  });

  it('books the price asked for in its currency, with the reference trimmed', async () => {
    const { fixture, host, api, closed } = await render();

    fill(host, 'Reference (optional)', '  WH-88231 ');
    await settle(fixture);
    press(host, 'Book plan');
    await settle(fixture);

    expect(api.book).toHaveBeenCalledWith('client-1', 'ask-1', {
      amount: 47.5,
      currencyCode: 'USD',
      reference: 'WH-88231',
      idempotencyKey: expect.any(String),
    });
    expect(closed).toHaveBeenCalledWith(true);
  });

  it('sends no reference when none is typed, and says it is working while it books', async () => {
    const answer = new Subject<HousePlanAsk>();
    const book = vi.fn(() => answer);
    const { fixture, host, closed, busy } = await render(undefined, book);

    press(host, 'Book plan');
    await settle(fixture);
    expect(textOf(host.querySelector('button[type="submit"]'))).toBe('Booking…');
    // The page keeps the sheet open meanwhile, and Not now waits for the answer.
    expect(busy.mock.calls).toEqual([[true]]);
    expect(button(host, 'Not now').disabled).toBe(true);
    // A second tap while it books sends nothing more.
    (host.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    await settle(fixture);
    expect(book).toHaveBeenCalledTimes(1);
    expect(book.mock.calls[0]).toEqual([
      'client-1',
      'ask-1',
      expect.objectContaining({ reference: null }),
    ]);

    answer.next(toHousePlanAsk(bookedAsk({ id: 'ask-1' })));
    answer.complete();
    await settle(fixture);
    expect(closed).toHaveBeenCalledWith(true);
    expect(busy.mock.calls).toEqual([[true], [false]]);
  });

  it('keeps the same key for a retry of the same booking, and a new one once it changes', async () => {
    const book = vi
      .fn()
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 0 })))
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 0 })))
      .mockReturnValue(of(toHousePlanAsk(bookedAsk({ id: 'ask-1' }))));
    const { fixture, host, closed } = await render(undefined, book);

    press(host, 'Book plan');
    await settle(fixture);
    expect(textOf(formSummary(host))).toBe('The plan could not be booked. Try again.');
    expect(document.activeElement).toBe(formSummary(host));
    expect(closed).not.toHaveBeenCalled();

    press(host, 'Book plan');
    await settle(fixture);
    fill(host, 'Reference (optional)', 'WH-1');
    await settle(fixture);
    press(host, 'Book plan');
    await settle(fixture);

    const [first, second, third] = book.mock.calls.map((call) => call[2]);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(third.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(closed).toHaveBeenCalledWith(true);
  });

  it('puts a refused amount under the field until it is changed', async () => {
    const book = vi.fn(() =>
      throwError(
        () =>
          new HttpErrorResponse({ status: 400, error: { errors: { amount: [AMOUNT_REFUSAL] } } }),
      ),
    );
    const { fixture, host, closed } = await render(undefined, book);

    fill(host, 'Amount received', '20');
    await settle(fixture);
    press(host, 'Book plan');
    await settle(fixture);

    const amount = field(host, 'Amount received');
    expect(amount.getAttribute('aria-invalid')).toBe('true');
    expect(textOf(document.getElementById(amount.getAttribute('aria-describedby')!))).toBe(
      AMOUNT_REFUSAL,
    );
    expect(textOf(formSummary(host))).toBe('Check the fields marked above.');
    expect(document.activeElement).toBe(formSummary(host));
    expect(closed).not.toHaveBeenCalled();

    // The same figure again is not sent: the field still says why.
    press(host, 'Book plan');
    await settle(fixture);
    expect(book).toHaveBeenCalledTimes(1);

    fill(host, 'Amount received', '47.50');
    await settle(fixture);
    expect(field(host, 'Amount received').getAttribute('aria-invalid')).not.toBe('true');
    expect(textOf(formSummary(host))).toBe('');
  });

  it('sends nothing without an amount, and points at the field', async () => {
    const { fixture, host, api } = await render();

    fill(host, 'Amount received', '');
    await settle(fixture);
    press(host, 'Book plan');
    await settle(fixture);

    expect(api.book).not.toHaveBeenCalled();
    const amount = field(host, 'Amount received');
    expect(textOf(document.getElementById(amount.getAttribute('aria-describedby')!))).toBe(
      'Enter the amount received.',
    );
    expect(document.activeElement).toBe(amount);
  });

  it('says an ask booked or closed meanwhile, and a read-only space, in the summary', async () => {
    const ended =
      'This ask was already booked or closed. Reload the client to see where it stands.';
    const book = vi
      .fn()
      .mockReturnValueOnce(
        throwError(
          () =>
            new HttpErrorResponse({
              status: 409,
              error: { code: 'house_plan_ask_ended', message: ended },
            }),
        ),
      )
      .mockReturnValueOnce(
        throwError(
          () =>
            new HttpErrorResponse({
              status: 403,
              error: { code: 'workspace_read_only', message: 'Read only.' },
            }),
        ),
      );
    const { fixture, host, stale, busy } = await render(undefined, book);

    press(host, 'Book plan');
    await settle(fixture);
    expect(textOf(formSummary(host))).toBe(ended);
    // The page reads its asks again once the sheet is left.
    expect(stale).toHaveBeenCalledTimes(1);
    expect(busy.mock.calls).toEqual([[true], [false]]);
    expect(button(host, 'Not now').disabled).toBe(false);

    press(host, 'Book plan');
    await settle(fixture);
    expect(textOf(formSummary(host))).toBe(
      'Your coaching space is read-only until its TB Gym bill is paid. You can still view everything.',
    );
    expect(stale).toHaveBeenCalledTimes(1);
  });

  describe('a Max ask (N9c5a)', () => {
    const NO_PLACE =
      'Maya’s ask has no Max place yet, so they were told not to send money. Book it only if the money is there.';

    it('warns that the trainee was told not to pay while no place is open, and books anyway', async () => {
      const { fixture, host, api } = await render(toHousePlanAsk(maxAsk()));

      expect(textOf(host.querySelector('.plan-line'))).toBe('Max coaching, 4 weeks');
      expect(textOf(host.querySelector('[data-no-place]'))).toBe(NO_PLACE);
      expect(host.querySelector('[data-no-place]')?.getAttribute('dir')).toBe('auto');
      expect(host.querySelector('.sent')).toBeNull();
      expect(field(host, 'Amount received').value).toBe('120');
      press(host, 'Book plan');
      await settle(fixture);
      expect(api.book).toHaveBeenCalledWith(
        'client-1',
        'ask-max',
        expect.objectContaining({ amount: 120, currencyCode: 'USD' }),
      );
    });

    it('says nothing of a place once one is open, or once the money is said sent', async () => {
      const open = await render(toHousePlanAsk(maxAsk({ placeOpen: true, placeInLine: 1 })));
      expect(open.host.querySelector('[data-no-place]')).toBeNull();
      open.host.remove();
      TestBed.resetTestingModule();

      const sent = await render(
        toHousePlanAsk(
          maxAsk({
            state: 'MoneySent',
            placeOpen: false,
            placeInLine: null,
            moneySent: { whishName: 'Maya Fakhoury', whishNumber: null, sentOn: '2026-09-30' },
          }),
        ),
      );
      expect(sent.host.querySelector('[data-no-place]')).toBeNull();
      expect(textOf(sent.host.querySelector('.sent'))).toBe(
        'Maya says they sent it on Wed 30 Sep.',
      );
    });

    it('says a full or closed Max in the server’s words, and tells the page its asks are out of date', async () => {
      const full = 'Every place on Max is taken. Book this ask once a place opens, or close it.';
      const closed =
        "Max is closed: TB Gym's settings give it no places. Book this ask once Max opens again, or close it.";
      const refused = (code: string, message: string) =>
        throwError(() => new HttpErrorResponse({ status: 409, error: { code, message } }));
      const book = vi
        .fn()
        .mockReturnValueOnce(refused('house_max_full', full))
        .mockReturnValueOnce(refused('house_max_closed', closed));
      const { fixture, host, stale, closed: done } = await render(toHousePlanAsk(maxAsk()), book);

      press(host, 'Book plan');
      await settle(fixture);
      expect(textOf(formSummary(host))).toBe(full);
      expect(document.activeElement).toBe(formSummary(host));
      expect(stale).toHaveBeenCalledTimes(1);
      // A 409 marks no field: the amount was right.
      expect(field(host, 'Amount received').getAttribute('aria-invalid')).not.toBe('true');

      press(host, 'Book plan');
      await settle(fixture);
      expect(textOf(formSummary(host))).toBe(closed);
      expect(stale).toHaveBeenCalledTimes(2);
      expect(done).not.toHaveBeenCalled();
    });
  });

  it('tells the page when something is typed, and closes on Not now without booking', async () => {
    const { fixture, host, api, closed, dirty } = await render();

    fill(host, 'Reference (optional)', 'WH');
    await settle(fixture);
    expect(dirty).toHaveBeenCalledWith(true);
    press(host, 'Not now');
    expect(closed).toHaveBeenCalledWith(false);
    expect(api.book).not.toHaveBeenCalled();
  });
});
