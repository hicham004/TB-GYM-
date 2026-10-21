import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type { CoachClientDetails } from '../../core/api/api.models';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { fill, formSummary, press, settle, type } from '../../../testing/dom';
import {
  coachView,
  finishedProfile,
  halfwayProfile,
  newProfile,
  workspace,
} from '../../../testing/intake-fixtures';
import { ClientIntake } from './client-intake';
import { ClientWorkspaceContext } from './client-workspace.context';

const FORMER = {
  ...coachView(),
  release: {
    releasedAtUtc: '2026-09-20T10:00:00Z',
    reason: 'Moved',
    releasedByName: 'Olivia Owner',
    departureKind: 'ReleasedByOwner',
  },
} as CoachClientDetails;

async function render(
  profile: CoachClientDetails = coachView(),
  api: Record<string, unknown> = {},
) {
  const tenantId = signal<string | null>('tenant-1');
  await TestBed.configureTestingModule({
    imports: [ClientIntake],
    providers: [
      ClientWorkspaceContext,
      {
        provide: ApiClient,
        useValue: {
          updateClientIntake: vi.fn((_: string, request: { version: number }) =>
            of({ ...profile, version: request.version + 1 }),
          ),
          completeClientOnboarding: vi.fn((_: string, request: { intake: { version: number } }) =>
            of({ ...profile, onboardingStatus: 'Completed', version: request.intake.version + 1 }),
          ),
          ...api,
        },
      },
      { provide: CsrfService, useValue: { refresh: vi.fn().mockResolvedValue(undefined) } },
      { provide: TenantStore, useValue: { selectedTenantId: tenantId, isOwner: signal(true) } },
    ],
  }).compileComponents();
  const context = TestBed.inject(ClientWorkspaceContext);
  context.clientId.set('client-1');
  context.profile.set(profile);
  context.workspace.set(workspace());
  const fixture = TestBed.createComponent(ClientIntake);
  await settle(fixture);
  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    context,
    tenantId,
    api: TestBed.inject(ApiClient) as unknown as Record<string, ReturnType<typeof vi.fn>>,
  };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

const dialog = () => {
  const open = document.querySelectorAll<HTMLElement>('[role="dialog"]');
  return open.length ? open[open.length - 1] : null;
};

const toast = () => textOf(document.querySelector('.tb-toast-host, app-toast-host'));

const edit = (host: HTMLElement, group: string) =>
  (host.querySelector(`[data-edit="${group}"]`) as HTMLButtonElement).click();

describe('ClientIntake (the coach’s view)', () => {
  afterEach(() => {
    document.body.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());
    TestBed.resetTestingModule();
  });

  it('shows the answers a client gave, each group with an Edit, and says how setting up stands', async () => {
    const { host } = await render();

    expect(textOf(host.querySelector('h2'))).toBe('Client intake');
    expect(textOf(host.querySelector('.lede'))).toBe(
      'The answers Rana gave when setting up. Correct any of them with Edit.',
    );
    expect(textOf(host.querySelector('app-status-label'))).toContain('Completed');
    expect(Array.from(host.querySelectorAll('.panel-head h2')).map(textOf)).toEqual([
      'About Rana',
      'Rana’s goal',
      'Rana’s day and food',
      'Rana’s health',
    ]);
    expect(host.querySelectorAll('[data-edit]')).toHaveLength(4);
    expect(host.querySelector('.setup')).toBeNull();
    const medications = Array.from(host.querySelectorAll('.answer')).find((row) =>
      textOf(row).startsWith('Medications'),
    );
    expect(textOf(medications)).toBe('Medications Not added');
  });

  it('reads, and does not edit, a former client’s answers', async () => {
    const { host } = await render(FORMER);

    expect(textOf(host.querySelector('.lede'))).toBe(
      'Rana is a former client, so these answers can be read but not changed.',
    );
    expect(host.querySelectorAll('[data-edit]')).toHaveLength(0);
    expect(textOf(host)).toContain('Rice, chicken, labneh');
  });

  it('corrects one group in a sheet and keeps the page in step with what the server returned', async () => {
    const { fixture, host, api, context } = await render();

    edit(host, 'about');
    await settle(fixture);
    const sheet = dialog()!;
    expect(textOf(sheet.querySelector('h2'))).toBe('About Rana');
    fill(sheet, 'Phone number (optional)', '+96171999888');
    await settle(fixture);
    press(sheet, 'Save changes');
    await settle(fixture);

    expect(api['updateClientIntake']).toHaveBeenCalledWith(
      'client-1',
      expect.objectContaining({
        phoneNumber: '+96171999888',
        goals: 'Run a 10k in under an hour by June.',
        version: 9,
      }),
    );
    expect(dialog()).toBeNull();
    expect(toast()).toContain('Rana’s details were saved.');
    expect(context.profile()?.version).toBe(10);
  });

  it('keeps the sheet open and says why when the server refuses', async () => {
    const refusal = new HttpErrorResponse({
      status: 409,
      error: { title: 'The client was changed by someone else. Reload and try again.' },
    });
    const { fixture, host } = await render(coachView(), {
      updateClientIntake: vi.fn(() => throwError(() => refusal)),
    });

    edit(host, 'goal');
    await settle(fixture);
    const sheet = dialog()!;
    fill(sheet, 'Goals', 'Compete in a powerlifting meet.');
    await settle(fixture);
    press(sheet, 'Save changes');
    await settle(fixture);

    expect(dialog()).toBe(sheet);
    expect(textOf(formSummary(sheet))).toBe(
      'The client was changed by someone else. Reload and try again.',
    );
    expect(document.activeElement).toBe(formSummary(sheet));
    expect((sheet.querySelector('textarea[name="goals"]') as HTMLTextAreaElement).value).toBe(
      'Compete in a powerlifting meet.',
    );
  });

  it('keeps the client’s own privacy line out of the coach’s health sheet', async () => {
    const { fixture, host } = await render();

    edit(host, 'health');
    await settle(fixture);
    expect(dialog()).not.toBeNull();
    expect(dialog()!.querySelector('.privacy')).toBeNull();
  });

  it('asks before closing a sheet that holds typing, and not otherwise', async () => {
    const { fixture, host } = await render();

    edit(host, 'life');
    await settle(fixture);
    press(dialog()!, 'Not now');
    await settle(fixture);
    expect(dialog()).toBeNull();

    edit(host, 'life');
    await settle(fixture);
    const sheet = dialog()!;
    fill(sheet, 'Work (optional)', 'Pilot');
    await settle(fixture);
    press(sheet, 'Not now');
    await settle(fixture);
    expect(textOf(dialog())).toContain('Close without saving? What you typed will be lost.');
    press(dialog()!, 'Keep editing');
    await settle(fixture);
    expect(dialog()).not.toBeNull();
    expect(textOf(dialog())).not.toContain('Close without saving?');
  });

  it('lets a coach save what they know of a client who is still setting up', async () => {
    const { fixture, host, api } = await render(coachView(newProfile()));

    edit(host, 'about');
    await settle(fixture);
    const sheet = dialog()!;
    fill(sheet, 'Phone number (optional)', '+96170123456');
    await settle(fixture);
    press(sheet, 'Save changes');
    await settle(fixture);

    expect(api['updateClientIntake']).toHaveBeenCalledWith(
      'client-1',
      expect.objectContaining({ phoneNumber: '+96170123456', birthDate: null, heightValue: null }),
    );
    expect(dialog()).toBeNull();
  });

  it('says what is still needed, and finishes setting up with the starting weight', async () => {
    const { fixture, host, api, context } = await render(coachView(halfwayProfile()));

    expect(textOf(host.querySelector('.banner-text'))).toBe(
      'Rana has not finished setting up. Their starting weight is the last thing needed.',
    );
    const finish = host.querySelector('[data-finish-setup]') as HTMLButtonElement;
    expect(finish.disabled).toBe(false);

    finish.click();
    await settle(fixture);
    const sheet = dialog()!;
    expect(textOf(sheet.querySelector('h2'))).toBe('Starting weight');
    fill(sheet, 'Weight', '64.2');
    await settle(fixture);
    press(sheet, 'Finish setting up');
    await settle(fixture);

    expect(api['completeClientOnboarding']).toHaveBeenCalledWith('client-1', {
      intake: expect.objectContaining({ goals: 'Run a 10k in under an hour by June.', version: 6 }),
      initialBodyweightValue: 64.2,
      initialBodyweightUnit: 'Kilogram',
      measurementDate: '2026-10-10',
    });
    expect(toast()).toContain('Rana has finished setting up.');
    expect(context.profile()?.onboardingStatus).toBe('Completed');
    await settle(fixture);
    expect(host.querySelector('.setup')).toBeNull();
  });

  it('holds Finish setting up back until the date of birth, height and a goal are there', async () => {
    const { fixture, host } = await render(coachView(newProfile()));

    expect(textOf(host.querySelector('.banner-text'))).toBe(
      'Rana has not finished setting up. Still needed: date of birth, height, a goal, and starting weight. Add what you know with Edit below.',
    );
    expect((host.querySelector('[data-finish-setup]') as HTMLButtonElement).disabled).toBe(true);
    await settle(fixture);
  });

  it('corrects a date of birth that is not an adult’s before the server has to', async () => {
    const { fixture, host, api } = await render();

    edit(host, 'about');
    await settle(fixture);
    const sheet = dialog()!;
    type(sheet, 'input.day', '11');
    type(sheet, 'input.month', '10');
    type(sheet, 'input.year', '2008');
    await settle(fixture);
    press(sheet, 'Save changes');
    await settle(fixture);

    expect(textOf(sheet)).toContain('Clients have to be 18 or older.');
    expect(api['updateClientIntake']).not.toHaveBeenCalled();
  });

  it('drops a late answer when the workspace changes while a change is being saved', async () => {
    const late = new Subject<CoachClientDetails>();
    const { fixture, host, context, tenantId } = await render(coachView(), {
      updateClientIntake: vi.fn(() => late),
    });

    edit(host, 'goal');
    await settle(fixture);
    const sheet = dialog()!;
    fill(sheet, 'Goals', 'A different goal.');
    await settle(fixture);
    press(sheet, 'Save changes');
    await settle(fixture);

    tenantId.set('tenant-2');
    await settle(fixture);
    late.next({ ...coachView(finishedProfile({ goals: 'Someone else' })), version: 99 });
    await settle(fixture);

    // The record of the old workspace is gone, and the late answer did not bring anyone back.
    expect(context.profile()).toBeNull();
    expect(toast()).not.toContain('details were saved');
  });
});
