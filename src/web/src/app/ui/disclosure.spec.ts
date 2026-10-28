import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { fold, settle, toggleFold } from '../../testing/dom';
import { UiDisclosure, UiDisclosureContent } from './disclosure';

let made = 0;

@Component({ selector: 'app-fold-content', template: `<p>Every max on record</p>` })
class FoldContent {
  constructor() {
    made += 1;
  }
}

@Component({
  imports: [FoldContent, UiDisclosure, UiDisclosureContent],
  template: `
    <app-disclosure
      label="Earlier maxes"
      hint="Back squat, bench press"
      [count]="count()"
      [(open)]="open"
    >
      <ng-template appDisclosureContent><app-fold-content /></ng-template>
    </app-disclosure>
    <app-disclosure label="How it is worked out" variant="panel">
      <ng-template appDisclosureContent><p>Steps</p></ng-template>
    </app-disclosure>
  `,
})
class Host {
  readonly open = signal(false);
  readonly count = signal<number | null>(3);
}

async function render() {
  made = 0;
  await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement };
}

describe('UiDisclosure', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('names the fold in its row and makes nothing inside until it opens', async () => {
    const { host } = await render();
    const earlier = fold(host, 'Earlier maxes');
    const row = earlier.querySelector('summary')!;

    expect(earlier.open).toBe(false);
    expect(row.querySelector('.hint')?.textContent).toBe('Back squat, bench press');
    expect(row.querySelector('.count')?.textContent?.trim()).toBe('3');
    expect(row.lastElementChild?.matches('app-icon.chevron')).toBe(true);
    expect(host.querySelector('app-fold-content')).toBeNull();
    expect(made).toBe(0);
  });

  it('makes its content on first open and keeps it while it closes and opens again', async () => {
    const { fixture, host } = await render();

    await toggleFold(fixture, host, 'Earlier maxes');
    expect(host.querySelector('app-fold-content')?.textContent).toBe('Every max on record');

    const closed = await toggleFold(fixture, host, 'Earlier maxes', false);
    expect(closed.open).toBe(false);
    expect(host.querySelector('app-fold-content')).not.toBeNull();

    await toggleFold(fixture, host, 'Earlier maxes');
    expect(made).toBe(1);
  });

  it('opens from the screen, and tells the screen when a person opens or closes it', async () => {
    const { fixture, host } = await render();
    const screen = fixture.componentInstance;

    screen.open.set(true);
    await settle(fixture);
    expect(fold(host, 'Earlier maxes').open).toBe(true);
    expect(host.querySelector('app-fold-content')).not.toBeNull();

    await toggleFold(fixture, host, 'Earlier maxes', false);
    expect(screen.open()).toBe(false);
    await toggleFold(fixture, host, 'Earlier maxes');
    expect(screen.open()).toBe(true);
  });

  it('leaves out a hint and a count it was not given, and draws a panel as a card', async () => {
    const { fixture, host } = await render();
    const how = fold(host, 'How it is worked out');

    expect(how.querySelector('.hint')).toBeNull();
    expect(how.querySelector('.count')).toBeNull();
    expect(how.parentElement?.classList).toContain('panel');
    expect(fold(host, 'Earlier maxes').parentElement?.classList).not.toContain('panel');

    fixture.componentInstance.count.set(null);
    await settle(fixture);
    expect(fold(host, 'Earlier maxes').querySelector('.count')).toBeNull();
  });
});
