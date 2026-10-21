import { Component, signal, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { settle } from '../../testing/dom';
import { FormSummary } from './form-summary';

@Component({
  imports: [FormSummary],
  template: `
    <form>
      <input id="box" />
      <app-form-summary>
        @if (message(); as text) {
          {{ text }}
        }
      </app-form-summary>
      <button id="save" type="submit">Save</button>
    </form>
  `,
})
class Host {
  readonly message = signal<string | null>(null);
  readonly summary = viewChild.required(FormSummary);
}

async function render() {
  await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  await settle(fixture);
  const host = fixture.nativeElement as HTMLElement;
  return {
    fixture,
    host,
    region: host.querySelector('app-form-summary') as HTMLElement,
  };
}

describe('app-form-summary', () => {
  it('is an assertive region from the first render, empty and out of the tab order', async () => {
    const { region } = await render();

    expect(region).not.toBeNull();
    expect(region.getAttribute('role')).toBe('alert');
    expect(region.getAttribute('tabindex')).toBe('-1');
    expect(region.textContent?.trim()).toBe('');
    // Nothing but the block's anchor inside: the hidden empty look applies, with no stray text node.
    expect(region.matches(':empty')).toBe(true);
  });

  it('says what the form puts in it, and goes quiet again when the form clears it', async () => {
    const { fixture, host, region } = await render();

    fixture.componentInstance.message.set('The plan could not be saved. Try again.');
    await settle(fixture);
    expect(host.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(region.textContent?.trim()).toBe('The plan could not be saved. Try again.');
    expect(region.matches(':empty')).toBe(false);

    fixture.componentInstance.message.set(null);
    await settle(fixture);
    expect(region.textContent?.trim()).toBe('');
    expect(region.matches(':empty')).toBe(true);
  });

  it('takes focus once its words are drawn, so a refusal is read where the person is', async () => {
    const { fixture, host, region } = await render();
    (host.querySelector('#save') as HTMLButtonElement).focus();

    fixture.componentInstance.message.set('Someone changed this plan. Close it and open it again.');
    fixture.componentInstance.summary().focus();
    await settle(fixture);

    expect(document.activeElement).toBe(region);
  });

  it('leaves focus where it is when it has nothing to say', async () => {
    const { fixture, host } = await render();
    const save = host.querySelector('#save') as HTMLButtonElement;
    save.focus();

    fixture.componentInstance.summary().focus();
    await settle(fixture);

    expect(document.activeElement).toBe(save);
  });
});
