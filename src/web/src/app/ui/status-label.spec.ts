import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { settle } from '../../testing/dom';
import { StatusLabel } from './status-label';

@Component({
  imports: [StatusLabel],
  template: `
    <app-status-label id="neutral" label="Archived" />
    <app-status-label id="success" label="Active" tone="success" marker="check" />
    <app-status-label id="warning" label="Unsaved changes" tone="warning" />
    <app-status-label id="danger" label="Access paused" tone="danger" />
  `,
})
class Host {}

async function render(): Promise<HTMLElement> {
  await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  await settle(fixture);
  return fixture.nativeElement as HTMLElement;
}

describe('app-status-label', () => {
  it('states every tone in words, so colour is never the only signal', async () => {
    const host = await render();
    const read = (id: string) => host.querySelector(`#${id}`)?.textContent?.trim();

    expect(read('neutral')).toBe('Archived');
    expect(read('success')).toBe('Active');
    expect(read('warning')).toBe('Unsaved changes');
    expect(read('danger')).toBe('Access paused');
  });

  it('keeps the marker decorative and colours only the marker by tone', async () => {
    const host = await render();

    const dot = host.querySelector('#danger .dot');
    expect(dot?.getAttribute('aria-hidden')).toBe('true');
    expect(host.querySelector('#danger')?.classList).toContain('tone-danger');
    expect(host.querySelector('#success app-icon')?.getAttribute('aria-hidden')).toBe('true');
    expect(host.querySelector('#neutral')?.className ?? '').not.toContain('tone-');
  });

  it('is plain text rather than a live region', async () => {
    const host = await render();

    expect(host.querySelector('app-status-label[role], app-status-label [role]')).toBeNull();
    expect(host.querySelector('[aria-live]')).toBeNull();
  });
});
