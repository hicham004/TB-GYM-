import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { settle } from '../../testing/dom';
import { AvatarStack } from './avatar-stack';
import { EmptyState } from './empty-state';
import { ProgressRing } from './progress-ring';
import { Skeleton } from './skeleton';
import { sparklineGeometry, Sparkline } from './sparkline';
import { StatTile } from './stat-tile';
import { StatusPill } from './status-pill';

@Component({
  imports: [AvatarStack, EmptyState, ProgressRing, Skeleton, Sparkline, StatTile, StatusPill],
  template: `
    <app-avatar-stack
      [people]="[
        { name: 'Maya Rahman', initials: 'MR' },
        { name: 'Rami Khoury', initials: 'RK' },
        { name: 'Lina Saleh', initials: 'LS' },
      ]"
      label="Clients"
      [maxVisible]="2"
    />
    <app-status-pill label="Needs attention" tone="warning" />
    <app-empty-state heading="Nothing to review" description="New check-ins will appear here.">
      <button empty-state-action type="button">Invite a client</button>
    </app-empty-state>
    <app-skeleton label="Loading clients" [lines]="3" [avatar]="true" />
    <app-progress-ring [value]="completion()" [max]="100" label="Weekly completion" />
    <app-sparkline [values]="[2, 3, 4]" summary="Sessions rose from two to four this week" />
    <app-stat-tile
      label="Sessions done this week"
      value="92%"
      context="Up 6% from this point last week"
      [trend]="{ values: [70, 80, 92], summary: 'Completion rose this week' }"
    />
  `,
})
class Host {
  readonly completion = signal(125);
}

async function render() {
  await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  await settle(fixture);
  return fixture;
}

describe('sparkline geometry', () => {
  it('keeps time order and fits a changing series into the chart bounds', () => {
    const geometry = sparklineGeometry([10, 20, 15]);

    expect(geometry.line).toBe('M 4.00 44.00 L 60.00 4.00 L 116.00 24.00');
    expect(geometry.area).toBe('M 4.00 44 L 4.00 44.00 L 60.00 4.00 L 116.00 24.00 L 116.00 44 Z');
    expect(geometry.last).toEqual({ x: 116, y: 24 });
  });

  it('centres a flat series and leaves missing or invalid data undrawn', () => {
    expect(sparklineGeometry([5, 5]).line).toBe('M 4.00 24.00 L 116.00 24.00');
    expect(sparklineGeometry([5]).last).toEqual({ x: 60, y: 24 });
    expect(sparklineGeometry([]).line).toBe('');
    expect(sparklineGeometry([1, Number.NaN]).line).toBe('');
  });
});

describe('display primitives', () => {
  it('provides text equivalents for the sparkline, progress ring, and hidden avatar names', async () => {
    const fixture = await render();
    const host = fixture.nativeElement as HTMLElement;
    const stack = host.querySelector('app-avatar-stack');
    const ring = host.querySelector('app-progress-ring svg');
    const sparkline = host.querySelector('app-sparkline');

    expect(stack?.getAttribute('aria-label')).toBe('Clients: Maya Rahman, Rami Khoury, Lina Saleh');
    expect(stack?.textContent).toContain('+1');
    expect(ring?.getAttribute('role')).toBe('progressbar');
    expect(ring?.getAttribute('aria-label')).toBe('Weekly completion');
    expect(ring?.getAttribute('aria-valuenow')).toBe('100');
    expect(ring?.getAttribute('aria-valuetext')).toBe('100%');
    expect(sparkline?.textContent).toContain('Sessions rose from two to four this week');
    expect(sparkline?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');

    fixture.componentInstance.completion.set(-5);
    await settle(fixture);
    expect(ring?.getAttribute('aria-valuenow')).toBe('0');
    expect(ring?.getAttribute('aria-valuetext')).toBe('0%');
  });

  it('keeps context, status, loading text and the empty-state action visible or announced', async () => {
    const host = (await render()).nativeElement as HTMLElement;

    expect(host.querySelector('app-stat-tile')?.textContent).toContain(
      'Up 6% from this point last week',
    );
    expect(host.querySelector('app-status-pill')?.textContent).toContain('Needs attention');
    expect(host.querySelector('app-skeleton')?.getAttribute('role')).toBe('status');
    expect(host.querySelector('app-skeleton')?.textContent).toContain('Loading clients');
    expect(host.querySelector('app-empty-state button')?.textContent).toContain('Invite a client');
  });
});
