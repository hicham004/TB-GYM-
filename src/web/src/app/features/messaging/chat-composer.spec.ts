import { Component, computed, signal, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { FormAttempt } from '../../core/forms/form-attempt';
import { button, field, fill, leave, press, query, settle } from '../../../testing/dom';
import { ChatComposer } from './chat-composer';

const MAXIMUM = 2000;

/** The reasons the Messages screen gives the composer, in the order the server reports them. */
function issuesOf(draft: string): string[] {
  const body = draft.trim();
  if (body.length === 0) return ['Write something before sending.'];
  return body.length > MAXIMUM ? [`A message can be at most ${MAXIMUM} characters.`] : [];
}

/** The screen's side of the composer: it owns the draft, the attempt and the send. */
@Component({
  imports: [ChatComposer],
  template: `
    <app-chat-composer
      [draft]="draft()"
      placeholder="Write to Lea"
      [maximumLength]="maximum"
      [issues]="issues()"
      [attempt]="attempt"
      [busy]="busy()"
      [savedReplies]="savedReplies()"
      (draftChange)="draft.set($event)"
      (send)="send()"
      (openSavedReplies)="savedRepliesOpened = savedRepliesOpened + 1"
    />
  `,
})
class Host {
  readonly composer = viewChild.required(ChatComposer);
  readonly draft = signal('');
  readonly busy = signal(false);
  readonly savedReplies = signal(false);
  readonly maximum = MAXIMUM;
  readonly attempt = new FormAttempt();
  readonly issues = computed(() => issuesOf(this.draft()));
  sent: string[] = [];
  refused = 0;
  savedRepliesOpened = 0;

  /** As the screen does: the attempt first, and a refusal reaches no server and says why. */
  send(): void {
    this.attempt.attempt();
    if (this.issues().length > 0) {
      this.refused++;
      this.composer().focusSummary();
      return;
    }
    this.sent.push(this.draft().trim());
  }
}

async function render() {
  TestBed.configureTestingModule({ imports: [Host] });
  const fixture = TestBed.createComponent(Host);
  await settle(fixture);
  const host = fixture.nativeElement as HTMLElement;
  return {
    fixture,
    host,
    page: fixture.componentInstance,
    message: () => field<HTMLTextAreaElement>(host, 'Write a message'),
  };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** Answers `(pointer: fine)` the way a desktop (true) or a phone (false) would. */
function pointer(fine: boolean): () => void {
  const view = document.defaultView as Window & { matchMedia?: Window['matchMedia'] };
  const original = view.matchMedia;
  view.matchMedia = ((media: string) =>
    ({
      matches: fine && media === '(pointer: fine)',
      media,
    }) as MediaQueryList) as Window['matchMedia'];
  return () => {
    if (original) view.matchMedia = original;
    else Reflect.deleteProperty(view, 'matchMedia');
  };
}

function enter(target: HTMLElement, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: 'Enter',
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

describe('ChatComposer', () => {
  let restorePointer: (() => void) | null = null;

  afterEach(() => {
    restorePointer?.();
    restorePointer = null;
    TestBed.resetTestingModule();
  });

  it('reports what is typed and shows the draft the screen holds', async () => {
    const { fixture, page, message, host } = await render();

    expect(message().getAttribute('placeholder')).toBe('Write to Lea');
    fill(host, 'Write a message', 'See you Thursday');
    await settle(fixture);
    expect(page.draft()).toBe('See you Thursday');

    // A draft the screen changes itself (another conversation's, or cleared after a send) is shown.
    page.draft.set('');
    await settle(fixture);
    expect(message().value).toBe('');
  });

  it('sends on Enter with a mouse and keyboard, keeping the line break out of the message', async () => {
    restorePointer = pointer(true);
    const { fixture, page, host, message } = await render();
    fill(host, 'Write a message', 'On my way');
    await settle(fixture);

    const event = enter(message());
    await settle(fixture);

    expect(event.defaultPrevented).toBe(true);
    expect(page.sent).toEqual(['On my way']);
  });

  it('keeps Enter a new line with Shift, while an input method is composing, and on a phone', async () => {
    restorePointer = pointer(true);
    const { fixture, page, host, message } = await render();
    fill(host, 'Write a message', 'Two lines');
    await settle(fixture);

    expect(enter(message(), { shiftKey: true }).defaultPrevented).toBe(false);
    // Enter that confirms an Arabic word belongs to the input method, not to Send.
    const composing = enter(message(), { isComposing: true });
    expect(composing.isComposing).toBe(true);
    expect(composing.defaultPrevented).toBe(false);
    restorePointer();
    restorePointer = pointer(false);
    expect(enter(message()).defaultPrevented).toBe(false);
    await settle(fixture);

    expect(page.sent).toEqual([]);
  });

  it('keeps Enter a new line where the browser cannot say what pointer it has', async () => {
    const view = document.defaultView as Window & { matchMedia?: Window['matchMedia'] };
    const original = view.matchMedia;
    Reflect.deleteProperty(view, 'matchMedia');
    restorePointer = () => {
      if (original) view.matchMedia = original;
    };
    const { fixture, page, host, message } = await render();
    fill(host, 'Write a message', 'Hello');
    await settle(fixture);

    expect(enter(message()).defaultPrevented).toBe(false);
    await settle(fixture);
    expect(page.sent).toEqual([]);
  });

  it('sends with its button, which is never disabled and says it is busy instead', async () => {
    const { fixture, page, host } = await render();
    const send = button(host, 'Send message');
    expect(send.type).toBe('submit');

    // An empty draft is refused out loud rather than greyed out.
    expect(send.disabled).toBe(false);
    fill(host, 'Write a message', '  Ready when you are  ');
    await settle(fixture);
    press(host, 'Send message');
    await settle(fixture);
    expect(page.sent).toEqual(['Ready when you are']);

    page.busy.set(true);
    await settle(fixture);
    expect(send.disabled).toBe(false);
    expect(send.getAttribute('aria-disabled')).toBe('true');
    page.busy.set(false);
    await settle(fixture);
    expect(send.hasAttribute('aria-disabled')).toBe(false);
  });

  it('shows the reason under the message only once it was left or a send was refused', async () => {
    const { fixture, host, message } = await render();

    expect(host.querySelector('#draft-reason')).toBeNull();
    expect(message().hasAttribute('aria-invalid')).toBe(false);
    expect(message().hasAttribute('aria-describedby')).toBe(false);

    leave(host, 'Write a message');
    await settle(fixture);
    expect(textOf(query(host, '#draft-reason'))).toBe('Write something before sending.');
    expect(message().getAttribute('aria-invalid')).toBe('true');
    expect(message().getAttribute('aria-describedby')).toBe('draft-reason');
    // Leaving the field is no refused send: the summary stays quiet.
    expect(textOf(query(host, '#composer-summary'))).toBe('');

    fill(host, 'Write a message', 'Hello');
    await settle(fixture);
    expect(host.querySelector('#draft-reason')).toBeNull();
    expect(message().hasAttribute('aria-invalid')).toBe(false);
  });

  it('says why a refused send was refused, in the summary that takes focus', async () => {
    const { fixture, page, host, message } = await render();
    const summary = query<HTMLElement>(host, '#composer-summary');
    // In the page from the first render, empty, and never display: none: a browser focuses no element
    // it does not draw (jsdom does), and a screen reader registers the region before its words land.
    expect(summary.getAttribute('role')).toBe('alert');
    expect(textOf(summary)).toBe('');
    expect(getComputedStyle(summary).display).not.toBe('none');

    press(host, 'Send message');
    await settle(fixture);

    expect(page.refused).toBe(1);
    expect(page.sent).toEqual([]);
    expect(textOf(summary)).toBe(
      'This message cannot be sent yet: Write something before sending.',
    );
    expect(document.activeElement).toBe(summary);
    expect(textOf(query(host, '#draft-reason'))).toBe('Write something before sending.');
    expect(message().getAttribute('aria-invalid')).toBe('true');
  });

  it('counts the characters left only near the limit, from the trimmed message', async () => {
    const { fixture, host } = await render();
    const count = query(host, '.count[role="status"]');
    expect(textOf(count)).toBe('');

    fill(host, 'Write a message', 'x'.repeat(MAXIMUM - 200));
    await settle(fixture);
    expect(textOf(count)).toBe('');

    fill(host, 'Write a message', 'x'.repeat(MAXIMUM - 199));
    await settle(fixture);
    expect(textOf(count)).toBe(`199 of ${MAXIMUM} characters left.`);

    // Spaces at either end are not sent, so they are not counted.
    fill(host, 'Write a message', `   ${'x'.repeat(MAXIMUM - 150)}   `);
    await settle(fixture);
    expect(textOf(count)).toBe(`150 of ${MAXIMUM} characters left.`);
  });

  it('offers the saved replies on the coach’s side only', async () => {
    const { fixture, page, host } = await render();
    expect(host.textContent).not.toContain('Saved replies');

    page.savedReplies.set(true);
    await settle(fixture);
    const saved = button(host, 'Saved replies');
    expect(saved.getAttribute('aria-haspopup')).toBe('dialog');
    expect(saved.type).toBe('button');
    press(host, 'Saved replies');
    await settle(fixture);

    expect(page.savedRepliesOpened).toBe(1);
    expect(page.sent).toEqual([]);
  });

  it('puts focus back in the message with the caret after its text', async () => {
    const { fixture, page, host, message } = await render();
    fill(host, 'Write a message', 'Thanks, see you at 6');
    await settle(fixture);
    const box = message();
    box.setSelectionRange(0, 0);
    query<HTMLElement>(host, 'button[type="submit"]').focus();

    page.composer().focusField();

    expect(document.activeElement).toBe(box);
    expect(box.selectionStart).toBe('Thanks, see you at 6'.length);
    expect(box.selectionEnd).toBe('Thanks, see you at 6'.length);
  });
});
