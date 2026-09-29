import { HttpErrorResponse } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FormerClientsApi } from './former-clients-api';
import type { CoachClientDetails } from '../../core/api/api.models';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { installDialogSupport } from '../../../testing/dialog';
import { fill, press, settle, text } from '../../../testing/dom';
import { ClientRelease } from './client-release';

let uninstallDialog: () => void = () => undefined;

const client = {
  id: 'client-1',
  firstName: 'Sam',
  lastName: 'Saad',
  version: 7,
  release: null,
} as CoachClientDetails;

const released = {
  ...client,
  version: 8,
  release: {
    releasedAtUtc: '2026-09-23T11:00:00Z',
    reason: 'Moved away',
    releasedByName: 'Olivia Owner',
  },
} as CoachClientDetails;

@Component({
  imports: [ClientRelease],
  template: `<app-client-release [client]="client()" (released)="done.push($event)" />`,
})
class Host {
  readonly client = signal(client);
  readonly done: CoachClientDetails[] = [];
}

async function render(releaseClient = vi.fn(() => of(released))) {
  await TestBed.configureTestingModule({
    imports: [Host],
    providers: [
      { provide: FormerClientsApi, useValue: { releaseClient } },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(Host);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, releaseClient };
}

describe('ClientRelease', () => {
  beforeEach(() => {
    uninstallDialog = installDialogSupport();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    uninstallDialog();
  });

  it('says what a release does before anything is sent', async () => {
    const { fixture, host, releaseClient } = await render();

    press(host, 'End coaching');
    await settle(fixture);

    expect(host.querySelector('dialog')?.open).toBe(true);
    expect(text(fixture)).toContain('End coaching with Sam Saad?');
    expect(text(fixture)).toContain('They lose access right away');
    expect(text(fixture)).toContain('with no refund');
    expect(text(fixture)).toContain("You can't undo this");
    expect(releaseClient).not.toHaveBeenCalled();
  });

  it('requires a reason', async () => {
    const { fixture, host, releaseClient } = await render();

    press(host, 'End coaching');
    await settle(fixture);
    fill(host, 'Reason', '   ');
    press(host, 'End coaching permanently');
    await settle(fixture);

    expect(releaseClient).not.toHaveBeenCalled();
    expect(host.querySelector('dialog')?.open).toBe(true);
  });

  it('releases with the trimmed reason and the version it was shown, then hands back the record', async () => {
    const { fixture, host, releaseClient } = await render();

    press(host, 'End coaching');
    await settle(fixture);
    fill(host, 'Reason', '  Moved away  ');
    press(host, 'End coaching permanently');
    await settle(fixture);

    expect(releaseClient).toHaveBeenCalledWith('client-1', 'Moved away', 7);
    expect(fixture.componentInstance.done.map((item) => item.release?.reason)).toEqual([
      'Moved away',
    ]);
    expect(host.querySelector('dialog')?.open).toBe(false);
  });

  it('keeps the dialog open and explains a refusal', async () => {
    const refusal = new HttpErrorResponse({
      status: 409,
      error: {
        code: 'concurrency_conflict',
        message: 'The client profile was changed by another request.',
      },
    });
    const { fixture, host } = await render(vi.fn(() => throwError(() => refusal)));

    press(host, 'End coaching');
    await settle(fixture);
    fill(host, 'Reason', 'Moved away');
    press(host, 'End coaching permanently');
    await settle(fixture);

    expect(host.querySelector('dialog')?.open).toBe(true);
    expect(host.querySelector('[role="alert"]')?.textContent?.trim()).not.toBe('');
    expect(fixture.componentInstance.done).toEqual([]);
  });
});
