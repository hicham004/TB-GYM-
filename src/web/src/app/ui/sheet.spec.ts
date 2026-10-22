import { Location } from '@angular/common';
import { provideLocationMocks } from '@angular/common/testing';
import { Component, inject, TemplateRef, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { press, query, settle } from '../../testing/dom';
import type { ModalOptions } from './modal-surface';
import { UiSheet } from './sheet';

@Component({
  template: `
    <button id="opener" type="button">Open</button>
    <ng-template #content let-sheet>
      <label for="plan-note">Note for Maya</label>
      <input id="plan-note" />
      <button type="button" (click)="sheet.close('saved')">Save plan</button>
    </ng-template>
  `,
})
class Host {
  private readonly sheets = inject(UiSheet);
  private readonly content = viewChild.required<TemplateRef<unknown>>('content');
  /** What each sheet closed with, in order. */
  readonly results: unknown[] = [];

  open(options: Partial<ModalOptions> = {}) {
    const ref = this.sheets.open<string>(this.content(), { title: 'Plan changes', ...options });
    ref.closed.subscribe((result) => this.results.push(result));
    return ref;
  }
}

async function render() {
  await TestBed.configureTestingModule({
    imports: [Host],
    providers: [provideLocationMocks()],
  }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  await settle(fixture);
  // Focus starts on a button with no direction of its own, as on most pages.
  query<HTMLButtonElement>(fixture.nativeElement as HTMLElement, '#opener').focus();
  return { fixture, host: fixture.componentInstance };
}

const sheets = () => Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'));
const pane = () => query<HTMLElement>(document, '.cdk-overlay-pane');

function escape(): void {
  (document.activeElement ?? document.body).dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }),
  );
}

describe('UiSheet', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    document.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());
  });

  it('rises from the bottom edge, centred, as wide as the screen up to 40rem, over a backdrop', async () => {
    const { fixture, host } = await render();
    host.open();
    await settle(fixture);

    expect([...pane().classList]).toEqual(
      expect.arrayContaining(['tb-modal-pane', 'tb-modal-pane--sheet']),
    );
    expect(pane().classList).not.toContain('tb-modal-pane--dialog');
    expect(pane().classList).not.toContain('tb-modal-pane--printable');
    const wrapper = query<HTMLElement>(document, '.cdk-global-overlay-wrapper');
    expect(wrapper.style.alignItems).toBe('flex-end');
    expect(wrapper.style.justifyContent).toBe('center');
    expect(pane().style.width).toBe('100vw');
    expect(pane().style.maxWidth).toBe('40rem');
    expect(document.querySelector('.cdk-overlay-backdrop.tb-modal-backdrop')).not.toBeNull();
  });

  it('marks a sheet that prints alone when the page asks for it', async () => {
    const { fixture, host } = await render();
    host.open({ printable: true });
    await settle(fixture);

    expect(pane().classList).toContain('tb-modal-pane--printable');
    expect(pane().classList).toContain('tb-modal-pane--sheet');
  });

  it('names its close button Close, or as the page words it, and closes with it', async () => {
    const { fixture, host } = await render();
    host.open();
    await settle(fixture);
    const header = query<HTMLElement>(sheets()[0], '.tb-modal__header');
    query<HTMLButtonElement>(header, 'button[aria-label="Close"]').click();
    await settle(fixture);
    expect(sheets()).toHaveLength(0);

    host.open({ closeLabel: 'Close the plan changes' });
    await settle(fixture);
    expect(sheets()[0].querySelector('button[aria-label="Close"]')).toBeNull();
    query<HTMLButtonElement>(sheets()[0], 'button[aria-label="Close the plan changes"]').click();
    await settle(fixture);

    expect(sheets()).toHaveLength(0);
    // Closed by its cross, a sheet says nothing about what happened.
    expect(host.results).toEqual([undefined, undefined]);
  });

  it('starts on its heading, or on the field a correction needs', async () => {
    const { fixture, host } = await render();
    host.open();
    await settle(fixture);
    expect(document.activeElement).toBe(query(sheets()[0], 'h2'));
    press(sheets()[0], 'Save plan');
    await settle(fixture);

    host.open({ initialFocus: '#plan-note' });
    await settle(fixture);
    expect(document.activeElement).toBe(query(sheets()[0], '#plan-note'));
  });

  it('closes when the person goes Back, unless the page keeps it open to ask first', async () => {
    const { fixture, host } = await render();
    const location = TestBed.inject(Location);
    location.go('/plans');
    host.open();
    await settle(fixture);

    location.back();
    await settle(fixture);
    expect(sheets()).toHaveLength(0);

    location.go('/plans');
    host.open({ closeOnNavigation: false });
    await settle(fixture);
    location.back();
    await settle(fixture);

    // A leave guard is asked after the address has already changed, so the sheet has to stay.
    expect(sheets()).toHaveLength(1);
    expect(query(sheets()[0], 'h2').textContent).toBe('Plan changes');
  });

  it('gives each open sheet its own name, read from its own heading', async () => {
    const { fixture, host } = await render();
    host.open();
    host.open({ title: 'Record a payment' });
    await settle(fixture);

    const [first, second] = sheets();
    expect(first.id).not.toBe(second.id);
    const name = (sheet: HTMLElement) =>
      document.getElementById(sheet.getAttribute('aria-labelledby')!)?.textContent;
    expect(name(first)).toBe('Plan changes');
    expect(name(second)).toBe('Record a payment');
    expect(first.contains(document.getElementById(first.getAttribute('aria-labelledby')!))).toBe(
      true,
    );
  });

  it('asks a guarded sheet’s question once at a time, however often the person presses Escape', async () => {
    const { fixture, host } = await render();
    let asked = 0;
    let answer: (allowed: boolean) => void = () => undefined;
    host.open({
      canClose: () => {
        asked++;
        return new Promise<boolean>((resolve) => (answer = resolve));
      },
    });
    await settle(fixture);

    escape();
    escape();
    query<HTMLButtonElement>(sheets()[0], 'button[aria-label="Close"]').click();
    await settle(fixture);
    expect(asked).toBe(1);

    answer(false);
    await settle(fixture);
    expect(sheets()).toHaveLength(1);

    // Once the person has answered, the next Escape asks again.
    escape();
    await settle(fixture);
    expect(asked).toBe(2);
    answer(true);
    await settle(fixture);
    expect(sheets()).toHaveLength(0);
  });
});
