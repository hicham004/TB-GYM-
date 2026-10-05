import { NO_ERRORS_SCHEMA, signal, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type { CoachClientDetails, WorkspaceDetails } from '../../core/api/api.models';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { settle } from '../../../testing/dom';
import {
  ClientIntakeSection,
  ClientServiceSection,
  ClientTrainingSection,
} from './client-workspace-sections';
import { ClientWorkspaceContext } from './client-workspace.context';

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

const FORMER = {
  ...PROFILE,
  release: {
    releasedAtUtc: '2026-09-20T10:00:00Z',
    reason: 'Moved',
    releasedByName: 'Olivia Owner',
    departureKind: 'ReleasedByOwner',
  },
} as CoachClientDetails;

async function render<T>(
  component: Type<T>,
  options: {
    profile?: CoachClientDetails;
    isOwner?: boolean;
    api?: Record<string, unknown>;
    stubChildren?: boolean;
  } = {},
) {
  TestBed.configureTestingModule({
    imports: [component],
    providers: [
      provideRouter([]),
      ClientWorkspaceContext,
      { provide: ApiClient, useValue: options.api ?? {} },
      { provide: CsrfService, useValue: { refresh: vi.fn().mockResolvedValue(undefined) } },
      {
        provide: TenantStore,
        useValue: {
          selectedTenantId: signal('tenant-1'),
          isOwner: signal(options.isOwner ?? true),
        },
      },
    ],
  });
  if (options.stubChildren ?? true) {
    TestBed.overrideComponent(component, { set: { imports: [], schemas: [NO_ERRORS_SCHEMA] } });
  }
  await TestBed.compileComponents();
  const context = TestBed.inject(ClientWorkspaceContext);
  context.clientId.set('client-1');
  context.profile.set(options.profile ?? PROFILE);
  context.workspace.set({ currentDate: '2026-09-20' } as WorkspaceDetails);
  const fixture = TestBed.createComponent(component);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, context };
}

describe('client record sections', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('draws Service & access as the plans page', async () => {
    const { host } = await render(ClientServiceSection);

    expect(host.querySelector('app-client-service')).not.toBeNull();
  });

  it('disables the whole intake for a former client', async () => {
    const current = await render(ClientIntakeSection);
    expect(current.host.querySelector<HTMLFieldSetElement>('fieldset')?.disabled).toBe(false);

    TestBed.resetTestingModule();
    const former = await render(ClientIntakeSection, { profile: FORMER });
    expect(former.host.querySelector<HTMLFieldSetElement>('fieldset')?.disabled).toBe(true);
  });

  it('does not show a former client’s training', async () => {
    const { host } = await render(ClientTrainingSection, { profile: FORMER });

    expect(host.querySelector('app-client-program')).toBeNull();
    expect(host.textContent).toContain('This is a former client.');
  });

  it('shows a current client’s training as the program timeline', async () => {
    const { host } = await render(ClientTrainingSection);

    expect(host.querySelector('app-client-program')).not.toBeNull();
    expect(host.textContent).not.toContain('This is a former client.');
  });
});
