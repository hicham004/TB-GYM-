import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type { WorkspaceDetails } from '../../core/api/api.models';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { button, field, fill, press, query, settle } from '../../../testing/dom';
import { WorkspaceSettings } from './workspace-settings';

function workspace(overrides: Partial<WorkspaceDetails> = {}): WorkspaceDetails {
  return {
    id: 'tenant-1',
    name: 'TB Gym',
    slug: 'tb-gym',
    timeZoneId: 'Asia/Beirut',
    defaultCulture: 'en-LB',
    defaultCurrencyCode: 'USD',
    weekStartsOn: 'Monday',
    currentDate: '2026-08-22',
    version: 5,
    ...overrides,
  };
}

async function render(api: Partial<ApiClient> = {}) {
  await TestBed.configureTestingModule({
    imports: [WorkspaceSettings],
    providers: [
      {
        provide: ApiClient,
        useValue: {
          getWorkspace: vi.fn(() => of(workspace())),
          updateWorkspace: vi.fn(() => of(workspace({ version: 6 }))),
          ...api,
        },
      },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      {
        provide: TenantStore,
        useValue: { selectedTenantId: signal('tenant-1'), load: vi.fn(() => Promise.resolve()) },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(WorkspaceSettings);
  await settle(fixture);
  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    api: TestBed.inject(ApiClient),
    tenants: TestBed.inject(TenantStore),
  };
}

describe('WorkspaceSettings', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('opens on the workspace as it is stored', async () => {
    const { host } = await render();

    expect(field(host, 'Workspace name').value).toBe('TB Gym');
    expect(field(host, 'Time zone').value).toBe('Asia/Beirut');
    expect(field(host, 'Default currency').value).toBe('USD');
    expect(field<HTMLSelectElement>(host, 'Week starts on').value).toBe('Monday');
  });

  /**
   * These settings decide the tenant time zone, week boundary and currency that every dated
   * calculation downstream reads. A control that never reaches the model would keep the workspace
   * on defaults the owner believes they changed.
   */
  it('saves every changed setting with the version it was loaded at', async () => {
    const { fixture, host, api, tenants } = await render();

    fill(host, 'Workspace name', 'TB Strength');
    fill(host, 'Time zone', 'Europe/Paris');
    fill(host, 'Default language and region', 'ar-LB');
    fill(host, 'Default currency', 'eur');
    fill(host, 'Week starts on', 'Sunday');
    await settle(fixture);

    expect(button(host, 'Save settings').disabled).toBe(false);
    press(host, 'Save settings');
    await settle(fixture);

    expect(api.updateWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'TB Strength',
        timeZoneId: 'Europe/Paris',
        defaultCulture: 'ar-LB',
        // Normalised to the ISO code, as elsewhere in the app.
        defaultCurrencyCode: 'EUR',
        weekStartsOn: 'Sunday',
        // The version it was loaded at, so a concurrent edit conflicts rather than being lost.
        version: 5,
      }),
    );
    // The workspace name is shown in the shell, so the membership list is refreshed with it.
    expect(tenants.load).toHaveBeenCalledWith('tenant-1');
    expect(host.textContent).toContain('Workspace settings saved.');
  });

  it('does not save a workspace with no name', async () => {
    const { fixture, host, api } = await render();

    fill(host, 'Workspace name', '');
    await settle(fixture);
    press(host, 'Save settings');
    await settle(fixture);

    expect(api.updateWorkspace).not.toHaveBeenCalled();
  });

  /** The identifier is what existing links resolve through, so it is shown but never edited. */
  it('shows the workspace identifier without offering to change it', async () => {
    const { host } = await render();

    const slug = field(host, 'Workspace identifier');
    expect(slug.value).toBe('tb-gym');
    expect(slug.hasAttribute('readonly')).toBe(true);
    expect(slug.disabled).toBe(true);
  });

  it('reports a rejected save instead of claiming the settings were stored', async () => {
    const conflict = new HttpErrorResponse({
      status: 409,
      error: { title: 'The workspace was changed by someone else.' },
    });
    const { fixture, host } = await render({
      updateWorkspace: vi.fn(() => throwError(() => conflict)),
    });

    fill(host, 'Workspace name', 'TB Strength');
    await settle(fixture);
    press(host, 'Save settings');
    await settle(fixture);

    expect(query(host, '[role="alert"]').textContent).toContain(
      'The workspace was changed by someone else.',
    );
    expect(host.textContent).not.toContain('Workspace settings saved.');
  });

  it('reports a failed load rather than offering an empty form to save', async () => {
    const { host, api } = await render({
      getWorkspace: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 500 }))),
    });

    expect(query(host, '[role="alert"]').textContent).toContain(
      'Workspace settings could not be loaded.',
    );
    expect(api.updateWorkspace).not.toHaveBeenCalled();
  });

  /** Nothing was loaded, so there is no version to save against and no save may be attempted. */
  it('refuses to save when no workspace was ever loaded', async () => {
    const { fixture, host, api } = await render({
      getWorkspace: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 500 }))),
    });

    fill(host, 'Workspace name', 'TB Strength');
    await settle(fixture);
    press(host, 'Save settings');
    await settle(fixture);

    expect(api.updateWorkspace).not.toHaveBeenCalled();
  });
});
