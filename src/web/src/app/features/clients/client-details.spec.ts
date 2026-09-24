import { DatePipe } from '@angular/common';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
  Router,
  RouterLink,
} from '@angular/router';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { ConversationLaunch } from '../messaging/conversation-launch';
import { press, settle } from '../../../testing/dom';
import { StatusLabel } from '../../ui/status-label';
import { ClientDetails } from './client-details';

describe('ClientDetails messaging entry', () => {
  afterEach(() => TestBed.resetTestingModule());
  it('opens a direct conversation and reuses its command key after a failed attempt', async () => {
    const conversation = { id: 'conversation-1', clientProfileId: 'client-1' };
    const create = vi
      .fn()
      .mockReturnValueOnce(throwError(() => new Error('offline')))
      .mockReturnValueOnce(of({ conversation }));
    await TestBed.configureTestingModule({
      imports: [ClientDetails],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ clientId: 'client-1' }) } },
        },
        {
          provide: TenantStore,
          useValue: { selectedTenantId: signal('tenant-1'), isOwner: signal(false) },
        },
        { provide: CsrfService, useValue: { refresh: vi.fn().mockResolvedValue(undefined) } },
        {
          provide: ApiClient,
          useValue: {
            createDirectConversation: create,
            getClient: vi.fn(() =>
              of({
                id: 'client-1',
                firstName: 'Maya',
                lastName: 'Khoury',
                email: 'maya@example.test',
                onboardingStatus: 'Completed',
                coachNotes: null,
                version: 1,
              }),
            ),
          },
        },
      ],
    })
      .overrideComponent(ClientDetails, {
        set: { imports: [DatePipe, ReactiveFormsModule, RouterLink], schemas: [NO_ERRORS_SCHEMA] },
      })
      .compileComponents();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(ClientDetails);
    await settle(fixture);
    const host = fixture.nativeElement as HTMLElement;
    press(host, 'Message Maya');
    await settle(fixture);
    expect(host.textContent).toContain('Couldn’t open this conversation');
    press(host, 'Message Maya');
    await settle(fixture);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1]).toEqual(create.mock.calls[0]);
    expect(create.mock.calls[0][0]).toBe('client-1');
    expect(navigate).toHaveBeenCalledWith('/messages');
    expect(TestBed.inject(ConversationLaunch).take('tenant-1')).toEqual(conversation);
  });
});

/** ADR 0027: a former client's page is their kept record, and nothing on it can be changed. */
describe('ClientDetails for a former client', () => {
  afterEach(() => TestBed.resetTestingModule());

  async function render(profile: Record<string, unknown>, isOwner = true) {
    await TestBed.configureTestingModule({
      imports: [ClientDetails],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ clientId: 'client-1' }) } },
        },
        {
          provide: TenantStore,
          useValue: { selectedTenantId: signal('tenant-1'), isOwner: signal(isOwner) },
        },
        { provide: CsrfService, useValue: { refresh: vi.fn().mockResolvedValue(undefined) } },
        {
          provide: ApiClient,
          useValue: {
            getClient: vi.fn(() =>
              of({
                id: 'client-1',
                firstName: 'Maya',
                lastName: 'Khoury',
                email: 'maya@example.test',
                onboardingStatus: 'Completed',
                coachNotes: 'Kept',
                version: 3,
                release: null,
                ...profile,
              }),
            ),
          },
        },
      ],
    })
      .overrideComponent(ClientDetails, {
        set: {
          imports: [DatePipe, ReactiveFormsModule, RouterLink, StatusLabel],
          schemas: [NO_ERRORS_SCHEMA],
        },
      })
      .compileComponents();
    const fixture = TestBed.createComponent(ClientDetails);
    await settle(fixture);
    return fixture.nativeElement as HTMLElement;
  }

  it('shows when, why and by whom the client was released, and nothing that changes them', async () => {
    const host = await render({
      release: {
        releasedAtUtc: '2026-09-20T10:00:00Z',
        reason: 'Followed her coach',
        releasedByName: 'Olivia Owner',
      },
    });

    expect(host.textContent).toContain('Former client');
    expect(host.textContent).toContain('Released on Sep 20, 2026 by Olivia Owner');
    expect(host.textContent).toContain('Followed her coach');
    expect(host.textContent).not.toContain('Message Maya');
    expect(host.querySelector('app-client-release')).toBeNull();
    expect(host.querySelector('app-client-coach')).toBeNull();
    expect(host.querySelector('app-client-training')).toBeNull();
    expect(host.querySelector('app-client-nutrition')).toBeNull();
    expect(host.querySelector('app-client-commercial')).not.toBeNull();
    expect(host.querySelector<HTMLFieldSetElement>('fieldset.record-fields')?.disabled).toBe(true);
  });

  it('offers the release action to the owner of a current client only', async () => {
    const ownerView = await render({});
    expect(ownerView.querySelector('app-client-release')).not.toBeNull();
    expect(ownerView.querySelector<HTMLFieldSetElement>('fieldset.record-fields')?.disabled).toBe(
      false,
    );

    TestBed.resetTestingModule();
    const coachView = await render({}, false);
    expect(coachView.querySelector('app-client-release')).toBeNull();
  });
});
