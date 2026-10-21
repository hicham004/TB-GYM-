import { Component, input, output } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { afterEach, describe, expect, it } from 'vitest';
import type { CoachClientDetails } from '../../core/api/api.models';
import { settle } from '../../../testing/dom';
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

async function render(release: CoachClientDetails['release'] = null) {
  TestBed.configureTestingModule({ providers: [ClientWorkspaceContext] });
  TestBed.overrideComponent(ClientProgressSection, {
    set: { imports: [DashboardStub, EntriesStub] },
  });
  const context = TestBed.inject(ClientWorkspaceContext);
  context.clientId.set('client-1');
  context.profile.set({ id: 'client-1', firstName: 'Maya', release } as CoachClientDetails);
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
    const details = host.querySelector('details')!;

    expect(details.open).toBe(false);
    expect(host.querySelector('summary')?.textContent).toContain('Entries and corrections');
    expect(host.querySelector('app-progress-entries')).toBeNull();

    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    await settle(fixture);
    expect(host.querySelector('app-progress-entries')?.textContent).toBe(
      'entries for client-1 / Maya',
    );

    // Closing it again keeps what it loaded, so reopening is instant and nothing is lost.
    details.open = false;
    details.dispatchEvent(new Event('toggle'));
    await settle(fixture);
    expect(host.querySelector('app-progress-entries')).not.toBeNull();
  });

  it('draws the entry tools once the charts above them have answered, so they are not pushed down (audit UIQ-5)', async () => {
    const { fixture, host } = await render();
    expect(host.querySelector('details')?.classList).toContain('entries--waiting');

    fixture.debugElement.query(By.directive(DashboardStub)).componentInstance.answered.emit();
    await settle(fixture);

    expect(host.querySelector('details')?.classList).not.toContain('entries--waiting');
  });

  it('offers no entry tools for a former client, whose record is read-only', async () => {
    const { host } = await render({
      releasedAtUtc: '2026-09-20T10:00:00Z',
      reason: 'Moved',
      releasedByName: 'Olivia Owner',
      departureKind: 'ReleasedByOwner',
    } as CoachClientDetails['release']);

    expect(host.querySelector('app-progress-dashboard')).not.toBeNull();
    expect(host.querySelector('details')).toBeNull();
  });
});
