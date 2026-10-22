import { Component, inject, TemplateRef, viewChild, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { press, query, settle } from '../../testing/dom';
import { UiConfirm } from './confirm';
import { UiDialog } from './dialog';

@Component({
  imports: [UiConfirm],
  template: `
    <app-confirm
      message="Cancel this program? Maya keeps the workouts she has done."
      confirmLabel="Cancel program"
      cancelLabel="Keep program"
      (answer)="answers.push($event)"
    />
  `,
})
class Inline {
  readonly answers: boolean[] = [];
}

@Component({
  imports: [UiConfirm],
  template: `
    <button type="button" (click)="ask()">Remove Lea</button>
    <ng-template #question let-dialog>
      <app-confirm
        message="Remove Lea from the team? Her clients move to you."
        confirmLabel="Remove"
        cancelLabel="Keep Lea"
        (answer)="dialog.close($event)"
      />
    </ng-template>
  `,
})
class Asking {
  private readonly dialogs = inject(UiDialog);
  private readonly question = viewChild.required<TemplateRef<unknown>>('question');
  /** What each dialog resolved to, in order. */
  readonly results: unknown[] = [];

  ask(): void {
    this.dialogs
      .open<boolean>(this.question(), { title: 'Remove Lea?' })
      .closed.subscribe((answer) => this.results.push(answer));
  }
}

async function render<T>(component: Type<T>) {
  await TestBed.configureTestingModule({ imports: [component] }).compileComponents();
  const fixture = TestBed.createComponent(component);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement };
}

const words = (element: Element) => element.textContent?.replace(/\s+/g, ' ').trim();

describe('UiConfirm', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    document.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());
  });

  it('says what will happen in one sentence, the safe answer first as text and the one that acts last, filled', async () => {
    const { host } = await render(Inline);

    const message = query<HTMLElement>(host, 'p.message');
    expect(words(message)).toBe('Cancel this program? Maya keeps the workouts she has done.');
    // A name in another script reads in its own direction.
    expect(message.getAttribute('dir')).toBe('auto');
    const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>('.actions button'));
    expect(buttons.map(words)).toEqual(['Keep program', 'Cancel program']);
    expect(buttons.map((button) => button.type)).toEqual(['button', 'button']);
    expect(buttons[0].classList).toContain('tb-button--text');
    expect(buttons[1].classList).toContain('tb-button--filled');
  });

  it('answers false for the safe answer and true for the one that acts', async () => {
    const { fixture, host } = await render(Inline);

    press(host, 'Keep program');
    await settle(fixture);
    press(host, 'Cancel program');
    await settle(fixture);

    expect(fixture.componentInstance.answers).toEqual([false, true]);
  });

  it('resolves its dialog to true or false, and to nothing when the cross closes it', async () => {
    const { fixture, host } = await render(Asking);
    const dialog = () => query<HTMLElement>(document, '[role="dialog"]');

    press(host, 'Remove Lea');
    await settle(fixture);
    expect(words(query(dialog(), 'h2'))).toBe('Remove Lea?');
    press(dialog(), 'Remove');
    await settle(fixture);

    press(host, 'Remove Lea');
    await settle(fixture);
    press(dialog(), 'Keep Lea');
    await settle(fixture);

    press(host, 'Remove Lea');
    await settle(fixture);
    query<HTMLButtonElement>(dialog(), 'button[aria-label="Close"]').click();
    await settle(fixture);

    // The page reads anything but true as the safe answer.
    expect(fixture.componentInstance.results).toEqual([true, false, undefined]);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
