import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { installDialogSupport } from '../../../testing/dialog';
import { fill, press, settle } from '../../../testing/dom';
import { LeaveWorkspace } from './leave-workspace';
import { LeaveWorkspaceApi } from './leave-workspace-api';

let uninstallDialog: () => void = () => undefined;

async function render(
  role: 'Owner' | 'Coach' | 'Client',
  leaveApi: Partial<LeaveWorkspaceApi> = {},
) {
  const load = vi.fn(() => Promise.resolve());
  const api = {
    resignFromTeam: vi.fn(() => of(undefined)),
    leaveAsClient: vi.fn(() => of(undefined)),
    ...leaveApi,
  };
  await TestBed.configureTestingModule({
    imports: [LeaveWorkspace],
    providers: [
      provideRouter([]),
      { provide: LeaveWorkspaceApi, useValue: api },
      {
        provide: ApiClient,
        useValue: { getSelfProfile: vi.fn(() => of({ id: 'client-1', version: 4 })) },
      },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      {
        provide: TenantStore,
        useValue: {
          selectedMembership: signal({ tenantId: 'tenant-1', tenantName: 'Cedar Gym', role }),
          load,
        },
      },
    ],
  }).compileComponents();

  const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  const fixture = TestBed.createComponent(LeaveWorkspace);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api, load, navigate };
}

describe('LeaveWorkspace', () => {
  beforeEach(() => {
    uninstallDialog = installDialogSupport();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    uninstallDialog();
  });

  it('offers nothing to the owner, since a workspace always has one', async () => {
    const { host } = await render('Owner');

    expect(host.querySelector('section')).toBeNull();
    expect(host.querySelectorAll('button')).toHaveLength(0);
  });

  it('lets a coach resign, then reloads the workspaces and goes home', async () => {
    const { fixture, host, api, load, navigate } = await render('Coach');

    expect(host.textContent).toContain('Leave Cedar Gym');
    press(host, 'Leave workspace');
    await settle(fixture);
    expect(host.textContent).toContain('each client is told their coach has changed');
    expect(host.querySelector('textarea')).toBeNull();
    press(host, 'Leave permanently');
    await settle(fixture);

    expect(api.resignFromTeam).toHaveBeenCalledTimes(1);
    expect(api.leaveAsClient).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('lets a client leave with an optional reason and their current profile version', async () => {
    const { fixture, host, api } = await render('Client');

    press(host, 'Leave workspace');
    await settle(fixture);
    expect(host.textContent).toContain('including your history there');
    fill(host, 'Reason (optional)', '  Moving abroad  ');
    press(host, 'Leave permanently');
    await settle(fixture);

    expect(api.leaveAsClient).toHaveBeenCalledWith('Moving abroad', 4);
    expect(api.resignFromTeam).not.toHaveBeenCalled();
  });

  it('sends no reason when the client gives none', async () => {
    const { fixture, host, api } = await render('Client');

    press(host, 'Leave workspace');
    await settle(fixture);
    press(host, 'Leave permanently');
    await settle(fixture);

    expect(api.leaveAsClient).toHaveBeenCalledWith(null, 4);
  });

  it('keeps the dialog open and explains a refusal', async () => {
    const refusal = new HttpErrorResponse({
      status: 409,
      error: { code: 'concurrency_conflict', message: 'Changed.' },
    });
    const { fixture, host, load } = await render('Client', {
      leaveAsClient: vi.fn(() => throwError(() => refusal)),
    });

    press(host, 'Leave workspace');
    await settle(fixture);
    press(host, 'Leave permanently');
    await settle(fixture);

    expect(host.querySelector('dialog')?.open).toBe(true);
    expect(host.querySelector('[role="alert"]')?.textContent?.trim()).not.toBe('');
    expect(load).not.toHaveBeenCalled();
  });
});
