import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { press, query, settle } from '../../../testing/dom';
import { fakeShareCardMaker } from '../../../testing/share-card-maker-fake';
import { personalRecord, programSummary } from '../../../testing/share-card-fixtures';
import { ShareCardMaker } from './share-card-maker';
import type { ShareFact } from './share-card.models';
import { ShareTeaser } from './share-teaser';

@Component({
  imports: [ShareTeaser],
  template: `<app-share-teaser [facts]="facts()" />`,
})
class Host {
  readonly facts = signal<readonly ShareFact[]>([{ kind: 'record', record: personalRecord() }]);
}

async function render(facts?: readonly ShareFact[], maker = fakeShareCardMaker()) {
  await TestBed.configureTestingModule({
    imports: [Host],
    providers: [{ provide: ShareCardMaker, useValue: maker }],
  }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  if (facts) fixture.componentInstance.facts.set(facts);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, maker };
}

const text = (element: Element | null) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('ShareTeaser', () => {
  afterEach(() => {
    document.body.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());
    TestBed.resetTestingModule();
  });

  it('shows a record as the prototype’s card in the coach’s colours, with the space’s initials', async () => {
    const { host } = await render();
    const card = query(host, '.card');
    expect(
      [...card.querySelectorAll('.kicker, .headline, .title, .byline')].map((part) => text(part)),
    ).toEqual([
      'New personal record',
      '62.5 kg × 6',
      'Barbell bench press',
      'Maya · coached by Atlas Performance',
    ]);
    expect(text(card.querySelector('.mark'))).toBe('AP');
    expect(text(query(host, 'button'))).toBe('Share your record');
  });

  it('leads with the program the workout finished, then offers every card in a dark sheet', async () => {
    const { fixture, host, maker } = await render([
      { kind: 'program', program: programSummary() },
      { kind: 'record', record: personalRecord() },
    ]);
    expect(text(host.querySelector('.kicker'))).toBe('Program complete');
    expect([...host.querySelectorAll('.fact')].map((fact) => text(fact))).toEqual([
      '30 workouts',
      '7 personal records',
    ]);

    press(host, 'Share your progress');
    await settle(fixture);
    await settle(fixture);
    const pane = query<HTMLElement>(document, '.tb-modal-pane--sheet');
    expect(pane.dataset['mode']).toBe('dark');
    expect(text(pane.querySelector('h2'))).toBe('Share your progress');
    expect(pane.querySelectorAll('input[type="radio"]')).toHaveLength(2);
    expect(maker.make).toHaveBeenCalledTimes(1);
  });

  it('shows the coaching space’s logo when it has one, and the initials if it will not load', async () => {
    const maker = fakeShareCardMaker();
    maker.logoUrl.set('/api/media/logo/content');
    const { fixture, host } = await render(undefined, maker);
    const logo = query<HTMLImageElement>(host, '.mark.logo img');
    expect(logo.getAttribute('src')).toBe('/api/media/logo/content');
    expect(logo.alt).toBe('');

    logo.dispatchEvent(new Event('error'));
    await settle(fixture);
    expect(host.querySelector('.mark.logo')).toBeNull();
    expect(text(host.querySelector('.mark'))).toBe('AP');
  });
});
