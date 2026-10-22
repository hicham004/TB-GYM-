import { signal } from '@angular/core';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import { CsrfService } from '../../core/security/csrf.service';
import {
  catalog,
  enrollment,
  SERVICE_TODAY,
  unpaidRenewal,
} from '../../../testing/client-service-fixtures';
import {
  chooseDay,
  chooseOption,
  chosenDay,
  field,
  fill,
  formSummary,
  press,
  settle,
} from '../../../testing/dom';
import { planCard } from './client-service.models';
import { PlanPayment, PlanStart } from './plan-sheets';

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

function pick(host: HTMLElement, offerId: string): void {
  const radio = host.querySelector<HTMLInputElement>(`input[type="radio"][value="${offerId}"]`)!;
  radio.checked = true;
  radio.dispatchEvent(new Event('change'));
}

async function renderStart(
  inputs: Record<string, unknown> = {},
  api: Record<string, unknown> = {},
) {
  const calls = {
    assignProduct: vi.fn(() => of(enrollment({ id: 'e-new' }))),
    renewEnrollment: vi.fn(() => of(enrollment({ id: 'e-renewed' }))),
    ...api,
  };
  TestBed.configureTestingModule({
    imports: [PlanStart],
    providers: [
      provideRouter([]),
      { provide: ApiClient, useValue: calls },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
      { provide: CsrfService, useValue: { refresh: vi.fn().mockResolvedValue(undefined) } },
    ],
  });
  const fixture = TestBed.createComponent(PlanStart);
  const values: Record<string, unknown> = {
    clientId: 'client-1',
    firstName: 'Maya',
    today: SERVICE_TODAY,
    catalog: catalog(),
    plans: [enrollment()],
    ...inputs,
  };
  for (const [name, value] of Object.entries(values)) fixture.componentRef.setInput(name, value);
  const closed = vi.fn();
  fixture.componentInstance.closed.subscribe(closed);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api: calls, closed };
}

describe('Start a plan', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('offers every price option on sale, and starts the one picked with a retry-safe key', async () => {
    const { fixture, host, api, closed } = await renderStart();

    expect(Array.from(host.querySelectorAll('.choice-label')).map(textOf)).toEqual([
      'Online Coaching · 12 weeks',
      'Online Coaching · 4 weeks',
      'Recipe Pack · 30 days',
    ]);
    pick(host, 'o-recipes');
    await settle(fixture);
    expect(textOf(host.querySelector('.run'))).toBe('Runs Thu 1 Oct – Fri 30 Oct');
    expect(textOf(host)).toContain('It is free, so Maya can use it from its first day.');

    press(host, 'Start plan');
    await settle(fixture);

    expect(api.assignProduct).toHaveBeenCalledWith('client-1', {
      offerId: 'o-recipes',
      startDate: SERVICE_TODAY,
      idempotencyKey: expect.any(String),
    });
    expect(closed).toHaveBeenCalledWith(expect.objectContaining({ id: 'e-new' }));
  });

  it('warns before the server would refuse a clash with a running plan, and says from when it fits', async () => {
    const { fixture, host } = await renderStart();

    pick(host, 'o-4');
    await settle(fixture);
    expect(textOf(host.querySelector('[role="status"]'))).toBe(
      'Maya already has Online Coaching from Tue 21 Jul 2026 to Mon 12 Oct 2026. Start on Tue 13 Oct 2026 or later.',
    );
    expect(textOf(host)).toContain('Maya can use it once USD 120 is paid.');

    await chooseDay(fixture, host, 'First day', '2026-10-13');
    expect(host.querySelector('[role="status"]')).toBeNull();
  });

  it('asks for a price option before starting anything', async () => {
    const { fixture, host, api } = await renderStart();

    press(host, 'Start plan');
    await settle(fixture);

    expect(textOf(host)).toContain('Choose a price option.');
    expect(textOf(formSummary(host))).toBe('Check the fields marked above.');
    // The first thing to fix takes focus, as on Assign program.
    expect(document.activeElement).toBe(host.querySelector('input[value="o-12"]'));
    expect(api.assignProduct).not.toHaveBeenCalled();
  });

  it('sends the coach to Products when there is nothing to sell', async () => {
    const { host } = await renderStart({ catalog: { workspaceCurrencyCode: 'USD', products: [] } });

    expect(textOf(host)).toContain('You have nothing to sell yet.');
    expect(host.querySelector('a')?.getAttribute('href')).toBe('/products');
    expect(Array.from(host.querySelectorAll('button')).map(textOf)).toEqual(['Not now']);
  });

  it('renews on the plan’s own price option, from the day after it ends', async () => {
    const { fixture, host, api, closed } = await renderStart({ renewFrom: enrollment() });

    expect(textOf(host.querySelector('.plan-line span[dir]'))).toBe(
      'Online Coaching · 12 weeks, until Mon 12 Oct',
    );
    // Only the same plan's options; the recipe pack is another plan.
    expect(Array.from(host.querySelectorAll('.choice-label')).map(textOf)).toEqual([
      'Online Coaching · 12 weeks',
      'Online Coaching · 4 weeks',
    ]);
    expect(host.querySelector<HTMLInputElement>('input[value="o-12"]')!.checked).toBe(true);
    expect(await chosenDay(fixture, host, 'First day')).toBe('2026-10-13');
    expect(textOf(host.querySelector('.run'))).toBe('Runs Tue 13 Oct 2026 – Mon 4 Jan 2027');

    press(host, 'Renew plan');
    await settle(fixture);

    expect(api.renewEnrollment).toHaveBeenCalledWith('e-1', {
      offerId: 'o-12',
      startDate: '2026-10-13',
      idempotencyKey: expect.any(String),
    });
    expect(closed).toHaveBeenCalledWith(expect.objectContaining({ id: 'e-renewed' }));
  });

  it('keeps a refusal on screen in coach words, and retries with the same key', async () => {
    const refusal = new HttpErrorResponse({
      status: 409,
      error: {
        code: 'entitlement_overlap',
        message:
          'Maya already has Online Coaching from Tue 21 Jul 2026 to Mon 12 Oct 2026. Choose dates after it ends.',
      },
    });
    const assignProduct = vi
      .fn()
      .mockReturnValueOnce(throwError(() => refusal))
      .mockReturnValueOnce(of(enrollment({ id: 'e-new' })));
    const { fixture, host, closed } = await renderStart({}, { assignProduct });

    pick(host, 'o-12');
    press(host, 'Start plan');
    await settle(fixture);

    expect(textOf(formSummary(host))).toBe(
      'Maya already has Online Coaching from Tue 21 Jul 2026 to Mon 12 Oct 2026. Choose dates after it ends.',
    );
    expect(document.activeElement).toBe(formSummary(host));
    expect(closed).not.toHaveBeenCalled();

    press(host, 'Start plan');
    await settle(fixture);
    const [first, second] = assignProduct.mock.calls.map((call) => call[1].idempotencyKey);
    expect(second).toBe(first);
  });
});

// ------------------------------------------------------------------------------------------------

async function renderPayment(api: Record<string, unknown> = {}) {
  const calls = { recordManualPayment: vi.fn(() => of(unpaidRenewal())), ...api };
  TestBed.configureTestingModule({
    imports: [PlanPayment],
    providers: [
      { provide: ApiClient, useValue: calls },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
      { provide: CsrfService, useValue: { refresh: vi.fn().mockResolvedValue(undefined) } },
    ],
  });
  const fixture = TestBed.createComponent(PlanPayment);
  const plan = planCard(unpaidRenewal(), {
    locale: 'en-US',
    today: SERVICE_TODAY,
    firstName: 'Maya',
  });
  fixture.componentRef.setInput('plan', plan);
  fixture.componentRef.setInput('firstName', 'Maya');
  fixture.componentRef.setInput('today', SERVICE_TODAY);
  const closed = vi.fn();
  fixture.componentInstance.closed.subscribe(closed);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api: calls, closed };
}

describe('Record payment', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('does not record a payment after destruction during CSRF refresh', async () => {
    const { fixture, host, api, closed } = await renderPayment();
    let resolve!: () => void;
    vi.mocked(TestBed.inject(CsrfService).refresh).mockReturnValue(
      new Promise<void>((done) => {
        resolve = done;
      }),
    );
    press(host, 'Record payment');
    await settle(fixture);
    fixture.destroy();
    resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(api.recordManualPayment).not.toHaveBeenCalled();
    expect(closed).not.toHaveBeenCalled();
  });

  it('starts at what is left and records it in the plan’s currency', async () => {
    const { fixture, host, api, closed } = await renderPayment();

    expect(field(host, 'Amount received').value).toBe('180');
    expect(textOf(host)).toContain('USD 180 left to pay. Part payments are fine.');
    expect(textOf(host)).toContain('This pays the plan in full. Maya gets access from Tue 13 Oct.');
    await chooseOption(fixture, host, 'How it was paid', 'Mobile wallet');
    fill(host, 'Reference (optional)', ' WH-2290 ');
    press(host, 'Record payment');
    await settle(fixture);

    // The day as typed: the server stamps the instant in the workspace's zone (WEA-6).
    expect(api.recordManualPayment).toHaveBeenCalledWith('e-2', {
      amount: 180,
      currencyCode: 'USD',
      receivedOn: SERVICE_TODAY,
      method: 'MobileWallet',
      reference: 'WH-2290',
      note: null,
      idempotencyKey: expect.any(String),
    });
    expect(closed).toHaveBeenCalledWith(true);
  });

  it('sends an earlier day as the day, never an instant built from the browser’s clock', async () => {
    const { fixture, host, api } = await renderPayment();

    await chooseDay(fixture, host, 'Received on', '2026-09-28');
    press(host, 'Record payment');
    await settle(fixture);

    expect(api.recordManualPayment).toHaveBeenCalledWith(
      'e-2',
      expect.objectContaining({ receivedOn: '2026-09-28' }),
    );
    expect(JSON.stringify(vi.mocked(api.recordManualPayment).mock.calls)).not.toContain(
      'receivedAtUtc',
    );
  });

  it('takes a part payment and says what will still be left', async () => {
    const { fixture, host } = await renderPayment();

    fill(host, 'Amount received', '100');
    await settle(fixture);

    expect(textOf(host)).toContain(
      'USD 80 will still be left. Maya gets access once the full price is paid.',
    );
  });

  it('does not record nothing, or more than is left', async () => {
    const { fixture, host, api } = await renderPayment();

    fill(host, 'Amount received', '');
    press(host, 'Record payment');
    await settle(fixture);
    expect(textOf(host)).toContain('Enter the amount received.');

    fill(host, 'Amount received', '200');
    await settle(fixture);
    expect(textOf(host)).toContain('That is more than is left to pay.');
    expect(api.recordManualPayment).not.toHaveBeenCalled();
  });

  it('reports a refused payment instead of claiming it was recorded, and a retry sends the same payment', async () => {
    const refusal = new HttpErrorResponse({
      status: 400,
      error: {
        errors: { amount: ['The payment cannot exceed the outstanding enrollment balance.'] },
      },
    });
    const recordManualPayment = vi
      .fn()
      .mockReturnValueOnce(throwError(() => refusal))
      .mockReturnValueOnce(of(unpaidRenewal()));
    const { fixture, host, closed } = await renderPayment({ recordManualPayment });

    press(host, 'Record payment');
    await settle(fixture);
    expect(textOf(formSummary(host))).toBe('That is more than is left to pay.');
    expect(document.activeElement).toBe(formSummary(host));
    expect(closed).not.toHaveBeenCalled();

    press(host, 'Record payment');
    await settle(fixture);
    const [first, second] = recordManualPayment.mock.calls.map((call) => call[1]);
    // The same entry is the same payment: same key and same day, as the server requires.
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(second.receivedOn).toBe(first.receivedOn);
    expect(closed).toHaveBeenCalledWith(true);
  });
});
