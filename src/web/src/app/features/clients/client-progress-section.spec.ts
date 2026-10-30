import { Component, input, output } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, RouterLink } from '@angular/router';
import { ButtonLink } from '../../ui/button';
import { afterEach, describe, expect, it } from 'vitest';
import type { CoachClientDetails } from '../../core/api/api.models';
import { UiDisclosure, UiDisclosureContent } from '../../ui/disclosure';
import { fold, settle, toggleFold } from '../../../testing/dom';
import { ClientWorkspaceContext } from './client-workspace.context';
import { ClientProgressSection } from './client-workspace-sections';

// The two screens are tested on their own; here only how the section arranges them.
@Component({
  selector: 'app-progress-dashboard',
  template: 'dashboard for {{ clientId() }} / {{ clientName() }}',
})
class DashboardStub {
  readonly clientId = input<string | null>(null);
  readonly clientName = input<string | null>(null);
  readonly readOnly = input(false);
  readonly answered = output<void>();
}

@Component({
  selector: 'app-progress-entries',
  template: 'entries for {{ clientId() }} / {{ clientName() }}',
})
class EntriesStub {
  readonly clientId = input<string | null>(null);
  readonly clientName = input<string | null>(null);
}

async function render(
  release: CoachClientDetails['release'] = null,
  blocked: { profile?: boolean; plans?: boolean } = {},
) {
  TestBed.configureTestingModule({ providers: [ClientWorkspaceContext, provideRouter([])] });
  TestBed.overrideComponent(ClientProgressSection, {
    set: {
      imports: [
        ButtonLink,
        DashboardStub,
        EntriesStub,
        RouterLink,
        UiDisclosure,
        UiDisclosureContent,
      ],
    },
  });
  const context = TestBed.inject(ClientWorkspaceContext);
  context.clientId.set('client-1');
  context.profile.set({
    id: 'client-1',
    firstName: 'Maya',
    release,
    isCoachBlocked: blocked.profile === true,
  } as CoachClientDetails);
  if (blocked.plans) {
    context.plans.set({ isRelationshipBlocked: true } as NonNullable<
      ReturnType<typeof context.plans>
    >);
  }
  const fixture = TestBed.createComponent(ClientProgressSection);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement };
}

describe('ClientProgressSection', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('shows the charts first, for this client, in the coach’s words', async () => {
    const { host } = await render();

    expect(host.querySelector('app-progress-dashboard')?.textContent).toBe(
      'dashboard for client-1 / Maya',
    );
  });

  it('keeps the entry tools collapsed, and does not load them until they are opened', async () => {
    const { fixture, host } = await render();
    const entries = fold(host, 'Entries and corrections');

    expect(entries.open).toBe(false);
    expect(entries.querySelector('summary .hint')?.textContent).toBe(
      'Record a weigh-in or measurement, fix a mistake, add or remove photos.',
    );
    expect(host.querySelector('app-progress-entries')).toBeNull();

    await toggleFold(fixture, host, 'Entries and corrections');
    expect(host.querySelector('app-progress-entries')?.textContent).toBe(
      'entries for client-1 / Maya',
    );

    // Closing it again keeps what it loaded, so reopening is instant and nothing is lost.
    await toggleFold(fixture, host, 'Entries and corrections', false);
    expect(host.querySelector('app-progress-entries')).not.toBeNull();
  });

  it('draws the entry tools once the charts above them have answered, so they are not pushed down (audit UIQ-5)', async () => {
    const { fixture, host } = await render();
    expect(host.querySelector('app-disclosure')?.classList).toContain('entries--waiting');

    fixture.debugElement.query(By.directive(DashboardStub)).componentInstance.answered.emit();
    await settle(fixture);

    expect(host.querySelector('app-disclosure')?.classList).not.toContain('entries--waiting');
  });

  it('offers no entry tools for a former client, whose record is read-only', async () => {
    const { fixture, host } = await render({
      releasedAtUtc: '2026-09-20T10:00:00Z',
      reason: 'Moved',
      releasedByName: 'Olivia Owner',
      departureKind: 'ReleasedByOwner',
    } as CoachClientDetails['release']);

    expect(host.querySelector('app-progress-dashboard')).not.toBeNull();
    expect(host.querySelector('details')).toBeNull();
    // Nor a correction of their start (critique B6).
    const dashboard = fixture.debugElement.query(By.directive(DashboardStub)).componentInstance;
    expect((dashboard as DashboardStub).readOnly()).toBe(true);
  });

  it('says why a blocked client’s progress is not shown, and where to unblock them (critique B6)', async () => {
    const { host } = await render(null, { profile: true });
    const panel = host.querySelector('section.blocked');

    expect(panel?.querySelector('h2')?.textContent?.trim()).toBe('Access blocked');
    expect(panel?.querySelector('p')?.textContent?.trim()).toBe(
      'Maya’s access is blocked, so their progress isn’t shown. Unblock them on Service & access.',
    );
    const link = panel?.querySelector<HTMLAnchorElement>('a');
    expect(link?.textContent?.trim()).toBe('Open Service & access');
    expect(link?.getAttribute('href')).toBe('/clients/client-1/service');
    // Nothing is read for a blocked client, so nothing can fail with "Try again".
    expect(host.querySelector('app-progress-dashboard')).toBeNull();
    expect(host.querySelector('details')).toBeNull();
  });

  it('trusts the plans’ answer too when it is the one that says the client is blocked', async () => {
    const { host } = await render(null, { plans: true });

    expect(host.querySelector('section.blocked')).not.toBeNull();
    expect(host.querySelector('app-progress-dashboard')).toBeNull();
  });
});
