import { Component, inject, TemplateRef, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { press, query, settle } from '../../testing/dom';
import { UiDialog } from './dialog';
import { UiSheet } from './sheet';

@Component({
  template: `
    <div dir="rtl">
      <button id="open-dialog" type="button" (click)="openDialog()">Open dialog</button>
      <button id="open-sheet" type="button" (click)="openSheet()">Open sheet</button>
      <button id="open-guarded" type="button" (click)="openGuarded()">Open guarded sheet</button>
      <button id="open-dark" type="button" (click)="openDark()">Open dark sheet</button>
    </div>
    <ng-template #content let-modal>
      <p>Changes to this plan are ready.</p>
      <button type="button" (click)="modal.close('saved')">Save plan</button>
    </ng-template>
  `,
})
class Host {
  private readonly dialogs = inject(UiDialog);
  private readonly sheets = inject(UiSheet);
  private readonly content = viewChild.required<TemplateRef<unknown>>('content');
  result?: string;
  /** What the guarded sheet answers when asked whether it may close. */
  allowClose = false;
  asked = 0;

  openDialog(): void {
    const ref = this.dialogs.open<string>(this.content(), { title: 'Plan changes' });
    ref.closed.subscribe((result) => (this.result = result));
  }

  openSheet(): void {
    const ref = this.sheets.open<string>(this.content(), { title: 'Plan changes' });
    ref.closed.subscribe((result) => (this.result = result));
  }

  openDark(): void {
    this.sheets.open<string>(this.content(), { title: 'Plan changes', mode: 'dark' });
  }

  openGuarded(): void {
    this.sheets.open<string>(this.content(), {
      title: 'Plan changes',
      closeLabel: 'Close',
      canClose: async () => {
        this.asked++;
        return this.allowClose;
      },
    });
  }
}

async function render() {
  await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement };
}

describe('UI modal surfaces', () => {
  it('names the dialog, traps focus, passes a result, and returns focus to the opener', async () => {
    const { fixture, host } = await render();
    const opener = query<HTMLButtonElement>(host, '#open-dialog');
    opener.focus();
    press(host, 'Open dialog');
    await settle(fixture);

    const dialog = query<HTMLElement>(document, '[role="dialog"]');
    const title = query<HTMLElement>(dialog, 'h2');
    expect(title.textContent).toBe('Plan changes');
    expect(dialog.getAttribute('aria-labelledby')).toBe(title.id);
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(dialog.closest('.cdk-global-overlay-wrapper')?.getAttribute('dir')).toBe('rtl');

    press(dialog, 'Save plan');
    await settle(fixture);
    expect(fixture.componentInstance.result).toBe('saved');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('anchors a sheet at the bottom and closes it with Escape', async () => {
    const { fixture, host } = await render();
    const opener = query<HTMLButtonElement>(host, '#open-sheet');
    opener.focus();
    press(host, 'Open sheet');
    await settle(fixture);

    const sheet = query<HTMLElement>(document, '.tb-modal-pane--sheet [role="dialog"]');
    expect(sheet.querySelector('h2')?.textContent).toBe('Plan changes');
    expect(sheet.closest('.cdk-global-overlay-wrapper')?.getAttribute('style')).toContain(
      'align-items: flex-end',
    );
    expect(sheet.contains(document.activeElement)).toBe(true);

    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }),
    );
    await settle(fixture);
    expect(document.querySelector('.tb-modal-pane--sheet')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('asks before Escape, the backdrop or the close button closes a guarded sheet', async () => {
    const { fixture, host } = await render();
    press(host, 'Open guarded sheet');
    await settle(fixture);
    const sheet = query<HTMLElement>(document, '.tb-modal-pane--sheet [role="dialog"]');

    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }),
    );
    await settle(fixture);
    query<HTMLElement>(document, '.tb-modal-backdrop').click();
    await settle(fixture);
    expect(fixture.componentInstance.asked).toBe(2);
    expect(document.querySelector('.tb-modal-pane--sheet')).not.toBeNull();

    fixture.componentInstance.allowClose = true;
    query<HTMLButtonElement>(sheet, 'button[aria-label="Close"]').click();
    await settle(fixture);
    expect(fixture.componentInstance.asked).toBe(3);
    expect(document.querySelector('.tb-modal-pane--sheet')).toBeNull();
  });

  it('draws a sheet in the mode asked for, and in the person’s mode otherwise', async () => {
    const { fixture, host } = await render();
    press(host, 'Open dark sheet');
    await settle(fixture);
    const dark = query<HTMLElement>(document, '.tb-modal-pane--sheet');
    expect(dark.dataset['mode']).toBe('dark');
    press(query<HTMLElement>(dark, '[role="dialog"]'), 'Save plan');
    await settle(fixture);

    press(host, 'Open sheet');
    await settle(fixture);
    const plain = query<HTMLElement>(document, '.tb-modal-pane--sheet');
    expect(plain.dataset['mode']).toBeUndefined();
    press(query<HTMLElement>(plain, '[role="dialog"]'), 'Save plan');
    await settle(fixture);
  });

  it('still closes when the page closes it itself, without asking', async () => {
    const { fixture, host } = await render();
    press(host, 'Open guarded sheet');
    await settle(fixture);

    press(query<HTMLElement>(document, '[role="dialog"]'), 'Save plan');
    await settle(fixture);
    expect(fixture.componentInstance.asked).toBe(0);
    expect(document.querySelector('.tb-modal-pane--sheet')).toBeNull();
  });
});
