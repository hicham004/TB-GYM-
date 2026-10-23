import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type { WorkspaceDetails } from '../../core/api/api.models';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { UiToast } from '../../ui/toast';
import {
  announced,
  button,
  field,
  fill,
  focusedId,
  formSummary,
  press,
  settle,
  tick,
} from '../../../testing/dom';
import { WorkspaceSettings } from './workspace-settings';

function workspace(overrides: Partial<WorkspaceDetails> = {}): WorkspaceDetails {
  return {
    id: 'tenant-1',
    name: 'Atlas Performance',
    slug: 'atlas-performance',
    timeZoneId: 'Asia/Beirut',
    defaultCulture: 'ar-LB',
    defaultCurrencyCode: 'USD',
    weekStartsOn: 'Monday',
    currentDate: '2026-10-09',
    version: 5,
    brandColor: null,
    accentColor: null,
    logoAssetId: null,
    ...overrides,
  } as WorkspaceDetails;
}

async function render(api: Partial<Record<keyof ApiClient, unknown>> = {}) {
  const toast = { show: vi.fn() };
  await TestBed.configureTestingModule({
    imports: [WorkspaceSettings],
    providers: [
      {
        provide: ApiClient,
        useValue: {
          getWorkspace: vi.fn(() => of(workspace())),
          updateWorkspace: vi.fn((request: Partial<WorkspaceDetails>) =>
            of(workspace({ ...request, version: 6 })),
          ),
          ...api,
        },
      },
      provideRouter([]),
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      { provide: UiToast, useValue: toast },
      {
        provide: TenantStore,
        useValue: {
          selectedTenantId: signal('tenant-1'),
          selectedMembership: signal({ tenantId: 'tenant-1', role: 'Owner' }),
          load: vi.fn(() => Promise.resolve()),
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(WorkspaceSettings);
  await settle(fixture);
  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    api: TestBed.inject(ApiClient) as unknown as Record<string, ReturnType<typeof vi.fn>>,
    tenants: TestBed.inject(TenantStore) as unknown as { load: ReturnType<typeof vi.fn> },
    toast,
  };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The sheet or dialog on top, which the CDK draws outside the page. */
const dialog = () => {
  const open = document.querySelectorAll<HTMLElement>('[role="dialog"]');
  return open.length ? open[open.length - 1] : null;
};

describe('Settings › Name and region', () => {
  afterEach(() => {
    document.body.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());
    TestBed.resetTestingModule();
  });

  it('opens on the coaching space as it is stored, with nothing to save yet', async () => {
    const { host } = await render();

    expect(textOf(host.querySelector('h1'))).toBe('Name and region');
    expect(field(host, 'Coaching space name').value).toBe('Atlas Performance');
    expect(textOf(host.querySelector('[data-zone] strong'))).toBe('Beirut, Asia');
    // Only what really follows the zone: no check-in or workout reminders exist (audit LOST-14).
    expect(host.textContent?.replace(/\s+/g, ' ')).toContain(
      'Days in programs, check-ins and plans start and end at midnight here. Plan notices, such as a plan ending soon, and everyone’s quiet hours follow this clock too.',
    );
    expect(host.textContent).not.toContain('reminders');
    expect(field(host, 'Monday').checked).toBe(true);
    expect(field(host, 'US dollar').checked).toBe(true);
    expect(textOf(host.querySelector('[data-currency-line]'))).toBe(
      'New plans are priced in US Dollar (USD). Plans you already sell keep their own currency, and so do your clients’ plans and payments.',
    );
    // The short name never shows: it is an identifier, not something the owner manages.
    expect(host.textContent).not.toContain('atlas-performance');
    expect(button(host, 'Save changes').disabled).toBe(true);
    expect(announced(host)).toBe('');
  });

  /**
   * These settings decide the time zone, week boundary and currency that every dated or priced rule
   * downstream reads. Each control must reach the request, with the version the page was loaded at.
   */
  it('saves every changed setting with the version it was loaded at, then repaints the shell', async () => {
    const { fixture, host, api, tenants, toast } = await render();

    fill(host, 'Coaching space name', '  Atlas Strength  ');
    tick(host, 'Sunday');
    tick(host, 'Lebanese pound');
    await settle(fixture);
    press(host, 'Save changes');
    await settle(fixture);

    expect(api['updateWorkspace']).toHaveBeenCalledWith({
      name: 'Atlas Strength',
      timeZoneId: 'Asia/Beirut',
      // The language the owner left alone goes back as it was stored.
      defaultCulture: 'ar-LB',
      defaultCurrencyCode: 'LBP',
      weekStartsOn: 'Sunday',
      version: 5,
    });
    expect(tenants.load).toHaveBeenCalledWith('tenant-1');
    expect(toast.show).toHaveBeenCalledWith('Settings saved.', { tone: 'success' });
    expect(button(host, 'Save changes').disabled).toBe(true);
  });

  /**
   * The language of the space's notices and emails (audit INV-8). Only English wording exists, so the page
   * says that an Arabic space still hears every notice, in English, until the Arabic ones are written.
   */
  it('chooses the language of notices and emails, saying what Arabic means today', async () => {
    const { fixture, host, api } = await render();
    const line = () => textOf(host.querySelector('[data-language-line]'));

    expect(textOf(host.querySelector('#language-heading'))).toBe('Language');
    expect(field(host, 'Arabic').checked).toBe(true);
    expect(field(host, 'English').checked).toBe(false);
    expect(line()).toBe(
      'Notices and emails aren’t written in Arabic yet, so they go out in English until they are.',
    );
    // A live region from the start, so the line said after a change is announced.
    expect(host.querySelector('[data-language-line]')?.getAttribute('aria-live')).toBe('polite');

    tick(host, 'English');
    await settle(fixture);
    expect(line()).toBe('Notices and emails go out in English.');
    expect(button(host, 'Save changes').disabled).toBe(false);
    press(host, 'Save changes');
    await settle(fixture);
    expect(api['updateWorkspace']).toHaveBeenCalledWith(
      expect.objectContaining({ defaultCulture: 'en-LB', version: 5 }),
    );
    expect(field(host, 'English').checked).toBe(true);
    expect(button(host, 'Save changes').disabled).toBe(true);

    // Back to Arabic and undone: nothing left to save.
    tick(host, 'Arabic');
    await settle(fixture);
    expect(button(host, 'Save changes').disabled).toBe(false);
    press(host, 'Undo changes');
    await settle(fixture);
    expect(field(host, 'English').checked).toBe(true);
    expect(button(host, 'Save changes').disabled).toBe(true);
  });

  it('finds a time zone by city in a sheet and takes it into the draft', async () => {
    const { fixture, host, api } = await render();

    press(host, 'Change');
    await settle(fixture);
    expect(textOf(dialog()?.querySelector('h2'))).toBe('Time zone');
    // The saved zone is marked in the list.
    expect(textOf(dialog()!.querySelector('[aria-current="true"] .zone-name'))).toBe('Beirut Asia');

    fill(dialog()!, 'Search by city', 'dubai');
    await settle(fixture);
    const options = Array.from(dialog()!.querySelectorAll<HTMLButtonElement>('.zone-option'));
    expect(options.map((option) => textOf(option.querySelector('.zone-name')))).toEqual([
      'Dubai Asia',
    ]);
    options[0].click();
    await settle(fixture);

    expect(dialog()).toBeNull();
    expect(textOf(host.querySelector('[data-zone] strong'))).toBe('Dubai, Asia');
    press(host, 'Save changes');
    await settle(fixture);
    expect(api['updateWorkspace']).toHaveBeenCalledWith(
      expect.objectContaining({ timeZoneId: 'Asia/Dubai' }),
    );
  });

  it('takes another currency by its code, and refuses one that is not a currency', async () => {
    const { fixture, host, api } = await render();

    tick(host, 'Another');
    await settle(fixture);
    fill(host, 'Currency code', 'zzq');
    await settle(fixture);
    press(host, 'Save changes');
    await settle(fixture);
    await new Promise((resolve) => setTimeout(resolve));

    expect(api['updateWorkspace']).not.toHaveBeenCalled();
    expect(host.textContent).toContain('ZZQ isn’t a currency code. Try one like EUR or AED.');
    expect(focusedId()).toBe('space-currency');

    fill(host, 'Currency code', 'eur');
    await settle(fixture);
    expect(textOf(host.querySelector('[data-currency-line]'))).toContain(
      'New plans are priced in Euro (EUR).',
    );
    press(host, 'Save changes');
    await settle(fixture);
    expect(api['updateWorkspace']).toHaveBeenCalledWith(
      expect.objectContaining({ defaultCurrencyCode: 'EUR' }),
    );
  });

  it('keeps a space with no name from being saved, and says why beside the field', async () => {
    const { fixture, host, api } = await render();

    fill(host, 'Coaching space name', '   ');
    await settle(fixture);
    press(host, 'Save changes');
    await settle(fixture);
    await new Promise((resolve) => setTimeout(resolve));

    expect(api['updateWorkspace']).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Give your coaching space a name.');
    expect(focusedId()).toBe('space-name');
    // The kit's summary points at the box (ARCHITECTURE §8).
    expect(announced(host)).toBe('Check the fields marked above.');
  });

  it('says why a save was refused and keeps what the owner typed', async () => {
    const { fixture, host } = await render({
      updateWorkspace: vi.fn(() =>
        throwError(
          () =>
            new HttpErrorResponse({
              status: 403,
              error: { code: 'workspace_read_only' },
            }),
        ),
      ),
    });

    fill(host, 'Coaching space name', 'Atlas Strength');
    await settle(fixture);
    press(host, 'Save changes');
    await settle(fixture);

    expect(announced(host)).toBe(
      'Your coaching space is read-only until its TB Gym bill is paid. You can still view everything.',
    );
    // In the kit's summary, which takes focus so the refusal is read where the owner is.
    expect(document.activeElement).toBe(formSummary(host));
    expect(field(host, 'Coaching space name').value).toBe('Atlas Strength');
    expect(button(host, 'Save changes').disabled).toBe(false);
  });

  it('puts the saved settings back with Undo changes', async () => {
    const { fixture, host } = await render();

    fill(host, 'Coaching space name', 'Atlas Strength');
    tick(host, 'Saturday');
    await settle(fixture);
    press(host, 'Undo changes');
    await settle(fixture);

    expect(field(host, 'Coaching space name').value).toBe('Atlas Performance');
    expect(field(host, 'Monday').checked).toBe(true);
    expect(button(host, 'Save changes').disabled).toBe(true);
  });

  it('asks before leaving with changes, and lets the page go without them', async () => {
    const { fixture, host } = await render();
    const page = fixture.componentInstance;

    await expect(page.canLeave()).resolves.toBe(true);

    fill(host, 'Coaching space name', 'Atlas Strength');
    await settle(fixture);
    const staying = page.canLeave();
    await settle(fixture);
    expect(textOf(dialog()?.querySelector('h2'))).toBe('Leave without saving?');
    press(dialog()!, 'Stay');
    await expect(staying).resolves.toBe(false);

    const leaving = page.canLeave();
    await settle(fixture);
    press(dialog()!, 'Leave without saving');
    await expect(leaving).resolves.toBe(true);
  });

  it('offers another try when the coaching space cannot be read', async () => {
    const getWorkspace = vi
      .fn()
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })))
      .mockReturnValue(of(workspace()));
    const { fixture, host } = await render({ getWorkspace });

    expect(announced(host)).toBe('Your coaching space couldn’t be loaded.');
    expect(host.querySelector('form')).toBeNull();
    press(host, 'Try again');
    await settle(fixture);
    expect(field(host, 'Coaching space name').value).toBe('Atlas Performance');
  });

  it('lists the coaching space’s pages and the owner’s own in one Settings navigation', async () => {
    const { host } = await render();

    const nav = host.querySelector('nav[aria-label="Settings"]')!;
    expect(Array.from(nav.querySelectorAll('.group-label')).map(textOf)).toEqual([
      'Coaching space',
      'Your account',
    ]);
    expect(Array.from(nav.querySelectorAll('a')).map(textOf)).toEqual([
      'Name and region',
      'Brand',
      'Nutrition',
      'Team',
      'Billing',
      'Undelivered notices',
      'Notifications',
      'Appearance',
      'Password and security',
    ]);
  });
});
