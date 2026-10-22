import { Component, TemplateRef, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { field, fill, press, query, settle } from '../../../testing/dom';
import { UiConfirm } from '../../ui/confirm';
import { TenantContext } from '../tenancy/tenant-context';
import { GuardedSheets, type LeaveQuestion } from './guarded-sheets';
import { UnsavedWork } from './unsaved-work';

const TEMPLATE = `
  <button type="button" (click)="openEditor()">Edit the plan</button>
  <ng-template #editor let-sheet>
    <label><span>Plan name</span><input (input)="dirty = true" /></label>
    <button type="button" (click)="openNotes()">Go to the notes</button>
    <button type="button" (click)="closeAsking(sheet)">Not now</button>
    <button type="button" (click)="done(sheet, 'Plan saved.')">Save plan</button>
  </ng-template>
  <ng-template #notes let-sheet>
    <p>Notes for the plan.</p>
    <button type="button" (click)="closeAsking(sheet)">Not now</button>
  </ng-template>
  <ng-template #question let-dialog>
    @if (asking(); as question) {
      <app-confirm
        [message]="question.message"
        [confirmLabel]="question.confirm"
        [cancelLabel]="question.cancel"
        (answer)="dialog.close($event)"
      />
    }
  </ng-template>
`;

/** A page with two sheets, built on the base the way the app's sheet hosts are. */
@Component({ imports: [UiConfirm], template: TEMPLATE })
class PlanSheets extends GuardedSheets {
  private readonly editor = viewChild.required<TemplateRef<unknown>>('editor');
  private readonly notes = viewChild.required<TemplateRef<unknown>>('notes');
  private readonly question = viewChild.required<TemplateRef<unknown>>('question');
  /** What each sheet closed with, in the order they closed. */
  readonly results: unknown[] = [];

  protected confirmDialog(): TemplateRef<unknown> {
    return this.question();
  }

  openEditor(): void {
    this.show(this.editor(), 'Edit the plan').closed.subscribe((result) =>
      this.results.push(result),
    );
  }

  openNotes(): void {
    this.show(this.notes(), 'Plan notes').closed.subscribe((result) => this.results.push(result));
  }
}

/** The same page asking in its own words, as Team does. */
@Component({ imports: [UiConfirm], template: TEMPLATE })
class WordedPlanSheets extends PlanSheets {
  protected override readonly leaveQuestion: LeaveQuestion = {
    title: 'Close without sending?',
    message: 'What you typed isn’t sent. If you close it now, it is lost.',
    confirm: 'Close without sending',
    cancel: 'Keep editing',
  };
}

async function render(page: typeof PlanSheets = PlanSheets) {
  TestBed.configureTestingModule({ imports: [page] });
  const fixture = TestBed.createComponent(page);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, page: fixture.componentInstance };
}

const normalize = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();

/** The open sheet, which the CDK draws outside the page. */
const sheet = () => document.querySelector<HTMLElement>('.tb-modal-pane--sheet [role="dialog"]');
/** The leave question, a dialog over the sheet. */
const question = () =>
  document.querySelector<HTMLElement>('.tb-modal-pane--dialog [role="dialog"]');
const titleOf = (surface: HTMLElement | null) =>
  normalize(surface?.querySelector('h2')?.textContent);

/**
 * The backdrop behind the open sheet: just before the overlay that holds its pane where the browser
 * has no popovers (jsdom), inside that overlay where it has.
 */
function backdropOfSheet(): HTMLElement {
  const overlay = query<HTMLElement>(document, '.tb-modal-pane--sheet').parentElement;
  const backdrop = [overlay?.previousElementSibling, ...Array.from(overlay?.children ?? [])].find(
    (element) => element?.classList.contains('tb-modal-backdrop'),
  );
  if (!(backdrop instanceof HTMLElement)) throw new Error('The sheet has no backdrop.');
  return backdrop;
}

/** The four ways a person closes a sheet themselves. */
const CLOSES: [string, () => void][] = [
  [
    'the close button',
    () => query<HTMLButtonElement>(sheet()!, 'button[aria-label="Close"]').click(),
  ],
  [
    'Escape',
    () =>
      sheet()!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }),
      ),
  ],
  ['the backdrop', () => backdropOfSheet().click()],
  ['its own Not now', () => press(sheet()!, 'Not now')],
];

/**
 * Whether a reload or a closed tab would be asked to wait. A BeforeUnloadEvent, as the browser sends:
 * on a plain Event jsdom takes `returnValue = ''` for a cancel, which no browser does.
 */
function reloadHeld(): boolean {
  const event = document.createEvent('BeforeUnloadEvent');
  event.initEvent('beforeunload', false, true);
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

async function typeIntoTheSheet(fixture: Parameters<typeof settle>[0], value = 'Spring block') {
  fill(sheet()!, 'Plan name', value);
  await settle(fixture);
}

afterEach(() => {
  TestBed.resetTestingModule();
  document.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());
});

describe('GuardedSheets', () => {
  it('opens a sheet with the title asked for, and a sheet opened from it takes its place', async () => {
    const { fixture, host, page } = await render();

    press(host, 'Edit the plan');
    await settle(fixture);
    expect(titleOf(sheet())).toBe('Edit the plan');

    await typeIntoTheSheet(fixture);
    press(sheet()!, 'Go to the notes');
    await settle(fixture);
    expect(document.querySelectorAll('.tb-modal-pane--sheet')).toHaveLength(1);
    expect(titleOf(sheet())).toBe('Plan notes');
    expect(page.results).toHaveLength(1);

    // The new sheet starts with nothing typed, so it closes without a question.
    press(sheet()!, 'Not now');
    await settle(fixture);
    expect(question()).toBeNull();
    expect(sheet()).toBeNull();
  });

  it.each(CLOSES)('closes at once with %s when nothing is typed', async (_, close) => {
    const { fixture, host } = await render();
    press(host, 'Edit the plan');
    await settle(fixture);

    close();
    await settle(fixture);

    expect(question()).toBeNull();
    expect(sheet()).toBeNull();
  });

  it.each(CLOSES)(
    'asks before %s closes typed work, keeps it on Keep editing and closes on Discard',
    async (_, close) => {
      const { fixture, host } = await render();
      press(host, 'Edit the plan');
      await settle(fixture);
      await typeIntoTheSheet(fixture);

      close();
      await settle(fixture);
      const asking = question();
      expect(titleOf(asking)).toBe('Discard what you typed?');
      expect(normalize(asking?.querySelector('app-confirm .message')?.textContent)).toBe(
        'Close without saving? What you typed will be lost.',
      );
      press(asking!, 'Keep editing');
      await settle(fixture);
      expect(question()).toBeNull();
      expect(titleOf(sheet())).toBe('Edit the plan');
      expect(field(sheet()!, 'Plan name').value).toBe('Spring block');

      close();
      await settle(fixture);
      press(question()!, 'Discard');
      await settle(fixture);
      expect(question()).toBeNull();
      expect(sheet()).toBeNull();
    },
  );

  it('keeps the typed work when the question itself is closed rather than answered', async () => {
    const { fixture, host } = await render();
    press(host, 'Edit the plan');
    await settle(fixture);
    await typeIntoTheSheet(fixture);

    press(sheet()!, 'Not now');
    await settle(fixture);
    query<HTMLButtonElement>(question()!, 'button[aria-label="Close"]').click();
    await settle(fixture);

    expect(question()).toBeNull();
    expect(field(sheet()!, 'Plan name').value).toBe('Spring block');
  });

  it('asks in the host’s own words when it gives its own question', async () => {
    const { fixture, host } = await render(WordedPlanSheets);
    press(host, 'Edit the plan');
    await settle(fixture);
    await typeIntoTheSheet(fixture);

    press(sheet()!, 'Not now');
    await settle(fixture);
    const asking = question();
    expect(titleOf(asking)).toBe('Close without sending?');
    expect(normalize(asking?.querySelector('app-confirm .message')?.textContent)).toBe(
      'What you typed isn’t sent. If you close it now, it is lost.',
    );
    press(asking!, 'Close without sending');
    await settle(fixture);
    expect(sheet()).toBeNull();
  });

  it('closes a sheet that saved without asking, and says so in a toast', async () => {
    const { fixture, host, page } = await render();
    press(host, 'Edit the plan');
    await settle(fixture);
    await typeIntoTheSheet(fixture);

    press(sheet()!, 'Save plan');
    await settle(fixture);

    expect(question()).toBeNull();
    expect(sheet()).toBeNull();
    expect(page.results).toEqual([true]);
    const toast = query<HTMLElement>(document, '.tb-toast');
    expect(normalize(toast.querySelector('.tb-toast__message')?.textContent)).toBe('Plan saved.');
    expect(toast.classList).toContain('tb-toast--success');
  });

  it('lets a workspace switch or a sign-out go ahead without a question when nothing is typed', async () => {
    const { fixture, host } = await render();
    press(host, 'Edit the plan');
    await settle(fixture);

    const leaving = TestBed.inject(UnsavedWork).confirmLeave();
    await settle(fixture);
    expect(question()).toBeNull();
    expect(await leaving).toBe(true);
    // Nothing was lost, so nothing is closed either.
    expect(titleOf(sheet())).toBe('Edit the plan');
  });

  it('asks a switch or a sign-out before typed work goes, and closes the sheet with the work given up', async () => {
    const { fixture, host } = await render();
    press(host, 'Edit the plan');
    await settle(fixture);
    await typeIntoTheSheet(fixture);

    const leaving = TestBed.inject(UnsavedWork).confirmLeave();
    await settle(fixture);
    expect(titleOf(question())).toBe('Discard what you typed?');
    press(question()!, 'Discard');
    await settle(fixture);

    expect(question()).toBeNull();
    expect(await leaving).toBe(true);
    expect(sheet()).toBeNull();
  });

  it('keeps the sheet and its draft when the person keeps editing instead of switching', async () => {
    const { fixture, host } = await render();
    press(host, 'Edit the plan');
    await settle(fixture);
    await typeIntoTheSheet(fixture);

    const leaving = TestBed.inject(UnsavedWork).confirmLeave();
    await settle(fixture);
    press(question()!, 'Keep editing');
    await settle(fixture);

    expect(question()).toBeNull();
    expect(await leaving).toBe(false);
    expect(field(sheet()!, 'Plan name').value).toBe('Spring block');
    // Still guarded: closing it now asks again.
    press(sheet()!, 'Not now');
    await settle(fixture);
    expect(titleOf(question())).toBe('Discard what you typed?');
  });

  it('asks once when a switch comes while the sheet is already asking, and both follow the one answer', async () => {
    const { fixture, host } = await render();
    press(host, 'Edit the plan');
    await settle(fixture);
    await typeIntoTheSheet(fixture);

    press(sheet()!, 'Not now');
    await settle(fixture);
    const leaving = TestBed.inject(UnsavedWork).confirmSheets();
    await settle(fixture);
    expect(document.querySelectorAll('.tb-modal-pane--dialog')).toHaveLength(1);

    press(question()!, 'Discard');
    await settle(fixture);
    expect(question()).toBeNull();
    expect(await leaving).toBe(true);
    expect(sheet()).toBeNull();
  });

  it('closes the sheet and its open question without asking when the workspace changes', async () => {
    const { fixture, host } = await render();
    press(host, 'Edit the plan');
    await settle(fixture);
    await typeIntoTheSheet(fixture);
    press(sheet()!, 'Not now');
    await settle(fixture);
    expect(question()).not.toBeNull();

    TestBed.inject(TenantContext).invalidate();
    await settle(fixture);

    expect(question()).toBeNull();
    expect(sheet()).toBeNull();
    // The typed work went with the workspace it belonged to: nothing is left to ask about.
    const leaving = TestBed.inject(UnsavedWork).confirmLeave();
    await settle(fixture);
    expect(question()).toBeNull();
    expect(await leaving).toBe(true);
  });

  it('closes its sheet when the page goes, and is asked nothing afterwards', async () => {
    const { fixture, host, page } = await render();
    press(host, 'Edit the plan');
    await settle(fixture);
    await typeIntoTheSheet(fixture);
    const asked = vi.spyOn(page, 'canLeave');

    fixture.destroy();

    expect(sheet()).toBeNull();
    const leaving = TestBed.inject(UnsavedWork).confirmLeave();
    await new Promise((resolve) => setTimeout(resolve));
    expect(question()).toBeNull();
    expect(await leaving).toBe(true);
    // Gone with its page: a switch or a sign-out never asks it again.
    expect(asked).not.toHaveBeenCalled();
  });

  it('asks the browser to hold a reload only while a sheet holds typed work', async () => {
    const { fixture, host } = await render();
    expect(reloadHeld()).toBe(false);

    press(host, 'Edit the plan');
    await settle(fixture);
    expect(reloadHeld()).toBe(false);

    await typeIntoTheSheet(fixture);
    expect(reloadHeld()).toBe(true);

    press(sheet()!, 'Save plan');
    await settle(fixture);
    expect(reloadHeld()).toBe(false);
  });
});
