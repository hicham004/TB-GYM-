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
import { brandTokens } from '../../core/theme/brand-theme';
import { PersonalModeStore } from '../../core/theme/personal-mode.store';
import { UiToast } from '../../ui/toast';
import { announced, button, field, fill, leave, press, query, settle } from '../../../testing/dom';
import { WorkspaceBrand } from './workspace-brand';
import { WorkspaceBrandApi } from './workspace-brand-api';

function workspace(overrides: Partial<WorkspaceDetails> = {}): WorkspaceDetails {
  return {
    id: 'tenant-1',
    name: 'Cedar Strength',
    slug: 'cedar-strength',
    timeZoneId: 'Asia/Beirut',
    defaultCulture: 'en-LB',
    defaultCurrencyCode: 'USD',
    weekStartsOn: 'Monday',
    currentDate: '2026-10-04',
    version: 7,
    brandColor: '#15233f',
    accentColor: '#ffb48c',
    logoAssetId: 'logo-1',
    ...overrides,
  };
}

async function render(
  options: {
    saved?: WorkspaceDetails;
    api?: Record<string, unknown>;
    brandApi?: Record<string, unknown>;
  } = {},
) {
  const saved = options.saved ?? workspace();
  const api = {
    getWorkspace: vi.fn(() => of(saved)),
    createMediaAccess: vi.fn((id: string) => of({ url: `/api/media/${id}/content` })),
    ...options.api,
  };
  const brandApi = {
    saveBrand: vi.fn(
      (request: { brandColor: string; accentColor: string; logoAssetId: string | null }) =>
        of(workspace({ ...request, version: 8 })),
    ),
    uploadLogo: vi.fn(() => of({ id: 'logo-2' })),
    ...options.brandApi,
  };
  const csrf = { refresh: vi.fn(() => Promise.resolve()) };
  const tenants = {
    selectedTenantId: signal('tenant-1'),
    selectedMembership: signal({ tenantId: 'tenant-1', role: 'Owner' }),
    load: vi.fn(() => Promise.resolve()),
  };
  const toast = { show: vi.fn() };
  await TestBed.configureTestingModule({
    imports: [WorkspaceBrand],
    providers: [
      provideRouter([]),
      { provide: ApiClient, useValue: api },
      { provide: WorkspaceBrandApi, useValue: brandApi },
      { provide: CsrfService, useValue: csrf },
      { provide: TenantStore, useValue: tenants },
      { provide: UiToast, useValue: toast },
      { provide: PersonalModeStore, useValue: { mode: signal('light') } },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(WorkspaceBrand);
  await settle(fixture);
  const host = fixture.nativeElement as HTMLElement;
  return { fixture, host, api, brandApi, csrf, tenants, toast };
}

function look(host: HTMLElement, value: string): HTMLInputElement {
  return query<HTMLInputElement>(host, `input[name="look"][value="${value}"]`);
}

function pick(host: HTMLElement, value: string): void {
  const radio = look(host, value);
  radio.checked = true;
  radio.dispatchEvent(new Event('change'));
}

function chooseFile(host: HTMLElement, file: File): void {
  const input = query<HTMLInputElement>(host, 'input[type="file"]');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
}

const preview = (host: HTMLElement) => query<HTMLElement>(host, 'app-brand-preview');

describe('WorkspaceBrand', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('opens on the saved brand with its logo, with nothing to save yet', async () => {
    const { host, api, csrf } = await render();

    expect(look(host, 'navy').checked).toBe(true);
    expect(host.querySelector('.look.selected .look-name')?.textContent?.trim()).toBe(
      'Navy and coral',
    );
    expect(csrf.refresh).toHaveBeenCalled();
    expect(api.createMediaAccess).toHaveBeenCalledWith('logo-1');
    expect(query<HTMLImageElement>(host, '.logo-tile img').getAttribute('src')).toBe(
      '/api/media/logo-1/content',
    );
    expect(button(host, 'Save brand').disabled).toBe(true);
    expect(host.textContent).not.toContain('Discard changes');
    expect(preview(host).textContent).toContain('Cedar Strength');
  });

  it('opens a workspace without a brand on TB Gym’s own look, with initials for a logo', async () => {
    const { host } = await render({
      saved: workspace({ brandColor: null, accentColor: null, logoAssetId: null }),
    });

    expect(look(host, 'forest').checked).toBe(true);
    expect(query(host, '.logo-tile').textContent?.trim()).toBe('CS');
    expect(button(host, 'Upload logo')).toBeTruthy();
    expect(host.textContent).not.toContain('Remove logo');
  });

  it('previews a look and saves it, then reads the workspaces again so the app repaints', async () => {
    const { fixture, host, brandApi, tenants, toast } = await render();

    pick(host, 'charcoal');
    await settle(fixture);
    const tokens = brandTokens({ brand: '#221b18', accent: '#ff8a4c' });
    expect(preview(host).style.getPropertyValue('--tb-brand')).toBe(tokens['--tb-brand']);
    expect(button(host, 'Save brand').disabled).toBe(false);

    await press(host, 'Save brand');
    await settle(fixture);

    expect(brandApi.saveBrand).toHaveBeenCalledWith({
      brandColor: '#221b18',
      accentColor: '#ff8a4c',
      logoAssetId: 'logo-1',
      version: 7,
    });
    expect(tenants.load).toHaveBeenCalledWith('tenant-1');
    expect(toast.show).toHaveBeenCalledWith(
      'Brand saved. Your clients see it the next time they open the app.',
      { tone: 'success' },
    );
    expect(button(host, 'Save brand').disabled).toBe(true);
  });

  it('takes the owner’s own colours, typed or short, and says when one is adjusted to read well', async () => {
    const { fixture, host, brandApi } = await render();

    pick(host, 'custom');
    await settle(fixture);
    expect(field(host, 'Brand colour').value).toBe('#15233f');
    expect(field(host, 'Accent colour').value).toBe('#ffb48c');
    expect(host.querySelector('.note')).toBeNull();

    fill(host, 'Brand colour', '#7FB');
    leave(host, 'Brand colour');
    await settle(fixture);
    expect(field(host, 'Brand colour').value).toBe('#77ffbb');
    expect(query(host, '.note').textContent).toContain('shown a little darker');

    // A colour still being typed is not wrong yet; leaving it, or trying to save, says so.
    fill(host, 'Accent colour', 'coral');
    await settle(fixture);
    expect(host.textContent).not.toContain('Enter a colour as six digits');
    leave(host, 'Accent colour');
    await settle(fixture);
    expect(host.textContent).toContain('Enter a colour as six digits, such as #ffb48c.');
    expect(field(host, 'Accent colour').getAttribute('aria-invalid')).toBe('true');

    // Saving is refused out loud, not disabled, and the field to fix takes focus.
    expect(button(host, 'Save brand').disabled).toBe(false);
    await press(host, 'Save brand');
    await settle(fixture);
    expect(announced(host)).toContain('Check the colours marked above.');
    expect(brandApi.saveBrand).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(field(host, 'Accent colour'));

    fill(host, 'Accent colour', '#ff8a4c');
    await settle(fixture);
    await press(host, 'Save brand');
    await settle(fixture);
    expect(brandApi.saveBrand).toHaveBeenCalledWith(
      expect.objectContaining({ brandColor: '#77ffbb', accentColor: '#ff8a4c' }),
    );
  });

  it('refuses a file the server would refuse, before sending a byte', async () => {
    const { fixture, host, brandApi } = await render();

    chooseFile(host, new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }));
    await settle(fixture);

    expect(announced(host)).toContain('Choose a PNG or JPEG image.');
    expect(brandApi.uploadLogo).not.toHaveBeenCalled();
  });

  it('uploads a logo with a fresh token, previews it, and saves it or no logo at all', async () => {
    const { fixture, host, brandApi, csrf } = await render();
    csrf.refresh.mockClear();

    chooseFile(
      host,
      new File([new Uint8Array([137, 80, 78, 71])], 'logo.png', { type: 'image/png' }),
    );
    await settle(fixture);

    expect(csrf.refresh).toHaveBeenCalled();
    expect(brandApi.uploadLogo).toHaveBeenCalledTimes(1);
    expect(query<HTMLImageElement>(host, '.logo-tile img').getAttribute('src')).toBe(
      '/api/media/logo-2/content',
    );
    expect(query(host, '[role="status"].tb-visually-hidden').textContent).toBe(
      'Logo ready. Save the brand to use it.',
    );
    expect(query<HTMLImageElement>(preview(host), '.sidebar img').getAttribute('src')).toBe(
      '/api/media/logo-2/content',
    );

    await press(host, 'Remove logo');
    await settle(fixture);
    expect(query(host, '.logo-tile').textContent?.trim()).toBe('CS');
    await press(host, 'Save brand');
    await settle(fixture);
    expect(brandApi.saveBrand).toHaveBeenCalledWith(expect.objectContaining({ logoAssetId: null }));
  });

  it('says why an upload failed and keeps the logo there was', async () => {
    const { fixture, host } = await render({
      brandApi: {
        uploadLogo: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 400 }))),
      },
    });

    chooseFile(host, new File([new Uint8Array([1])], 'logo.png', { type: 'image/png' }));
    await settle(fixture);

    expect(announced(host)).toContain('That image couldn’t be used. Try another PNG or JPEG.');
    expect(query<HTMLImageElement>(host, '.logo-tile img').getAttribute('src')).toBe(
      '/api/media/logo-1/content',
    );
  });

  it('keeps the draft and explains a brand changed in another window', async () => {
    const { fixture, host, tenants } = await render({
      brandApi: {
        saveBrand: vi.fn(() =>
          throwError(
            () => new HttpErrorResponse({ status: 409, error: { code: 'concurrency_conflict' } }),
          ),
        ),
      },
    });

    pick(host, 'plum');
    await settle(fixture);
    await press(host, 'Save brand');
    await settle(fixture);

    expect(announced(host)).toContain('The brand was changed in another window.');
    expect(look(host, 'plum').checked).toBe(true);
    expect(tenants.load).not.toHaveBeenCalled();
  });

  it('discards a draft back to the saved brand', async () => {
    const { fixture, host } = await render();

    pick(host, 'plum');
    await settle(fixture);
    await press(host, 'Discard changes');
    await settle(fixture);

    expect(look(host, 'navy').checked).toBe(true);
    expect(button(host, 'Save brand').disabled).toBe(true);
  });

  it('shows the preview in the mode chosen for it, and warns before a refresh loses a draft', async () => {
    const { fixture, host } = await render();
    expect(preview(host).dataset['mode']).toBe('light');

    const dark = query<HTMLInputElement>(host, 'app-segmented-control input[value="dark"]');
    dark.checked = true;
    dark.dispatchEvent(new Event('change'));
    await settle(fixture);
    expect(preview(host).dataset['mode']).toBe('dark');

    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    pick(host, 'plum');
    await settle(fixture);
    const dirty = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });

  it('offers another try when the brand cannot be read', async () => {
    let calls = 0;
    const { fixture, host } = await render({
      api: {
        getWorkspace: vi.fn(() =>
          calls++ === 0 ? throwError(() => new Error('offline')) : of(workspace()),
        ),
      },
    });

    expect(announced(host)).toContain('Your brand couldn’t be loaded.');
    await press(host, 'Try again');
    await settle(fixture);
    expect(look(host, 'navy').checked).toBe(true);
  });
});
