import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { button, press, query, settle } from '../../../testing/dom';
import { fakeShareCardMaker } from '../../../testing/share-card-maker-fake';
import { personalRecord, programSummary } from '../../../testing/share-card-fixtures';
import { ShareCardMaker } from './share-card-maker';
import type { ShareFact } from './share-card.models';
import { ShareSheet, shareSheetTitle } from './share-sheet';

@Component({
  imports: [ShareSheet],
  template: `<app-share-sheet [facts]="facts()" />`,
})
class Host {
  readonly facts = signal<readonly ShareFact[]>([
    { kind: 'program', program: programSummary() },
    { kind: 'record', record: personalRecord() },
  ]);
}

/** The phone's share sheet, as far as the page can see it. */
function phoneSharing(share = vi.fn(() => Promise.resolve())) {
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
  Object.defineProperty(navigator, 'share', { configurable: true, value: share });
  return share;
}

async function render(maker = fakeShareCardMaker()) {
  await TestBed.configureTestingModule({
    imports: [Host],
    providers: [{ provide: ShareCardMaker, useValue: maker }],
  }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  await settle(fixture);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, maker };
}

describe('ShareSheet', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (navigator as Partial<Navigator>).canShare;
    delete (navigator as Partial<Navigator>).share;
    TestBed.resetTestingModule();
  });

  it('shows the picture itself before anything leaves the phone, named for a screen reader', async () => {
    phoneSharing();
    const { host, maker } = await render();

    const picture = query<HTMLImageElement>(host, '.preview img');
    expect(picture.getAttribute('src')).toBe('data:image/png;base64,eA==#program-block-1');
    expect(picture.alt).toBe(
      'Program complete. Strength Foundations, 8 weeks. 30 workouts, 7 personal records. ' +
        'Maya · coached by Atlas Performance',
    );
    // Only the card on show is made; nothing is sent anywhere by showing it.
    expect(maker.make).toHaveBeenCalledTimes(1);
    expect(navigator.share).not.toHaveBeenCalled();
    expect(host.textContent).toContain(
      'Only you can share this, and your coach never posts for you.',
    );
  });

  it('lets the client choose between the workout’s cards, making each once', async () => {
    phoneSharing();
    const { fixture, host, maker } = await render();
    const choices = [...host.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(choices.map((choice) => choice.closest('label')?.textContent?.trim())).toEqual([
      'Your program',
      'Barbell bench press',
    ]);

    choices[1].click();
    await settle(fixture);
    await settle(fixture);
    expect(query<HTMLImageElement>(host, '.preview img').getAttribute('src')).toContain(
      'record-set-bench',
    );
    choices[0].click();
    await settle(fixture);
    expect(maker.make).toHaveBeenCalledTimes(2);
  });

  it('hands the picture to the phone’s share sheet, and says nothing when the client closes it', async () => {
    const share = phoneSharing();
    const { fixture, host } = await render();

    press(host, 'Share');
    await settle(fixture);
    expect(share).toHaveBeenCalledWith({ files: [expect.any(File)] });
    const file = (share.mock.calls[0] as unknown as [ShareData])[0].files![0];
    expect(file.name).toBe('strength-foundations-complete.png');
    expect(query(host, '[role="status"].status').textContent).toBe('Shared.');

    share.mockRejectedValueOnce(new DOMException('Share canceled', 'AbortError'));
    press(host, 'Share');
    await settle(fixture);
    expect(host.querySelector('.problem')).toBeNull();
  });

  it('says what to do when the phone does not share the picture', async () => {
    phoneSharing(vi.fn(() => Promise.reject(new DOMException('Not allowed', 'NotAllowedError'))));
    const { fixture, host } = await render();
    press(host, 'Share');
    await settle(fixture);
    expect(query(host, '.problem[role="alert"]').textContent).toBe(
      'The picture couldn’t be shared from here. Save it instead, then share it from your photos.',
    );
  });

  it('saves the picture under the card’s own name', async () => {
    phoneSharing();
    const createObjectURL = vi.fn(() => 'blob:card');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this);
    });
    const { fixture, host } = await render();

    press(host, 'Save image');
    await settle(fixture);
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(File));
    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe('strength-foundations-complete.png');
    expect(clicked[0].getAttribute('href')).toBe('blob:card');
    expect(clicked[0].isConnected).toBe(false);
    expect(query(host, '[role="status"].status').textContent).toBe('Your picture is downloading.');
  });

  it('offers Save image alone where the phone or browser cannot share a picture', async () => {
    const { host } = await render();
    expect(host.querySelector('button')?.textContent?.trim()).not.toBe('Share');
    expect(
      [...host.querySelectorAll('.actions button')].map((item) => item.textContent?.trim()),
    ).toEqual(['Save image']);
    expect(button(host, 'Save image').classList).toContain('tb-button--filled');
  });

  it('says when a picture could not be made, and tries again on request', async () => {
    const maker = fakeShareCardMaker({ fail: true });
    const { fixture, host } = await render(maker);
    expect(query(host, '.state[role="alert"]').textContent).toContain(
      'This card couldn’t be made on this device.',
    );
    expect(button(host, 'Save image').disabled).toBe(true);

    press(host, 'Try again');
    await settle(fixture);
    expect(maker.make).toHaveBeenCalledTimes(2);
  });
});

describe('shareSheetTitle', () => {
  it('names what the sheet offers', () => {
    const record: ShareFact = { kind: 'record', record: personalRecord() };
    const program: ShareFact = { kind: 'program', program: programSummary() };
    expect(shareSheetTitle([record])).toBe('Share your record');
    expect(shareSheetTitle([record, record])).toBe('Share a record');
    expect(shareSheetTitle([program])).toBe('Share your program');
    expect(shareSheetTitle([program, record])).toBe('Share your progress');
  });
});
