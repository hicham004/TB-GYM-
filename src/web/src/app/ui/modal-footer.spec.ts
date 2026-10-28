import {
  Component,
  inject,
  Injectable,
  input,
  output,
  signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { press, query, settle } from '../../testing/dom';
import { Button } from './button';
import { UiDialog } from './dialog';
import { ModalFooter, modalFormId } from './modal-footer';
import { EntryActions } from './sheet-parts';
import { UiSheet } from './sheet';

/** A service the page provides itself, which its sheet's content must still be given. */
@Injectable({ providedIn: 'root' })
class Plans {
  readonly owner: string = 'root';
}

/** A sheet's form, the way the feature sheets write theirs: the actions after the form. */
@Component({
  selector: 'app-note-form',
  imports: [Button, ModalFooter],
  template: `
    <form [id]="formId" (submit)="$event.preventDefault(); saved.emit(note())">
      <input
        aria-label="Note for Maya"
        [value]="note()"
        (input)="note.set($any($event.target).value)"
      />
    </form>
    @if (withActions()) {
      <ng-template appModalFooter>
        <button appButton type="button" variant="text" (click)="saved.emit(null)">Not now</button>
        <button appButton type="submit" [attr.form]="formId" [loading]="busy()">
          {{ busy() ? 'Saving…' : 'Save note' }}
        </button>
      </ng-template>
    }
    <p class="owner">{{ plans.owner }}</p>
  `,
})
class NoteForm {
  protected readonly plans = inject(Plans);
  protected readonly formId = modalFormId('note');
  readonly withActions = input(true);
  readonly busy = input(false);
  readonly saved = output<string | null>();
  protected readonly note = signal('Deload next week');
}

@Component({
  imports: [EntryActions, NoteForm],
  providers: [{ provide: Plans, useValue: { owner: 'page' } }],
  template: `
    <ng-template #noteSheet let-sheet>
      <app-note-form
        [withActions]="withActions()"
        [busy]="busy()"
        (saved)="heard.push($event); $event === null && sheet.close()"
      />
    </ng-template>
    <ng-template #bare>
      <p>Nothing to do here.</p>
    </ng-template>
    <ng-template #entry let-sheet>
      <form [id]="entryForm" (submit)="$event.preventDefault(); heard.push('entry')">
        <app-entry-actions
          [form]="entryForm"
          saveLabel="Save weight"
          busyLabel="Saving…"
          (notNow)="sheet.close()"
        />
      </form>
    </ng-template>
    <div class="page">
      <app-note-form />
    </div>
  `,
})
class Host {
  private readonly sheets = inject(UiSheet);
  private readonly dialogs = inject(UiDialog);
  readonly noteSheet = viewChild.required<TemplateRef<unknown>>('noteSheet');
  readonly bare = viewChild.required<TemplateRef<unknown>>('bare');
  readonly entry = viewChild.required<TemplateRef<unknown>>('entry');
  readonly withActions = signal(true);
  readonly busy = signal(false);
  readonly entryForm = modalFormId('entry');
  readonly heard: (string | null)[] = [];

  sheet(content: TemplateRef<unknown>) {
    return this.sheets.open(content, { title: 'Note for Maya' });
  }

  dialog(content: TemplateRef<unknown>) {
    return this.dialogs.open(content, { title: 'Note for Maya' });
  }
}

async function render() {
  await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  await settle(fixture);
  return {
    fixture,
    host: fixture.componentInstance,
    element: fixture.nativeElement as HTMLElement,
  };
}

const modal = () => query<HTMLElement>(document, '[role="dialog"]');
const body = () => query<HTMLElement>(modal(), '.tb-modal__body');
const footer = () => modal().querySelector<HTMLElement>('.tb-modal__footer');
const words = (element: Element | null) => element?.textContent?.replace(/\s+/g, ' ').trim();

describe('the modal footer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
    document.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());
  });

  it('draws the content’s actions after the body that scrolls, outside it', async () => {
    const { fixture, host } = await render();
    host.sheet(host.noteSheet());
    await settle(fixture);

    const actions = footer()!;
    expect(actions).not.toBeNull();
    expect(actions.previousElementSibling).toBe(body());
    expect(Array.from(actions.querySelectorAll('button')).map(words)).toEqual([
      'Not now',
      'Save note',
    ]);
    expect(body().querySelector('button')).toBeNull();
    expect(body().querySelector('input')).not.toBeNull();
  });

  it('submits the form from the footer, and keeps a busy save from submitting again', async () => {
    const { fixture, host } = await render();
    host.sheet(host.noteSheet());
    await settle(fixture);

    const save = query<HTMLButtonElement>(footer()!, 'button[type="submit"]');
    expect(save.getAttribute('form')).toBe(query(body(), 'form').id);
    press(footer()!, 'Save note');
    await settle(fixture);
    expect(host.heard).toEqual(['Deload next week']);

    host.busy.set(true);
    await settle(fixture);
    expect(words(save)).toBe('Saving…');
    save.click();
    await settle(fixture);
    expect(host.heard).toEqual(['Deload next week']);
  });

  it('runs the content’s own actions, which can close the sheet', async () => {
    const { fixture, host } = await render();
    host.sheet(host.noteSheet());
    await settle(fixture);

    press(footer()!, 'Not now');
    await settle(fixture);

    expect(host.heard).toEqual([null]);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('goes when the content stops drawing it, and comes back with it', async () => {
    const { fixture, host } = await render();
    host.sheet(host.noteSheet());
    await settle(fixture);

    host.withActions.set(false);
    await settle(fixture);
    expect(footer()).toBeNull();

    host.withActions.set(true);
    await settle(fixture);
    expect(words(footer())).toContain('Save note');
  });

  it('has no footer when the content hands it nothing, in a sheet or a dialog', async () => {
    const { fixture, host } = await render();
    const sheet = host.sheet(host.bare());
    await settle(fixture);
    expect(footer()).toBeNull();
    sheet.close();
    await settle(fixture);

    host.dialog(host.bare());
    await settle(fixture);
    expect(footer()).toBeNull();
  });

  it('gives a dialog the same footer', async () => {
    const { fixture, host } = await render();
    host.dialog(host.noteSheet());
    await settle(fixture);

    expect(modal().closest('.tb-modal-pane--dialog')).not.toBeNull();
    expect(words(footer())).toBe('Not now Save note');
  });

  it('holds the kit’s entry actions, whose save submits the form it names', async () => {
    const { fixture, host } = await render();
    host.sheet(host.entry());
    await settle(fixture);

    expect(Array.from(footer()!.querySelectorAll('button')).map(words)).toEqual([
      'Not now',
      'Save weight',
    ]);
    // The entry actions' own place in the form is left empty, taking no room.
    expect(query(body(), 'app-entry-actions').children).toHaveLength(0);
    press(footer()!, 'Save weight');
    await settle(fixture);
    expect(host.heard).toEqual(['entry']);
  });

  it('leaves the content’s other services where the page provided them', async () => {
    const { fixture, host } = await render();
    host.sheet(host.noteSheet());
    await settle(fixture);

    expect(words(query(body(), '.owner'))).toBe('page');
  });

  it('keeps the actions where they are written outside a modal', async () => {
    const { element } = await render();
    const page = query<HTMLElement>(element, '.page');

    expect(Array.from(page.querySelectorAll('button')).map(words)).toEqual([
      'Not now',
      'Save note',
    ]);
    expect(document.querySelector('.tb-modal__footer')).toBeNull();
  });

  it('lifts on a shadow while the body can still scroll down', async () => {
    let report: (visible: boolean) => void = () => undefined;
    let root: Element | Document | null | undefined;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(
          callback: (entries: { isIntersecting: boolean }[]) => void,
          options: IntersectionObserverInit,
        ) {
          root = options.root;
          report = (visible) => callback([{ isIntersecting: visible }]);
        }
        readonly observe = (): void => undefined;
        readonly disconnect = (): void => undefined;
      },
    );
    const { fixture, host } = await render();
    host.sheet(host.noteSheet());
    await settle(fixture);
    expect(root).toBe(body());

    report(false);
    await settle(fixture);
    expect(footer()!.classList).toContain('tb-modal__footer--raised');

    report(true);
    await settle(fixture);
    expect(footer()!.classList).not.toContain('tb-modal__footer--raised');
  });
});
