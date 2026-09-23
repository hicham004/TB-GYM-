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
        set: { imports: [ReactiveFormsModule, RouterLink], schemas: [NO_ERRORS_SCHEMA] },
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
