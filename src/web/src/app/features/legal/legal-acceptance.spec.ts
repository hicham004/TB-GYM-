import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { field, query, settle, tick } from '../../../testing/dom';
import { LegalAcceptance } from './legal-acceptance';
import type { LegalToAccept } from './legal.models';

// The sentences are placeholders for the tests, not legal wording.
const DOCUMENTS: LegalToAccept[] = [
  {
    id: 'terms-1',
    kind: 'TermsOfService',
    name: 'Terms of Service',
    version: '2026-11',
    statement: 'Placeholder sentence for the terms.',
    culture: 'en',
    link: '/legal/terms-1',
  },
  {
    id: 'health-1',
    kind: 'HealthIntakeConsent',
    name: 'Health intake consent',
    version: '1',
    statement: 'جملة تجريبية.',
    culture: 'ar',
    link: '/legal/health-1',
  },
];

@Component({
  imports: [LegalAcceptance],
  template: `<app-legal-acceptance
    [documents]="documents"
    [accepted]="accepted()"
    [showReasons]="tried()"
    (toggled)="toggle($event)"
  />`,
})
class Host {
  readonly documents = DOCUMENTS;
  readonly accepted = signal<ReadonlySet<string>>(new Set());
  readonly tried = signal(false);
  readonly changes: { id: string; checked: boolean }[] = [];

  toggle(change: { id: string; checked: boolean }): void {
    this.changes.push(change);
    const next = new Set(this.accepted());
    if (change.checked) next.add(change.id);
    else next.delete(change.id);
    this.accepted.set(next);
  }
}

async function render() {
  const fixture = TestBed.createComponent(Host);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, page: fixture.componentInstance };
}

describe('LegalAcceptance', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('puts each sentence beside its own box, and the text a link away in a new tab', async () => {
    const { host } = await render();

    expect(query(host, 'legend').textContent?.trim()).toBe('Legal documents');
    const terms = field(host, 'Placeholder sentence for the terms.');
    expect(terms.type).toBe('checkbox');
    expect(terms.checked).toBe(false);
    expect(terms.getAttribute('aria-describedby')).toBe('legal-read-terms-1');
    const read = query<HTMLAnchorElement>(host, '#legal-read-health-1');
    expect(read.getAttribute('href')).toBe('/legal/health-1');
    expect(read.target).toBe('_blank');
    expect(read.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Read the Health intake consent (version 1), opens in a new tab',
    );
  });

  it('reports each tick, and says under a box still unticked why once a submit was refused', async () => {
    const { fixture, host, page } = await render();

    tick(host, 'Placeholder sentence for the terms.');
    await settle(fixture);
    expect(page.changes).toEqual([{ id: 'terms-1', checked: true }]);
    expect(host.querySelector('.reason')).toBeNull();

    page.tried.set(true);
    await settle(fixture);
    expect(host.querySelector('#legal-reason-terms-1')).toBeNull();
    expect(query(host, '#legal-reason-health-1').textContent?.trim()).toBe(
      'Tick this box to continue.',
    );
    expect(field(host, 'جملة تجريبية.').getAttribute('aria-describedby')).toBe(
      'legal-reason-health-1 legal-read-health-1',
    );
    // The box still to tick is marked wrong while its reason shows; the ticked one is not.
    expect(field(host, 'جملة تجريبية.').getAttribute('aria-invalid')).toBe('true');
    expect(
      field(host, 'Placeholder sentence for the terms.').getAttribute('aria-invalid'),
    ).toBeNull();

    tick(host, 'Placeholder sentence for the terms.', false);
    await settle(fixture);
    expect(page.changes.at(-1)).toEqual({ id: 'terms-1', checked: false });
    expect(host.querySelector('#legal-reason-terms-1')).not.toBeNull();
  });
});
