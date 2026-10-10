import { signal, Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../core/api/api-client';
import type { ProductCatalog, WorkspaceDetails } from '../core/api/api.models';
import { CsrfService } from '../core/security/csrf.service';
import { TenantContext } from '../core/tenancy/tenant-context';
import { TenantStore } from '../core/tenancy/tenant.store';
import { field, settle } from '../../testing/dom';
import { ClientTrainingTools } from './clients/client-training-tools';
import { ProgramAssign } from './clients/program-assign';
import { planCard } from './clients/client-service.models';
import { PlanPayment, PlanStart } from './clients/plan-sheets';
import { unpaidRenewal } from '../../testing/client-service-fixtures';

/**
 * 22:00 UTC on 20 September is 01:00 on the 21st in Asia/Beirut, so the browser's UTC calendar
 * reads the 20th while the workspace is already on the 21st. Training defaulted to the 20th and
 * commercial to the 21st: two sections of one page disagreeing about what day it is.
 */
const instant = new Date('2026-09-20T22:00:00Z');

/**
 * Asserted against two workspace dates. `2026-09-21` is the real Asia/Beirut repro. `2026-09-23`
 * is a date no browser anywhere can produce at that instant — every UTC offset puts the local
 * calendar on the 20th or the 21st — so it is what distinguishes "reads the workspace" from
 * "computes locally and happens to agree".
 */
const workspaceDates = ['2026-09-21', '2026-09-23'];

function workspaceOn(currentDate: string, id = 'workspace-a'): WorkspaceDetails {
  return {
    id,
    name: 'Beirut Strength & Conditioning',
    slug: 'beirut-strength',
    timeZoneId: 'Asia/Beirut',
    defaultCulture: 'en-LB',
    defaultCurrencyCode: 'USD',
    weekStartsOn: 'Monday',
    currentDate,
    version: 1,
    brandColor: null,
    accentColor: null,
    logoAssetId: null,
  };
}

const emptyPage = { items: [], total: 0 };

/** A plan with training that covers both workspace dates the cases use. */
const trainingPlan = {
  id: 'enrollment-1',
  productName: 'Online Coaching',
  offerLabel: '12 weeks',
  startDate: '2026-09-01',
  endDateExclusive: '2026-12-01',
  lastActiveDate: '2026-11-30',
  storedStatus: 'Active',
  effectiveStatus: 'Active',
  features: ['Training'],
};

// One active product with one active offer, so "Assign a service" renders its start-date control.
const catalog: ProductCatalog = {
  workspaceCurrencyCode: 'USD',
  products: [
    {
      id: 'product-1',
      name: 'Full Coaching',
      description: null,
      isActive: true,
      offers: [
        {
          id: 'offer-1',
          label: '8-week block',
          billingModel: 'FixedDuration',
          durationCount: 8,
          durationUnit: 'Week',
          priceAmount: 400,
          priceCurrency: 'USD',
          isActive: true,
          features: [],
          createdAtUtc: '2026-09-01T09:00:00Z',
          version: 1,
        },
      ],
      version: 1,
    },
  ],
};

interface Harness {
  host: HTMLElement;
  fixture: ComponentFixture<unknown>;
  getWorkspace: ReturnType<typeof vi.fn>;
  tenantId: ReturnType<typeof signal<string | null>>;
}

async function render(
  component: Type<unknown>,
  inputs: Record<string, unknown>,
  currentDate: string,
): Promise<Harness> {
  const getWorkspace = vi.fn(() => of(workspaceOn(currentDate)));
  const tenantId = signal<string | null>('workspace-a');
  await TestBed.configureTestingModule({
    imports: [component],
    providers: [
      provideRouter([]),
      {
        provide: ApiClient,
        useValue: {
          getWorkspace,
          getClientCommercialOverview: vi.fn(() => of({ enrollments: [], features: [] })),
          listProgramTemplates: vi.fn(() => of(emptyPage)),
          searchExercises: vi.fn(() => of(emptyPage)),
          listStrengthMaxes: vi.fn(() => of(emptyPage)),
          listClientMesocycles: vi.fn(() => of([])),
          listSavedSessions: vi.fn(() => of([])),
          getProductCatalog: vi.fn(() => of(catalog)),
        },
      },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      { provide: TenantStore, useValue: { selectedTenantId: tenantId } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(component);
  for (const [name, value] of Object.entries(inputs)) {
    fixture.componentRef.setInput(name, value);
  }

  await settle(fixture);
  return { host: fixture.nativeElement as HTMLElement, fixture, getWorkspace, tenantId };
}

describe('date defaults across a coach client page', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(instant);
  });

  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  for (const currentDate of workspaceDates) {
    describe(`with the workspace on ${currentDate}`, () => {
      it('defaults the program start date to the workspace date the page was given', async () => {
        const { host } = await render(
          ProgramAssign,
          {
            clientId: 'client-1',
            firstName: 'Rana',
            today: currentDate,
            enrollments: [trainingPlan],
          },
          currentDate,
        );

        expect(field(host, 'Start date').value).toBe(currentDate);
      });

      it('defaults the strength-max effective date to the workspace date', async () => {
        const { host } = await render(ClientTrainingTools, { clientId: 'client-1' }, currentDate);

        expect(field(host, 'Date').value).toBe(currentDate);
      });

      it('defaults a new plan’s first day to the workspace date the page was given', async () => {
        const { host } = await render(
          PlanStart,
          { clientId: 'client-1', firstName: 'Rana', today: currentDate, catalog, plans: [] },
          currentDate,
        );

        expect(field(host, 'First day').value).toBe(currentDate);
      });

      it('defaults a payment’s day and its upper bound to the workspace date', async () => {
        const plan = planCard(unpaidRenewal(), {
          locale: 'en-US',
          today: currentDate,
          firstName: 'Rana',
        });
        const { host } = await render(
          PlanPayment,
          { plan, firstName: 'Rana', today: currentDate },
          currentDate,
        );

        expect(field(host, 'Received on').value).toBe(currentDate);
        expect(field(host, 'Received on').max).toBe(currentDate);
      });
    });
  }

  it('re-derives the training max date after the active workspace changes', async () => {
    const { host, fixture, getWorkspace, tenantId } = await render(
      ClientTrainingTools,
      { clientId: 'client-1' },
      '2026-09-21',
    );

    // The second workspace keeps its own calendar. Resetting must re-read it, not fall back to
    // the browser and not keep the first workspace's answer.
    getWorkspace.mockReturnValue(of(workspaceOn('2026-09-23', 'workspace-b')));
    tenantId.set('workspace-b');
    TestBed.inject(TenantContext).invalidate();
    await settle(fixture);

    expect(field(host, 'Date').value).toBe('2026-09-23');
  });
});
