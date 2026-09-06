import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type { ClientInvitation } from '../../core/api/api.models';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { button, fill, press, query, settle } from '../../../testing/dom';
import { Invitations } from './invitations';

function invitation(overrides: Partial<ClientInvitation> = {}): ClientInvitation {
  return {
    id: 'invitation-1',
    email: 'rana@example.test',
    firstName: 'Rana',
    lastName: 'Haddad',
    status: 'Pending',
    expiresAtUtc: '2026-09-01T09:00:00Z',
    sendCount: 1,
    logicalSendGeneration: 1,
    createdAtUtc: '2026-08-25T09:00:00Z',
    version: 7,
    developmentActionUrl: null,
    ...overrides,
  };
}

async function render(api: Partial<ApiClient> = {}) {
  await TestBed.configureTestingModule({
    imports: [Invitations],
    providers: [
      provideRouter([]),
      {
        provide: ApiClient,
        useValue: {
          getInvitations: vi.fn(() => of([])),
          createInvitation: vi.fn(() => of(invitation())),
          resendInvitation: vi.fn(() =>
            of(invitation({ sendCount: 2, logicalSendGeneration: 2, version: 8 })),
          ),
          revokeInvitation: vi.fn(() => of(invitation({ status: 'Revoked' }))),
          ...api,
        },
      },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(Invitations);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api: TestBed.inject(ApiClient) };
}

describe('Invitations', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  /**
   * The coach side of the client's only door. The form is behind a disclosure button, so this
   * drives the whole path a coach takes: open it, fill it, send it, and see the invitation appear.
   */
  it('creates an invitation from the form the coach opens and fills', async () => {
    const { fixture, host, api } = await render();

    expect(host.querySelector('form')).toBeNull();
    press(host, 'Invite client');
    await settle(fixture);

    fill(host, 'First name', 'Rana');
    fill(host, 'Last name', 'Haddad');
    fill(host, 'Email', 'rana@example.test');
    fill(host, 'Phone number', '+96170123456');
    fill(host, 'Date of birth', '1996-04-02');
    await settle(fixture);

    expect(button(host, 'Send invitation').disabled).toBe(false);
    press(host, 'Send invitation');
    await settle(fixture);

    expect(api.createInvitation).toHaveBeenCalledWith({
      email: 'rana@example.test',
      firstName: 'Rana',
      lastName: 'Haddad',
      phoneNumber: '+96170123456',
      birthDate: '1996-04-02',
    });
    // The new invitation is on screen and the form has closed behind it.
    expect(host.textContent).toContain('Rana Haddad');
    expect(host.textContent).toContain('Invitation created and queued for delivery.');
    expect(host.querySelector('form')).toBeNull();
  });

  it('sends the optional fields as absent rather than as empty strings', async () => {
    const { fixture, host, api } = await render();

    press(host, 'Invite client');
    await settle(fixture);
    fill(host, 'First name', 'Rana');
    fill(host, 'Last name', 'Haddad');
    fill(host, 'Email', 'rana@example.test');
    await settle(fixture);
    press(host, 'Send invitation');
    await settle(fixture);

    expect(api.createInvitation).toHaveBeenCalledWith({
      email: 'rana@example.test',
      firstName: 'Rana',
      lastName: 'Haddad',
      phoneNumber: null,
      birthDate: null,
    });
  });

  it('does not send an invitation with no email address', async () => {
    const { fixture, host, api } = await render();

    press(host, 'Invite client');
    await settle(fixture);
    fill(host, 'First name', 'Rana');
    fill(host, 'Last name', 'Haddad');
    await settle(fixture);
    press(host, 'Send invitation');
    await settle(fixture);

    expect(api.createInvitation).not.toHaveBeenCalled();
  });

  /**
   * A deliberate resend is a different operation from the dispatcher's own transport retry: it kills
   * the previous link. So the screen sends an idempotency key, so a double click is one command
   * rather than two generations, and the version it last saw, so a press against a stale list
   * conflicts instead of silently revoking a link the coach did not know existed. It also says out
   * loud what pressing it did.
   */
  it('resends with an idempotency key and the version it last saw, and says the old link is dead', async () => {
    const { fixture, host, api } = await render({
      getInvitations: vi.fn(() => of([invitation()])),
    });

    expect(host.textContent).toContain('Sent 1 time(s)');
    press(host, 'Resend');
    await settle(fixture);

    expect(api.resendInvitation).toHaveBeenCalledTimes(1);
    const [invitationId, idempotencyKey, version] = vi.mocked(api.resendInvitation).mock.calls[0];
    expect(invitationId).toBe('invitation-1');
    expect(version).toBe(7);
    expect(idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(host.textContent).toContain('Sent 2 time(s)');
    expect(host.textContent).toContain('A new invitation link was sent.');
    expect(host.textContent).toContain('Any earlier link no longer works.');
  });

  it('sends a fresh idempotency key per press, so two presses are two commands', async () => {
    const { fixture, host, api } = await render({
      getInvitations: vi.fn(() => of([invitation()])),
    });

    press(host, 'Resend');
    await settle(fixture);
    press(host, 'Resend');
    await settle(fixture);

    const calls = vi.mocked(api.resendInvitation).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][1]).not.toBe(calls[1][1]);
  });

  it('revokes a pending invitation and withdraws the actions with it', async () => {
    const { fixture, host, api } = await render({
      getInvitations: vi.fn(() => of([invitation()])),
    });

    press(host, 'Revoke');
    await settle(fixture);

    expect(api.revokeInvitation).toHaveBeenCalledWith('invitation-1', 7);
    expect(host.textContent).toContain('Invitation revoked.');
    // A revoked invitation can no longer be resent, so neither control is still offered.
    expect(host.querySelector('.button-group')).toBeNull();
  });

  it('offers no resend or revoke for an invitation that was already accepted', async () => {
    const { host } = await render({
      getInvitations: vi.fn(() => of([invitation({ status: 'Accepted' })])),
    });

    expect(host.textContent).toContain('Rana Haddad');
    expect(host.querySelector('.button-group')).toBeNull();
  });

  it('reports the server’s refusal instead of listing an invitation that was never created', async () => {
    const duplicate = new HttpErrorResponse({
      status: 409,
      error: { title: 'That client already has a pending invitation.' },
    });
    const { fixture, host, api } = await render({
      createInvitation: vi.fn(() => throwError(() => duplicate)),
    });

    press(host, 'Invite client');
    await settle(fixture);
    fill(host, 'First name', 'Rana');
    fill(host, 'Last name', 'Haddad');
    fill(host, 'Email', 'rana@example.test');
    await settle(fixture);
    press(host, 'Send invitation');
    await settle(fixture);

    expect(api.createInvitation).toHaveBeenCalled();
    expect(query(host, '[role="alert"]').textContent).toContain(
      'That client already has a pending invitation.',
    );
    expect(host.textContent).toContain('No invitations yet');
    // The filled form is still open to correct rather than discarded.
    expect(host.querySelector('form')).not.toBeNull();
  });

  it('reports a failed load instead of claiming there are no invitations', async () => {
    const { host } = await render({
      getInvitations: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 500 }))),
    });

    expect(query(host, '[role="alert"]').textContent).toContain('Invitations could not be loaded.');
  });
});
