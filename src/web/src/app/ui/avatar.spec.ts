import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { settle } from '../../testing/dom';
import { Avatar } from './avatar';

@Component({
  imports: [Avatar],
  template: `
    <p><app-avatar id="coach" initials="SC" presentation="coach-account" />Sample Coach</p>
    <app-avatar id="client" initials="MR" />
    <app-avatar id="arabic" initials="م ت" presentation="message-sender" />
  `,
})
class Host {}

async function render(): Promise<HTMLElement> {
  await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  await settle(fixture);
  return fixture.nativeElement as HTMLElement;
}

describe('app-avatar', () => {
  it('shows the initials it is given, under the named preset', async () => {
    const host = await render();

    expect(host.querySelector('#coach')?.textContent?.trim()).toBe('SC');
    expect(host.querySelector('#coach')?.classList).toContain('coach-account');
    expect(host.querySelector('#client')?.classList).toContain('client');
  });

  it('is hidden from assistive technology, leaving the name to the adjacent text', async () => {
    const host = await render();

    expect(host.querySelector('#coach')?.getAttribute('aria-hidden')).toBe('true');
    expect(host.querySelector('p')?.textContent).toContain('Sample Coach');
  });

  it('keeps initials from another script in their own reading order', async () => {
    const host = await render();

    expect(host.querySelector('#arabic')?.getAttribute('dir')).toBe('auto');
  });
});
