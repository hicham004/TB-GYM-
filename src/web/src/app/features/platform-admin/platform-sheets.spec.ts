import { HttpErrorResponse } from '@angular/common/http';
import type { OutputRef, Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CsrfService } from '../../core/security/csrf.service';
import {
  announced,
  button,
  chooseDay,
  chosenDay,
  dateField,
  field,
  fill,
  press,
  query,
  settle,
  tick,
} from '../../../testing/dom';
import {
  amounts,
  discount,
  invoice,
  plan,
  SPACE_IDS,
  TODAY,
} from '../../../testing/platform-admin-fixtures';
import { PlatformAdminApi } from './platform-admin-api';
import {
  PlatformClientGrant,
  PlatformDiscount,
  PlatformPayment,
  PlatformPlan,
  PlatformVoid,
} from './platform-sheets';

type Api = { [K in keyof PlatformAdminApi]: ReturnType<typeof vi.fn> };

/** What every sheet tells its page: the result it closed with, and whether it holds typed work. */
interface SheetOutputs {
  readonly closed: OutputRef<unknown>;
  readonly dirtyChange: OutputRef<boolean>;
}

const PUBLISHED = plan({ id: 'plan-3', versionNumber: 3, seatPrice: 20, isCurrent: true });

async function render<T extends SheetOutputs>(
  component: Type<T>,
  inputs: Record<string, unknown>,
  overrides: Partial<Api> = {},
  refresh: () => Promise<void> = () => Promise.resolve(),
) {
  const api: Api = {
    getWorkspaces: vi.fn(),
    getWorkspace: vi.fn(),
    getGymRequests: vi.fn(),
    getPricePlans: vi.fn(),
    publishPricePlan: vi.fn(() => of(PUBLISHED)),
    issueInvoices: vi.fn(),
    recordPayment: vi.fn(() => of({})),
    voidInvoice: vi.fn(() => of({})),
    grantDiscount: vi.fn(() => of({})),
    revokeDiscount: vi.fn(),
    grantIncludedClients: vi.fn(() => of({})),
    revokeIncludedClientGrant: vi.fn(),
    getLegalDocuments: vi.fn(),
    publishLegalDocument: vi.fn(),
    withdrawLegalDocument: vi.fn(),
    ...overrides,
  };
  const csrf = { refresh: vi.fn(refresh) };
  TestBed.configureTestingModule({
    providers: [
      { provide: PlatformAdminApi, useValue: api },
      { provide: CsrfService, useValue: csrf },
    ],
  });
  const fixture = TestBed.createComponent(component);
  for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
  const closed: unknown[] = [];
  const dirty: boolean[] = [];
  fixture.componentInstance.closed.subscribe((value) => closed.push(value));
  fixture.componentInstance.dirtyChange.subscribe((value) => dirty.push(value));
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api, csrf, closed, dirty };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** What a control's description says: its reason once one is due, otherwise its help. */
function description(control: Element): string {
  return (control.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .filter((id) => id.length > 0)
    .map((id) => textOf(document.getElementById(id)))
    .join(' ');
}

/** The button of the kit date field labelled `label`, which carries its state and its reason. */
const dayButton = (host: ParentNode, label: string) =>
  query<HTMLButtonElement>(dateField(host, label), 'button.trigger');

/** The day the kit date field labelled `label` shows on its button, as a person reads it. */
const shownDay = (host: ParentNode, label: string) =>
  textOf(dateField(host, label).querySelector('.value'));

/** A refusal the server explained in its own words. */
const refusal = (code: string, message: string) =>
  new HttpErrorResponse({ status: 409, error: { code, message } });

afterEach(() => {
  TestBed.resetTestingModule();
});

describe('Platform billing sheets: recording a payment', () => {
  const inputs = (overrides: Partial<ReturnType<typeof invoice>> = {}) => ({
    invoice: invoice(overrides),
    spaceName: 'Atlas Performance',
    today: TODAY,
  });

  it('names the space, the month and the invoice, and asks for exactly its total', async () => {
    const { host } = await render(
      PlatformPayment,
      inputs({ amounts: amounts({ total: 38.5, discountPercent: 30, discountAmount: 16.5 }) }),
    );

    expect(textOf(host.querySelector('.about'))).toBe(
      'Atlas Performance September 2026 · TBG-202609-KX4P7Q',
    );
    expect(textOf(host.querySelector('.amount'))).toBe('Amount received $38.50');
    // Nothing is wrong before the admin has done anything.
    expect(announced(host)).toBe('');
    const reference = field(host, 'Whish or transfer reference');
    expect(reference.getAttribute('aria-invalid')).toBeNull();
    expect(description(reference)).toBe(
      'The number on the transfer, so the money can be found later.',
    );
  });

  it('starts on today and offers only the days from the invoice’s issue up to today', async () => {
    const { fixture, host } = await render(PlatformPayment, inputs());

    expect(description(dayButton(host, 'Received on'))).toBe(
      'The day the money arrived. Days are UTC, like the invoice’s.',
    );
    expect(await chosenDay(fixture, host, 'Received on')).toBe(TODAY);
    const day = (iso: string) =>
      query<HTMLButtonElement>(host, `button.day[data-date="${iso}"]`).getAttribute(
        'aria-disabled',
      );
    // Issued at 00:10 UTC on 1 October: that day may hold the money, the day before may not.
    expect(day('2026-09-30')).toBe('true');
    expect(day('2026-10-01')).toBeNull();
    expect(day(TODAY)).toBeNull();
    expect(day('2026-10-10')).toBe('true');
  });

  it('records nothing without a reference: it marks the field, says why and puts focus on it', async () => {
    const { fixture, host, api, closed } = await render(PlatformPayment, inputs());

    fill(host, 'Whish or transfer reference', '   ');
    await settle(fixture);
    press(host, 'Record payment');
    await settle(fixture);

    expect(api.recordPayment).not.toHaveBeenCalled();
    const reference = field(host, 'Whish or transfer reference');
    expect(reference.getAttribute('aria-invalid')).toBe('true');
    expect(description(reference)).toBe('Enter the Whish or transfer reference.');
    expect(announced(host)).toBe('Check the fields marked above.');
    expect(document.activeElement).toBe(reference);
    expect(closed).toEqual([]);
  });

  it('records the invoice’s total under the trimmed reference, with no note when none was written', async () => {
    const { fixture, host, api, csrf, closed } = await render(PlatformPayment, inputs());

    fill(host, 'Whish or transfer reference', '  WHISH-99 ');
    await settle(fixture);
    press(host, 'Record payment');
    await settle(fixture);

    expect(api.recordPayment).toHaveBeenCalledExactlyOnceWith(
      'invoice-sep',
      55,
      'WHISH-99',
      null,
      TODAY,
    );
    // The antiforgery token is fresh before the write goes out.
    expect(csrf.refresh.mock.invocationCallOrder[0]).toBeLessThan(
      api.recordPayment.mock.invocationCallOrder[0],
    );
    expect(closed).toEqual([true]);
  });

  it('records the invoice’s exact total, cents and all, never a rounded one', async () => {
    const { fixture, host, api } = await render(
      PlatformPayment,
      inputs({ amounts: amounts({ total: 51.71, discountPercent: 12.5, discountAmount: 7.39 }) }),
    );

    expect(textOf(host.querySelector('.amount'))).toBe('Amount received $51.71');
    fill(host, 'Whish or transfer reference', 'WHISH-51');
    await settle(fixture);
    press(host, 'Record payment');
    await settle(fixture);

    expect(api.recordPayment).toHaveBeenCalledExactlyOnceWith(
      'invoice-sep',
      51.71,
      'WHISH-51',
      null,
      TODAY,
    );
  });

  it('dates the payment the day the money arrived and keeps the note in the admin’s words', async () => {
    const { fixture, host, api } = await render(PlatformPayment, inputs());

    fill(host, 'Whish or transfer reference', 'WHISH-7');
    fill(host, 'Note (optional)', '  Paid at the Hamra shop  ');
    await chooseDay(fixture, host, 'Received on', '2026-10-07');
    press(host, 'Record payment');
    await settle(fixture);

    expect(api.recordPayment).toHaveBeenCalledExactlyOnceWith(
      'invoice-sep',
      55,
      'WHISH-7',
      'Paid at the Hamra shop',
      '2026-10-07',
    );
  });

  it('keeps the entry open with the server’s words when the server refuses', async () => {
    const { fixture, host, closed } = await render(PlatformPayment, inputs(), {
      recordPayment: vi.fn(() =>
        throwError(() =>
          refusal(
            'invoice_void',
            'This invoice was voided. Record the payment against its replacement.',
          ),
        ),
      ),
    });

    fill(host, 'Whish or transfer reference', 'WHISH-1');
    await settle(fixture);
    press(host, 'Record payment');
    await settle(fixture);

    expect(announced(host)).toBe(
      'This invoice was voided. Record the payment against its replacement.',
    );
    expect(field(host, 'Whish or transfer reference').value).toBe('WHISH-1');
    expect(button(host, 'Record payment').getAttribute('aria-disabled')).toBeNull();
    expect(closed).toEqual([]);
  });

  it('says its own sentence when the server fails without words of its own', async () => {
    const { fixture, host, closed } = await render(PlatformPayment, inputs(), {
      recordPayment: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 500 }))),
    });

    fill(host, 'Whish or transfer reference', 'WHISH-1');
    await settle(fixture);
    press(host, 'Record payment');
    await settle(fixture);

    expect(announced(host)).toBe('The payment could not be recorded. Try again.');
    expect(closed).toEqual([]);
  });

  it('says Recording… while it records, and a second press sends nothing', async () => {
    const answer = new Subject<unknown>();
    const { fixture, host, api, closed } = await render(PlatformPayment, inputs(), {
      recordPayment: vi.fn(() => answer),
    });

    fill(host, 'Whish or transfer reference', 'WHISH-5');
    await settle(fixture);
    press(host, 'Record payment');
    await settle(fixture);

    const busy = button(host, 'Recording…');
    expect(busy.getAttribute('aria-disabled')).toBe('true');
    press(host, 'Recording…');
    await settle(fixture);
    expect(api.recordPayment).toHaveBeenCalledTimes(1);
    expect(closed).toEqual([]);

    answer.next({});
    answer.complete();
    await settle(fixture);
    expect(closed).toEqual([true]);
  });

  it('closes without recording on Not now', async () => {
    const { fixture, host, api, closed } = await render(PlatformPayment, inputs());

    fill(host, 'Whish or transfer reference', 'WHISH-3');
    await settle(fixture);
    press(host, 'Not now');
    await settle(fixture);

    expect(closed).toEqual([false]);
    expect(api.recordPayment).not.toHaveBeenCalled();
  });

  it('tells the page once something typed would be lost, and again once it is cleared', async () => {
    const { fixture, host, dirty } = await render(PlatformPayment, inputs());
    expect(dirty.at(-1)).toBe(false);

    fill(host, 'Whish or transfer reference', 'W');
    await settle(fixture);
    expect(dirty.at(-1)).toBe(true);

    fill(host, 'Whish or transfer reference', '');
    await settle(fixture);
    expect(dirty.at(-1)).toBe(false);

    fill(host, 'Note (optional)', 'At the shop');
    await settle(fixture);
    expect(dirty.at(-1)).toBe(true);
  });
});

describe('Platform billing sheets: voiding an invoice', () => {
  const inputs = (overrides: Partial<ReturnType<typeof invoice>> = {}) => ({
    invoice: invoice(overrides),
    spaceName: 'Atlas Performance',
  });

  it('says what is voided, issues a corrected invoice by default, and says what each choice does', async () => {
    const { fixture, host } = await render(PlatformVoid, inputs());

    expect(textOf(host.querySelector('.about'))).toBe(
      'Atlas Performance September 2026 · TBG-202609-KX4P7Q · $55.00',
    );
    const reissue = field(host, 'Issue a corrected invoice');
    expect(reissue.checked).toBe(true);
    expect(button(host, 'Void and reissue')).toBeTruthy();
    const outcome = query<HTMLElement>(host, '.notice');
    expect(outcome.getAttribute('aria-live')).toBe('polite');
    expect(textOf(outcome)).toBe(
      'A new invoice for September 2026 is issued today at plan version 1’s prices. It counts Atlas Performance’s seats and clients again as of now, with any discount in force, and is due 7 days from today. The owner is emailed it.',
    );

    tick(host, 'Issue a corrected invoice', false);
    await settle(fixture);

    expect(textOf(outcome)).toBe(
      'Atlas Performance will owe nothing for September 2026. The voided invoice stays on record, struck through.',
    );
    expect(button(host, 'Void invoice')).toBeTruthy();
    expect(host.textContent).not.toContain('Void and reissue');
  });

  it('gives the corrected invoice the original’s own term to be paid', async () => {
    const { host } = await render(
      PlatformVoid,
      inputs({ issuedAtUtc: '2026-10-01T00:10:00Z', dueOn: '2026-10-02' }),
    );

    expect(textOf(host.querySelector('.notice'))).toContain('is due 1 day from today.');
  });

  it('voids nothing without a reason: it marks the box, says why and puts focus on it', async () => {
    const { fixture, host, api, closed } = await render(PlatformVoid, inputs());

    fill(host, 'Why is it void?', '  ');
    await settle(fixture);
    press(host, 'Void and reissue');
    await settle(fixture);

    expect(api.voidInvoice).not.toHaveBeenCalled();
    const reason = field<HTMLTextAreaElement>(host, 'Why is it void?');
    expect(reason.getAttribute('aria-invalid')).toBe('true');
    expect(description(reason)).toBe('Say why the invoice is voided.');
    expect(announced(host)).toBe('Check the fields marked above.');
    expect(document.activeElement).toBe(reason);
    expect(closed).toEqual([]);
  });

  it('sends the invoice, the reason trimmed and the choice to issue a corrected one', async () => {
    const { fixture, host, api, csrf, closed } = await render(PlatformVoid, inputs());

    fill(host, 'Why is it void?', '  Wrong seat count ');
    await settle(fixture);
    press(host, 'Void and reissue');
    await settle(fixture);

    expect(api.voidInvoice).toHaveBeenCalledExactlyOnceWith(
      'invoice-sep',
      'Wrong seat count',
      true,
    );
    expect(csrf.refresh.mock.invocationCallOrder[0]).toBeLessThan(
      api.voidInvoice.mock.invocationCallOrder[0],
    );
    expect(closed).toEqual([true]);
  });

  it('voids without a replacement once the box is unticked', async () => {
    const { fixture, host, api, closed } = await render(PlatformVoid, inputs());

    tick(host, 'Issue a corrected invoice', false);
    fill(host, 'Why is it void?', 'Billed by mistake');
    await settle(fixture);
    press(host, 'Void invoice');
    await settle(fixture);

    expect(api.voidInvoice).toHaveBeenCalledExactlyOnceWith(
      'invoice-sep',
      'Billed by mistake',
      false,
    );
    expect(closed).toEqual([true]);
  });

  it('keeps the reason with the server’s words when the server refuses', async () => {
    const { fixture, host, closed } = await render(PlatformVoid, inputs(), {
      voidInvoice: vi.fn(() =>
        throwError(() => refusal('invoice_paid', 'This invoice is paid, so it cannot be voided.')),
      ),
    });

    fill(host, 'Why is it void?', 'Wrong seat count');
    await settle(fixture);
    press(host, 'Void and reissue');
    await settle(fixture);

    expect(announced(host)).toBe('This invoice is paid, so it cannot be voided.');
    expect(field<HTMLTextAreaElement>(host, 'Why is it void?').value).toBe('Wrong seat count');
    expect(closed).toEqual([]);
  });

  it('closes on Not now without voiding, and tells the page once a reason is typed', async () => {
    const { fixture, host, api, closed, dirty } = await render(PlatformVoid, inputs());
    expect(dirty.at(-1)).toBe(false);

    fill(host, 'Why is it void?', 'Wrong month');
    await settle(fixture);
    expect(dirty.at(-1)).toBe(true);

    press(host, 'Not now');
    await settle(fixture);
    expect(closed).toEqual([false]);
    expect(api.voidInvoice).not.toHaveBeenCalled();
  });
});

describe('Platform billing sheets: granting a discount', () => {
  const inputs = (existing = [discount({ revokedAtUtc: '2026-09-20T09:00:00Z' })]) => ({
    tenantId: SPACE_IDS.atlas,
    spaceName: 'Atlas Performance',
    today: TODAY,
    existing,
  });

  it('starts on today and asks for the percent, the last day and what it is for, with focus on the first', async () => {
    const { fixture, host, api, closed } = await render(PlatformDiscount, inputs());

    expect(textOf(host.querySelector('.about'))).toBe(
      'Atlas Performance Comes off every invoice for a month it touches. Two discounts cannot overlap.',
    );
    // N7: the note is the discount's name on the owner's Billing page, and the sheet says so.
    expect(description(field(host, 'What it is for'))).toBe(
      'The owner sees this as the discount’s name.',
    );
    press(host, 'Grant discount');
    await settle(fixture);

    expect(api.grantDiscount).not.toHaveBeenCalled();
    const percent = field(host, 'Percent off');
    expect(percent.getAttribute('aria-invalid')).toBe('true');
    expect(description(percent)).toBe('Enter how many percent off.');
    expect(dayButton(host, 'First day').getAttribute('aria-invalid')).toBeNull();
    expect(dayButton(host, 'Last day').getAttribute('aria-invalid')).toBe('true');
    expect(description(dayButton(host, 'Last day'))).toBe('Choose the last day.');
    expect(description(field(host, 'What it is for'))).toBe('Say what the discount is for.');
    expect(announced(host)).toBe('Check the fields marked above.');
    expect(document.activeElement).toBe(percent);
    expect(await chosenDay(fixture, host, 'First day')).toBe(TODAY);
    expect(closed).toEqual([]);
  });

  it('sets the last day by length, counted from the first day', async () => {
    const { fixture, host } = await render(PlatformDiscount, inputs());
    expect(query(host, '.presets[role="group"]').getAttribute('aria-label')).toBe(
      'Choose the last day by length',
    );

    press(host, '3 months');
    await settle(fixture);
    expect(shownDay(host, 'Last day')).toBe('Fri, Jan 8, 2027');

    press(host, '6 months');
    await settle(fixture);
    expect(shownDay(host, 'Last day')).toBe('Thu, Apr 8, 2027');

    press(host, 'A year');
    await settle(fixture);
    expect(shownDay(host, 'Last day')).toBe('Fri, Oct 8, 2027');

    await chooseDay(fixture, host, 'First day', '2026-11-01');
    press(host, '3 months');
    await settle(fixture);
    expect(shownDay(host, 'Last day')).toBe('Sun, Jan 31, 2027');
  });

  it('refuses days that overlap a discount still in force, and names that discount', async () => {
    const { fixture, host, api } = await render(PlatformDiscount, inputs([discount()]));

    fill(host, 'Percent off', '10');
    fill(host, 'What it is for', 'Loyalty');
    press(host, '3 months');
    await settle(fixture);
    press(host, 'Grant discount');
    await settle(fixture);

    expect(api.grantDiscount).not.toHaveBeenCalled();
    const first = dayButton(host, 'First day');
    expect(first.getAttribute('aria-invalid')).toBe('true');
    expect(description(first)).toBe(
      'That overlaps the 30% discount from Sep 1, 2026 to Nov 30, 2026. Revoke it first.',
    );
    expect(document.activeElement).toBe(first);
  });

  it('grants the percent from the first day up to the day after the last, with the note trimmed', async () => {
    const { fixture, host, api, csrf, closed } = await render(PlatformDiscount, inputs());

    fill(host, 'Percent off', '12.5');
    fill(host, 'What it is for', '  Founding coach  ');
    await chooseDay(fixture, host, 'First day', '2026-11-01');
    await chooseDay(fixture, host, 'Last day', '2027-01-31');
    press(host, 'Grant discount');
    await settle(fixture);

    // A revoked discount on the same days is no obstacle.
    expect(api.grantDiscount).toHaveBeenCalledExactlyOnceWith(
      SPACE_IDS.atlas,
      12.5,
      '2026-11-01',
      '2027-02-01',
      'Founding coach',
    );
    expect(csrf.refresh.mock.invocationCallOrder[0]).toBeLessThan(
      api.grantDiscount.mock.invocationCallOrder[0],
    );
    expect(closed).toEqual([true]);
  });

  it('keeps the entry with the server’s words when the server refuses', async () => {
    const { fixture, host, closed } = await render(PlatformDiscount, inputs(), {
      grantDiscount: vi.fn(() =>
        throwError(() =>
          refusal(
            'discount_overlap',
            'This workspace already has a discount on some of those dates. Revoke it first.',
          ),
        ),
      ),
    });

    fill(host, 'Percent off', '10');
    fill(host, 'What it is for', 'Loyalty');
    press(host, '6 months');
    await settle(fixture);
    press(host, 'Grant discount');
    await settle(fixture);

    expect(announced(host)).toBe(
      'This workspace already has a discount on some of those dates. Revoke it first.',
    );
    expect(field(host, 'Percent off').value).toBe('10');
    expect(closed).toEqual([]);
  });

  it('closes on Not now without granting, and tells the page once something is entered', async () => {
    const { fixture, host, api, closed, dirty } = await render(PlatformDiscount, inputs());
    expect(dirty.at(-1)).toBe(false);

    fill(host, 'Percent off', '15');
    await settle(fixture);
    expect(dirty.at(-1)).toBe(true);

    press(host, 'Not now');
    await settle(fixture);
    expect(closed).toEqual([false]);
    expect(api.grantDiscount).not.toHaveBeenCalled();
  });
});

describe('Platform billing sheets: granting extra included clients (notes plan N11b)', () => {
  const inputs = () => ({
    tenantId: SPACE_IDS.atlas,
    spaceName: 'Atlas Performance',
    today: TODAY,
  });

  it('starts on next month alone, says what a grant does, and asks for the clients and what it is for', async () => {
    const { fixture, host, api, closed, dirty } = await render(PlatformClientGrant, inputs());

    expect(textOf(host.querySelector('.about'))).toBe(
      'Atlas Performance Adds its clients to the included clients of the invoice of each month it covers, on top of the seats’ and a founding seat’s. Two grants in one month add up.',
    );
    // Next month alone by default, so one grant is one invoice.
    expect(await chosenDay(fixture, host, 'First day')).toBe('2026-11-01');
    expect(await chosenDay(fixture, host, 'Last day')).toBe('2026-11-30');
    expect(description(dayButton(host, 'First day'))).toBe('The 1st of a month.');
    expect(description(dayButton(host, 'Last day'))).toBe(
      'A month’s last day. The grant covers this day too.',
    );
    expect(description(field(host, 'What it is for'))).toBe(
      'Only TB Gym’s admin sees it. Say which coach was brought.',
    );
    expect(dirty.at(-1), 'The defaults alone are nothing typed.').toBe(false);

    press(host, 'Grant clients');
    await settle(fixture);
    expect(api.grantIncludedClients).not.toHaveBeenCalled();
    const clients = field(host, 'Clients');
    expect(clients.getAttribute('aria-invalid')).toBe('true');
    expect(description(clients)).toBe('Enter a whole number of clients from 1 to 1000.');
    expect(description(field(host, 'What it is for'))).toBe(
      'Say what the extra clients are for, in up to 200 characters.',
    );
    expect(dayButton(host, 'First day').getAttribute('aria-invalid')).toBeNull();
    expect(dayButton(host, 'Last day').getAttribute('aria-invalid')).toBeNull();
    expect(announced(host)).toBe('Check the fields marked above.');
    expect(document.activeElement).toBe(clients);
    expect(closed).toEqual([]);
    // The plan's section 1: no coach is called checked, in any word the sheet shows.
    expect(textOf(host)).not.toMatch(/\b(verified|certified|qualified|licensed|approved)\b/i);
  });

  it('sets the last day by whole calendar months, from the first day’s month', async () => {
    const { fixture, host } = await render(PlatformClientGrant, inputs());
    expect(query(host, '.presets[role="group"]').getAttribute('aria-label')).toBe(
      'Choose the last day by length',
    );

    press(host, '3 months');
    await settle(fixture);
    expect(shownDay(host, 'Last day')).toBe('Sun, Jan 31, 2027');

    press(host, '2 months');
    await settle(fixture);
    expect(shownDay(host, 'Last day')).toBe('Thu, Dec 31, 2026');

    press(host, 'One month');
    await settle(fixture);
    expect(shownDay(host, 'Last day')).toBe('Mon, Nov 30, 2026');

    await chooseDay(fixture, host, 'First day', '2027-01-01');
    press(host, '2 months');
    await settle(fixture);
    expect(shownDay(host, 'Last day')).toBe('Sun, Feb 28, 2027');
  });

  it('moves the last day with a new first day, keeping the whole months chosen', async () => {
    const { fixture, host, api } = await render(PlatformClientGrant, inputs());

    // An earlier first day never stretches the grant: one month from it, as the default was.
    await chooseDay(fixture, host, 'First day', '2026-09-01');
    expect(shownDay(host, 'Last day')).toBe('Wed, Sep 30, 2026');

    press(host, '3 months');
    await settle(fixture);
    expect(shownDay(host, 'Last day')).toBe('Mon, Nov 30, 2026');
    await chooseDay(fixture, host, 'First day', '2026-12-01');
    expect(shownDay(host, 'Last day')).toBe('Sun, Feb 28, 2027');

    fill(host, 'Clients', '4');
    fill(host, 'What it is for', 'Brought Karim Haddad');
    await settle(fixture);
    press(host, 'Grant clients');
    await settle(fixture);
    expect(api.grantIncludedClients).toHaveBeenCalledExactlyOnceWith(
      SPACE_IDS.atlas,
      4,
      '2026-12-01',
      '2027-03-01',
      'Brought Karim Haddad',
    );
  });

  it('marks a first day off a month’s edge on its field, before asking the server', async () => {
    const { fixture, host, api } = await render(PlatformClientGrant, inputs());

    fill(host, 'Clients', '4');
    fill(host, 'What it is for', 'Brought Karim Haddad');
    await chooseDay(fixture, host, 'First day', '2026-11-15');
    const first = dayButton(host, 'First day');
    expect(first.getAttribute('aria-invalid')).toBe('true');
    expect(description(first)).toBe(
      'Start on the first day of a month: extra clients are granted for whole months.',
    );

    press(host, 'Grant clients');
    await settle(fixture);
    expect(api.grantIncludedClients).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(first);
  });

  it('marks a last day off a month’s edge on its field', async () => {
    const { fixture, host, api } = await render(PlatformClientGrant, inputs());

    fill(host, 'Clients', '4');
    fill(host, 'What it is for', 'Brought Karim Haddad');
    await chooseDay(fixture, host, 'Last day', '2026-12-30');
    const last = dayButton(host, 'Last day');
    expect(last.getAttribute('aria-invalid')).toBe('true');
    expect(description(last)).toBe(
      'End on the last day of a month: extra clients are granted for whole months.',
    );
    press(host, 'Grant clients');
    await settle(fixture);
    expect(api.grantIncludedClients).not.toHaveBeenCalled();
  });

  it('grants the clients from the first day up to the day after the last, with the note trimmed', async () => {
    const { fixture, host, api, csrf, closed } = await render(PlatformClientGrant, inputs());

    fill(host, 'Clients', '7');
    fill(host, 'What it is for', '  Brought Karim Haddad  ');
    press(host, '3 months');
    await settle(fixture);
    press(host, 'Grant clients');
    await settle(fixture);

    expect(api.grantIncludedClients).toHaveBeenCalledExactlyOnceWith(
      SPACE_IDS.atlas,
      7,
      '2026-11-01',
      '2027-02-01',
      'Brought Karim Haddad',
    );
    expect(csrf.refresh.mock.invocationCallOrder[0]).toBeLessThan(
      api.grantIncludedClients.mock.invocationCallOrder[0],
    );
    expect(closed).toEqual([true]);
  });

  it('keeps the entry with the server’s words when the server refuses', async () => {
    const { fixture, host, closed } = await render(PlatformClientGrant, inputs(), {
      grantIncludedClients: vi.fn(() =>
        throwError(() =>
          refusal(
            'space_not_founding',
            'Only a founding coaching space is granted extra included clients. Mark the space as founding first.',
          ),
        ),
      ),
    });

    fill(host, 'Clients', '7');
    fill(host, 'What it is for', 'Brought Karim Haddad');
    await settle(fixture);
    press(host, 'Grant clients');
    await settle(fixture);

    expect(announced(host)).toBe(
      'Only a founding coaching space is granted extra included clients. Mark the space as founding first.',
    );
    expect(field(host, 'Clients').value).toBe('7');
    expect(field(host, 'What it is for').value).toBe('Brought Karim Haddad');
    expect(closed).toEqual([]);
  });

  it('closes on Not now without granting, and tells the page once something is entered', async () => {
    const { fixture, host, api, closed, dirty } = await render(PlatformClientGrant, inputs());
    expect(dirty.at(-1)).toBe(false);

    press(host, '3 months');
    await settle(fixture);
    expect(dirty.at(-1), 'A last day other than the default is typed work.').toBe(true);

    press(host, 'One month');
    await settle(fixture);
    expect(dirty.at(-1)).toBe(false);

    fill(host, 'Clients', '4');
    await settle(fixture);
    expect(dirty.at(-1)).toBe(true);

    press(host, 'Not now');
    await settle(fixture);
    expect(closed).toEqual([false]);
    expect(api.grantIncludedClients).not.toHaveBeenCalled();
  });
});

describe('Platform billing sheets: publishing a price plan version', () => {
  const inputs = () => ({ current: plan() });

  const changes = (host: HTMLElement) =>
    Array.from(host.querySelectorAll('.changes li')).map((row) =>
      ['.what', '.from', '.to'].map((part) => textOf(row.querySelector(part))),
    );

  // The sheet's first paragraph: what a new version means for invoices, then for founding spaces.
  const INTRO =
    'Version 2 is in force. Invoices issued from now on use the new terms; invoices already issued keep theirs.';
  const KEPT = 'Founding spaces keep their version until their guarantee ends.';
  const NOT_HELD =
    'No guarantee months are published yet, so founding spaces are billed at the new version too.';
  const intro = (host: HTMLElement) => textOf(host.querySelector('form > .muted'));
  const founding = (host: HTMLElement) => host.querySelector('[data-plan-founding]');

  it('starts from the version in force and offers the next one only once a term changes', async () => {
    const { host } = await render(PlatformPlan, inputs());

    // Without the guarantee's months (the founding terms not read) it says nothing of founding spaces.
    expect(intro(host)).toBe(INTRO);
    expect(founding(host)).toBeNull();
    expect(field(host, 'Price per seat').value).toBe('15');
    expect(field(host, 'Clients included with each seat').value).toBe('5');
    expect(field(host, 'Free trial (days)').value).toBe('30');
    expect(field(host, 'Days after it is due before read-only').value).toBe('7');
    expect(textOf(field(host, 'Price per seat').parentElement?.querySelector('.unit'))).toBe('USD');
    expect(textOf(host.querySelector('.changes'))).toBe(
      'Nothing has changed yet. Change a price or a period to publish a new version.',
    );
    expect(button(host, 'Publish version 3').disabled).toBe(true);
  });

  // Notes plan N8: a new version does not reach a founding space while its guarantee runs, and the
  // guarantee is the months of the founding terms in force. The months are this test's own.
  it.each([
    ['5 months', 5],
    // No months after the last discount is still a guarantee, unlike none.
    ['0 months', 0],
  ])(
    'says founding spaces keep their version when the terms in force hold prices for %s',
    async (_, months) => {
      const { host } = await render(PlatformPlan, { ...inputs(), guaranteeMonths: months });

      expect(textOf(founding(host))).toBe(KEPT);
      expect(intro(host)).toBe(`${INTRO} ${KEPT}`);
    },
  );

  it('says founding spaces are billed at the new version too while no guarantee months are published', async () => {
    const { host } = await render(PlatformPlan, { ...inputs(), guaranteeMonths: null });

    expect(textOf(founding(host))).toBe(NOT_HELD);
    expect(intro(host)).toBe(`${INTRO} ${NOT_HELD}`);
    // The sentence that would be false here is nowhere in the sheet.
    expect(textOf(host)).not.toContain('keep their version');
  });

  it('follows the months as the page reads them: nothing, then held, then not held', async () => {
    const { fixture, host } = await render(PlatformPlan, inputs());
    expect(founding(host)).toBeNull();
    fill(host, 'Price per seat', '20');
    await settle(fixture);

    fixture.componentRef.setInput('guaranteeMonths', 7);
    await settle(fixture);
    expect(intro(host)).toBe(`${INTRO} ${KEPT}`);
    // Terms read while the sheet is open change its words, never what the admin typed.
    expect(field(host, 'Price per seat').value).toBe('20');
    expect(changes(host)).toEqual([['Price per seat', '$15.00', '$20.00']]);

    fixture.componentRef.setInput('guaranteeMonths', null);
    await settle(fixture);
    expect(intro(host)).toBe(`${INTRO} ${NOT_HELD}`);

    fixture.componentRef.setInput('guaranteeMonths', undefined);
    await settle(fixture);
    expect(intro(host)).toBe(INTRO);
    expect(founding(host)).toBeNull();
  });

  it('lists each changed term from the version in force to the new one, as it is typed', async () => {
    const { fixture, host } = await render(PlatformPlan, inputs());
    expect(query(host, '.changes').getAttribute('aria-live')).toBe('polite');

    fill(host, 'Price per seat', '20');
    await settle(fixture);
    expect(changes(host)).toEqual([['Price per seat', '$15.00', '$20.00']]);
    expect(button(host, 'Publish version 3').disabled).toBe(false);

    fill(host, 'Free trial (days)', '14');
    await settle(fixture);
    expect(changes(host)).toEqual([
      ['Price per seat', '$15.00', '$20.00'],
      ['Free trial (days)', '30', '14'],
    ]);

    fill(host, 'Price per seat', '15');
    await settle(fixture);
    expect(changes(host)).toEqual([['Free trial (days)', '30', '14']]);
  });

  it('leaves a term that is not valid yet out of the list, and marks it with focus once publishing is refused', async () => {
    const { fixture, host, api, closed } = await render(PlatformPlan, inputs());

    fill(host, 'Free trial (days)', '14');
    fill(host, 'Days to pay an invoice', '120');
    await settle(fixture);
    expect(changes(host)).toEqual([['Free trial (days)', '30', '14']]);

    press(host, 'Publish version 3');
    await settle(fixture);

    expect(api.publishPricePlan).not.toHaveBeenCalled();
    const term = field(host, 'Days to pay an invoice');
    expect(term.getAttribute('aria-invalid')).toBe('true');
    expect(description(term)).toBe('Enter a whole number from 0 to 90.');
    expect(field(host, 'Free trial (days)').getAttribute('aria-invalid')).toBeNull();
    expect(announced(host)).toBe('Check the fields marked above.');
    expect(document.activeElement).toBe(term);
    expect(closed).toEqual([]);
  });

  it('publishes the new terms against the version in force and hands back the version published', async () => {
    const { fixture, host, api, csrf, closed } = await render(PlatformPlan, inputs());

    fill(host, 'Price per seat', '20');
    fill(host, 'Note (optional)', '  Prices for 2027  ');
    await settle(fixture);
    press(host, 'Publish version 3');
    await settle(fixture);

    expect(api.publishPricePlan).toHaveBeenCalledExactlyOnceWith({
      seatPrice: 20,
      includedClientsPerSeat: 5,
      extraClientPrice: 2,
      gymFee: 10,
      gymFeeMinimumSeats: 2,
      trialDays: 30,
      paymentTermDays: 7,
      graceDays: 7,
      expectedCurrentVersion: 2,
      note: 'Prices for 2027',
    });
    expect(csrf.refresh.mock.invocationCallOrder[0]).toBeLessThan(
      api.publishPricePlan.mock.invocationCallOrder[0],
    );
    expect(closed).toEqual([PUBLISHED]);
  });

  it('keeps the entry with the server’s words when the server refuses', async () => {
    const { fixture, host, closed } = await render(PlatformPlan, inputs(), {
      publishPricePlan: vi.fn(() =>
        throwError(() =>
          refusal(
            'price_plan_changed',
            'A newer price plan was published since this page loaded. Refresh and try again.',
          ),
        ),
      ),
    });

    fill(host, 'Price per seat', '20');
    await settle(fixture);
    press(host, 'Publish version 3');
    await settle(fixture);

    expect(announced(host)).toBe(
      'A newer price plan was published since this page loaded. Refresh and try again.',
    );
    expect(field(host, 'Price per seat').value).toBe('20');
    expect(changes(host)).toEqual([['Price per seat', '$15.00', '$20.00']]);
    expect(closed).toEqual([]);
  });

  it('closes on Not now without publishing, and tells the page once anything differs', async () => {
    const { fixture, host, api, closed, dirty } = await render(PlatformPlan, inputs());
    expect(dirty.at(-1)).toBe(false);

    fill(host, 'Note (optional)', 'Draft');
    await settle(fixture);
    expect(dirty.at(-1)).toBe(true);

    fill(host, 'Note (optional)', '');
    await settle(fixture);
    expect(dirty.at(-1)).toBe(false);

    // A term typed wrong is typed work too.
    fill(host, 'Price per seat', '-4');
    await settle(fixture);
    expect(dirty.at(-1)).toBe(true);

    press(host, 'Not now');
    await settle(fixture);
    expect(closed).toEqual([false]);
    expect(api.publishPricePlan).not.toHaveBeenCalled();
  });
});

describe('Platform billing sheets: a fresh antiforgery token before every write', () => {
  /** Each sheet filled in as an admin would, and the write it sends. */
  const sheets: [
    string,
    Type<SheetOutputs>,
    () => Record<string, unknown>,
    'recordPayment' | 'voidInvoice' | 'grantDiscount' | 'grantIncludedClients' | 'publishPricePlan',
    (host: HTMLElement) => void,
    string,
  ][] = [
    [
      'a payment',
      PlatformPayment,
      () => ({ invoice: invoice(), spaceName: 'Atlas Performance', today: TODAY }),
      'recordPayment',
      (host) => fill(host, 'Whish or transfer reference', 'WHISH-1'),
      'Record payment',
    ],
    [
      'a void',
      PlatformVoid,
      () => ({ invoice: invoice(), spaceName: 'Atlas Performance' }),
      'voidInvoice',
      (host) => fill(host, 'Why is it void?', 'Wrong seat count'),
      'Void and reissue',
    ],
    [
      'a discount',
      PlatformDiscount,
      () => ({
        tenantId: SPACE_IDS.atlas,
        spaceName: 'Atlas Performance',
        today: TODAY,
        existing: [],
      }),
      'grantDiscount',
      (host) => {
        fill(host, 'Percent off', '10');
        fill(host, 'What it is for', 'Loyalty');
        press(host, '3 months');
      },
      'Grant discount',
    ],
    [
      'extra included clients',
      PlatformClientGrant,
      () => ({ tenantId: SPACE_IDS.atlas, spaceName: 'Atlas Performance', today: TODAY }),
      'grantIncludedClients',
      (host) => {
        fill(host, 'Clients', '7');
        fill(host, 'What it is for', 'Brought Karim Haddad');
      },
      'Grant clients',
    ],
    [
      'a price plan',
      PlatformPlan,
      () => ({ current: plan() }),
      'publishPricePlan',
      (host) => fill(host, 'Price per seat', '20'),
      'Publish version 3',
    ],
  ];

  it.each(sheets)(
    'sends %s only once the token has been refreshed',
    async (_, component, inputs, write, enter, submit) => {
      let release!: () => void;
      const token = new Promise<void>((resolve) => (release = resolve));
      const { fixture, host, api, closed } = await render(component, inputs(), {}, () => token);
      enter(host);
      await settle(fixture);

      press(host, submit);
      await settle(fixture);
      // A write that ran ahead of the token would go out with a stale one, and be refused.
      expect(api[write]).not.toHaveBeenCalled();

      release();
      await settle(fixture);
      expect(api[write]).toHaveBeenCalledTimes(1);
      expect(closed).toHaveLength(1);
    },
  );
});
