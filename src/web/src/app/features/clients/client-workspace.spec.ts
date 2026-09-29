import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type { ClientEnrollment, CoachClientDetails } from '../../core/api/api.models';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { press, settle } from '../../../testing/dom';
import { ConversationLaunch } from '../messaging/conversation-launch';
import { ClientWorkspace } from './client-workspace';

@Component({ selector: 'app-section-stub', template: 'section' })
class SectionStub {}

const PROFILE = {
  id: 'client-1',
  firstName: 'Maya',
  lastName: 'Rahman',
  email: 'maya@example.test',
  onboardingStatus: 'Completed',
  coachNotes: null,
  version: 3,
  release: null,
} as unknown as CoachClientDetails;

function plan(overrides: Partial<ClientEnrollment> = {}): ClientEnrollment {
  return {
    id: 'enrollment-1',
    renewedFromEnrollmentId: null,
    productName: 'Strength & Body Composition',
    startDate: '2026-07-21',
    endDateExclusive: '2026-11-15',
    lastActiveDate: '2026-11-14',
    effectiveStatus: 'Active',
    features: ['Training'],
    ...overrides,
  } as ClientEnrollment;
}

async function render(
  options: {
    profile?: CoachClientDetails;
    enrollments?: ClientEnrollment[];
    api?: Record<string, unknown>;
  } = {},
) {
  const api = {
    getClient: vi.fn(() => of(options.profile ?? PROFILE)),
    getClientCommercialOverview: vi.fn(() =>
      of({
        clientProfileId: 'client-1',
        isRelationshipBlocked: false,
        featureAccess: [],
        enrollments: options.enrollments ?? [plan()],
      }),
    ),
    getWorkspace: vi.fn(() =>
      of({ timeZoneId: 'Asia/Beirut', weekStartsOn: 'Monday', currentDate: '2026-09-20' }),
    ),
    ...options.api,
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        {
          path: 'clients/:clientId',
          component: ClientWorkspace,
          children: [
            { path: '', component: SectionStub },
            { path: 'training', component: SectionStub },
          ],
        },
        { path: 'messages', component: SectionStub },
      ]),
      { provide: ApiClient, useValue: api },
      { provide: CsrfService, useValue: { refresh: vi.fn().mockResolvedValue(undefined) } },
      {
        provide: TenantStore,
        useValue: { selectedTenantId: signal('tenant-1'), isOwner: signal(true) },
      },
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl('/clients/client-1');
  await settle(harness.fixture);
  return { harness, host: harness.routeNativeElement as HTMLElement, api };
}

function sectionNames(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll('app-section-nav a')).map(
    (anchor) => anchor.textContent?.trim() ?? '',
  );
}

describe('ClientWorkspace', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('heads the record with the client, their plan dates, and the sections', async () => {
    const { host } = await render();

    expect(host.querySelector('h1')?.textContent?.trim()).toBe('Maya Rahman');
    expect(host.querySelector('app-avatar')?.textContent?.trim()).toBe('MR');
    const text = host.textContent ?? '';
    expect(text).toContain('Active plan');
    expect(text).toContain('Strength & Body Composition');
    expect(text).toContain('Plan 21 Jul – 14 Nov 2026');
    expect(sectionNames(host)).toEqual([
      'Overview',
      'Training',
      'Nutrition',
      'Check-ins',
      'Progress',
      'Service & access',
    ]);
    // Each section is a link to its own route, and the open one is marked as the current page.
    const overview = host.querySelector('app-section-nav a');
    expect(overview?.getAttribute('href')).toBe('/clients/client-1');
    expect(overview?.getAttribute('aria-current')).toBe('page');
    expect(host.querySelector('a[href="/clients/client-1/intake"]')?.textContent?.trim()).toBe(
      'Edit intake',
    );
  });

  it('warns in the header when the plan ends within 14 days', async () => {
    const { host } = await render({
      enrollments: [plan({ lastActiveDate: '2026-09-29', endDateExclusive: '2026-09-30' })],
    });

    expect(host.textContent).toContain('Plan ends in 9 days');
  });

  it('offers only the kept sections for a former client, and no message action', async () => {
    const { host } = await render({
      profile: {
        ...PROFILE,
        release: {
          releasedAtUtc: '2026-09-20T10:00:00Z',
          reason: 'Moved',
          releasedByName: 'Olivia Owner',
          departureKind: 'ReleasedByOwner',
        },
      } as CoachClientDetails,
    });

    expect(host.textContent).toContain('Former client');
    expect(sectionNames(host)).toEqual(['Overview', 'Progress', 'Service & access']);
    expect(host.textContent).not.toContain('Message Maya');
    expect(host.textContent).toContain('View intake');
  });

  it('opens a direct conversation and reuses its command key after a failed attempt', async () => {
    const conversation = { id: 'conversation-1', clientProfileId: 'client-1' };
    const create = vi
      .fn()
      .mockReturnValueOnce(throwError(() => new Error('offline')))
      .mockReturnValueOnce(of({ conversation }));
    const { harness, host } = await render({ api: { createDirectConversation: create } });

    press(host, 'Message Maya');
    await settle(harness.fixture);
    expect(host.textContent).toContain('Couldn’t open this conversation');

    press(host, 'Message Maya');
    await settle(harness.fixture);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1]).toEqual(create.mock.calls[0]);
    expect(create.mock.calls[0][0]).toBe('client-1');
    expect(TestBed.inject(Router).url).toBe('/messages');
    expect(TestBed.inject(ConversationLaunch).take('tenant-1')).toEqual(conversation);
  });

  it('keeps the header when plans or the calendar cannot be read, and retries a failed record', async () => {
    const getClient = vi
      .fn()
      .mockReturnValueOnce(throwError(() => new Error('offline')))
      .mockReturnValueOnce(of(PROFILE));
    const { harness, host } = await render({
      api: {
        getClient,
        getClientCommercialOverview: vi.fn(() => throwError(() => new Error('refused'))),
      },
    });

    expect(host.textContent).toContain('The client profile could not be loaded.');
    press(host, 'Retry');
    await settle(harness.fixture);
    expect(host.querySelector('h1')?.textContent?.trim()).toBe('Maya Rahman');
    expect(host.querySelector('app-section-stub')).not.toBeNull();
    // Without plans the header says nothing about a plan rather than guessing one.
    expect(host.textContent).not.toContain('Active plan');
  });
});
