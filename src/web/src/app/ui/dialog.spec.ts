import { Location } from '@angular/common';
import { provideLocationMocks } from '@angular/common/testing';
import { Component, inject, TemplateRef, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { press, query, settle } from '../../testing/dom';
import { UiDialog } from './dialog';
import type { ModalOptions } from './modal-surface';

@Component({
  template: `
    <button id="opener" type="button">Open</button>
    <div dir="rtl"><button id="arabic-opener" type="button">افتح</button></div>
    <ng-template #content let-dialog>
      <label for="reason">Why is it void?</label>
      <input id="reason" />
      <button type="button" (click)="dialog.close('voided')">Void invoice</button>
    </ng-template>
  `,
})
class Host {
  private readonly dialogs = inject(UiDialog);
  private readonly content = viewChild.required<TemplateRef<unknown>>('content');
  /** What each dialog closed with, in order. */
  readonly results: unknown[] = [];

  open(options: Partial<ModalOptions> = {}) {
    const ref = this.dialogs.open<string>(this.content(), {
      title: 'Void the invoice?',
      ...options,
    });
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
  const element = fixture.nativeElement as HTMLElement;
  // Focus starts on a button with no direction of its own, as on most pages.
  query<HTMLButtonElement>(element, '#opener').focus();
  return { fixture, host: fixture.componentInstance, element };
}

const dialogs = () => Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'));
const direction = () =>
  query<HTMLElement>(document, '.cdk-global-overlay-wrapper').getAttribute('dir');

/** Puts the page's own direction back as it was: an empty `dir` is still a `[dir]` to `closest`. */
function restoreDirection(direction: string | null): void {
  if (direction === null) document.documentElement.removeAttribute('dir');
  else document.documentElement.setAttribute('dir', direction);
}

describe('UiDialog', () => {
  let pageDirection: string | null = null;

  beforeEach(() => {
    pageDirection = document.documentElement.getAttribute('dir');
  });

  afterEach(() => {
    restoreDirection(pageDirection);
    TestBed.resetTestingModule();
    document.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());
  });

  it('opens in the middle of the screen, not from its foot as a sheet does', async () => {
    const { fixture, host } = await render();
    host.open();
    await settle(fixture);

    const pane = query<HTMLElement>(document, '.cdk-overlay-pane');
    expect([...pane.classList]).toEqual(
      expect.arrayContaining(['tb-modal-pane', 'tb-modal-pane--dialog']),
    );
    expect(pane.classList).not.toContain('tb-modal-pane--sheet');
    const wrapper = query<HTMLElement>(document, '.cdk-global-overlay-wrapper');
    expect(wrapper.style.alignItems).toBe('center');
    expect(wrapper.style.justifyContent).toBe('center');
    expect(document.querySelector('.cdk-overlay-backdrop.tb-modal-backdrop')).not.toBeNull();
  });

  it('hands its content the dialog itself, so an answer inside it closes the dialog with that answer', async () => {
    const { fixture, host } = await render();
    host.open();
    await settle(fixture);

    press(dialogs()[0], 'Void invoice');
    await settle(fixture);

    expect(host.results).toEqual(['voided']);
    expect(dialogs()).toHaveLength(0);
  });

  it('names its close button Close, or as the page words it', async () => {
    const { fixture, host } = await render();
    host.open();
    await settle(fixture);
    expect(dialogs()[0].querySelector('button[aria-label="Close"]')).not.toBeNull();
    press(dialogs()[0], 'Void invoice');
    await settle(fixture);

    host.open({ closeLabel: 'Keep the invoice' });
    await settle(fixture);
    expect(dialogs()[0].querySelector('button[aria-label="Close"]')).toBeNull();
    query<HTMLButtonElement>(dialogs()[0], 'button[aria-label="Keep the invoice"]').click();
    await settle(fixture);

    expect(dialogs()).toHaveLength(0);
    expect(host.results).toEqual(['voided', undefined]);
  });

  it('starts on its heading, or on the field a correction needs', async () => {
    const { fixture, host } = await render();
    host.open();
    await settle(fixture);
    expect(document.activeElement).toBe(query(dialogs()[0], 'h2'));
    press(dialogs()[0], 'Void invoice');
    await settle(fixture);

    host.open({ initialFocus: '#reason' });
    await settle(fixture);
    expect(document.activeElement).toBe(query(dialogs()[0], '#reason'));
  });

  it('closes when the person goes Back, unless the page keeps it open to ask first', async () => {
    const { fixture, host } = await render();
    const location = TestBed.inject(Location);
    location.go('/billing');
    host.open();
    await settle(fixture);
    location.back();
    await settle(fixture);
    expect(dialogs()).toHaveLength(0);

    location.go('/billing');
    host.open({ closeOnNavigation: false });
    await settle(fixture);
    location.back();
    await settle(fixture);
    expect(dialogs()).toHaveLength(1);
  });

  it('reads left to right on a left-to-right page', async () => {
    const { fixture, host } = await render();
    host.open();
    await settle(fixture);

    expect(direction()).toBe('ltr');
  });

  it('reads right to left on a right-to-left page, or where focus sits in a right-to-left part', async () => {
    const { fixture, host, element } = await render();
    document.documentElement.dir = 'rtl';
    host.open();
    await settle(fixture);
    expect(direction()).toBe('rtl');
    press(dialogs()[0], 'Void invoice');
    await settle(fixture);

    restoreDirection(pageDirection);
    query<HTMLButtonElement>(element, '#arabic-opener').focus();
    host.open();
    await settle(fixture);
    expect(direction()).toBe('rtl');
  });

  it('reads in the direction the page asks for, whatever the page around it', async () => {
    const { fixture, host, element } = await render();
    document.documentElement.dir = 'rtl';
    query<HTMLButtonElement>(element, '#arabic-opener').focus();
    host.open({ direction: 'ltr' });
    await settle(fixture);
    expect(direction()).toBe('ltr');
    press(dialogs()[0], 'Void invoice');
    await settle(fixture);

    restoreDirection(pageDirection);
    query<HTMLButtonElement>(element, '#opener').focus();
    host.open({ direction: 'rtl' });
    await settle(fixture);
    expect(direction()).toBe('rtl');
  });

  it('names each of two stacked dialogs by its own heading, and Escape closes only the top one', async () => {
    const { fixture, host } = await render();
    host.open();
    host.open({ title: 'Discard what you typed?' });
    await settle(fixture);

    const [first, second] = dialogs();
    expect(first.id).not.toBe(second.id);
    const name = (dialog: HTMLElement) =>
      document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent;
    expect(name(first)).toBe('Void the invoice?');
    expect(name(second)).toBe('Discard what you typed?');

    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }),
    );
    await settle(fixture);

    expect(dialogs()).toHaveLength(1);
    expect(name(dialogs()[0])).toBe('Void the invoice?');
  });
});
