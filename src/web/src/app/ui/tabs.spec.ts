import { Dir } from '@angular/cdk/bidi';
import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { query, settle } from '../../testing/dom';
import { UiTabPane, UiTabs } from './tabs';

@Component({
  imports: [Dir, UiTabs, UiTabPane],
  template: `
    <div [dir]="direction()">
      <app-tabs [(selected)]="tab">
        <ng-template appTabPane value="weight" label="Weight"><p>Weight entries</p></ng-template>
        <ng-template appTabPane value="measurements" label="Measurements">
          <p>Measurement entries</p>
        </ng-template>
        <ng-template appTabPane value="photos" label="Photos" [disabled]="photosOff()">
          <p>Photo sets</p>
        </ng-template>
      </app-tabs>
    </div>
  `,
})
class Host {
  readonly tab = signal<string | undefined>('weight');
  readonly photosOff = signal(false);
  /** The page's direction, which CDK's Dir gives to everything inside it. */
  readonly direction = signal<'ltr' | 'rtl'>('ltr');
}

async function render(setup: (host: Host) => void = () => undefined) {
  await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  setup(fixture.componentInstance);
  await settle(fixture);
  return {
    fixture,
    element: fixture.nativeElement as HTMLElement,
    host: fixture.componentInstance,
  };
}

const tabs = (element: HTMLElement) =>
  Array.from(element.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
const tab = (element: HTMLElement, name: string) => {
  const found = tabs(element).find((candidate) => candidate.textContent?.trim() === name);
  if (!found) throw new Error(`No tab "${name}".`);
  return found;
};
const selected = (element: HTMLElement) =>
  tabs(element)
    .filter((candidate) => candidate.getAttribute('aria-selected') === 'true')
    .map((candidate) => candidate.textContent?.trim());
/** What a person can read below the tabs: the panels that are shown, and their content. */
const shown = (element: HTMLElement) =>
  Array.from(element.querySelectorAll<HTMLElement>('[role="tabpanel"]'))
    .filter((panel) => !panel.hasAttribute('inert'))
    .map((panel) => panel.textContent?.trim());

async function key(fixture: ComponentFixture<unknown>, name: string): Promise<KeyboardEvent> {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
  (document.activeElement ?? document.body).dispatchEvent(event);
  await settle(fixture);
  return event;
}

describe('UiTabs', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('lists a tab per pane, each naming its panel, and shows the chosen tab’s panel alone', async () => {
    const { element } = await render();

    expect(element.querySelector('[role="tablist"]')).not.toBeNull();
    expect(tabs(element).map((candidate) => candidate.textContent?.trim())).toEqual([
      'Weight',
      'Measurements',
      'Photos',
    ]);
    expect(selected(element)).toEqual(['Weight']);
    for (const candidate of tabs(element)) {
      const panel = query<HTMLElement>(
        element,
        `[role="tabpanel"]#${candidate.getAttribute('aria-controls')}`,
      );
      expect(panel.getAttribute('aria-labelledby')).toBe(candidate.id);
    }
    expect(shown(element)).toEqual(['Weight entries']);
    // Content behind another tab is not drawn until that tab is opened.
    expect(element.textContent).not.toContain('Measurement entries');
    expect(element.textContent).not.toContain('Photo sets');
    // Only the chosen tab is in the tab order; the arrows move between the others.
    expect(tabs(element).map((candidate) => candidate.getAttribute('tabindex'))).toEqual([
      '0',
      '-1',
      '-1',
    ]);
  });

  it('opens the tab the person presses and tells the page', async () => {
    const { fixture, element, host } = await render();

    tab(element, 'Measurements').click();
    await settle(fixture);

    expect(selected(element)).toEqual(['Measurements']);
    expect(shown(element)).toEqual(['Measurement entries']);
    expect(element.textContent).not.toContain('Weight entries');
    expect(host.tab()).toBe('measurements');
  });

  it('opens the tab the page chooses, as when the address names it', async () => {
    const { fixture, element, host } = await render();

    host.tab.set('photos');
    await settle(fixture);

    expect(selected(element)).toEqual(['Photos']);
    expect(shown(element)).toEqual(['Photo sets']);
  });

  it('moves with the arrow keys, opening each tab it reaches, and wraps round; Home and End go to either end', async () => {
    const { fixture, element, host } = await render();
    tab(element, 'Weight').focus();

    const right = await key(fixture, 'ArrowRight');
    expect(right.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(tab(element, 'Measurements'));
    expect(selected(element)).toEqual(['Measurements']);
    expect(shown(element)).toEqual(['Measurement entries']);
    expect(host.tab()).toBe('measurements');

    await key(fixture, 'ArrowRight');
    await key(fixture, 'ArrowRight');
    expect(selected(element)).toEqual(['Weight']);
    await key(fixture, 'ArrowLeft');
    expect(selected(element)).toEqual(['Photos']);
    await key(fixture, 'Home');
    expect(selected(element)).toEqual(['Weight']);
    await key(fixture, 'End');
    expect(selected(element)).toEqual(['Photos']);
    expect(document.activeElement).toBe(tab(element, 'Photos'));
    expect(host.tab()).toBe('photos');
  });

  it('reverses the arrows on a right-to-left page', async () => {
    const { fixture, element, host } = await render((page) => page.direction.set('rtl'));
    tab(element, 'Weight').focus();

    await key(fixture, 'ArrowLeft');
    expect(selected(element)).toEqual(['Measurements']);
    await key(fixture, 'ArrowRight');
    expect(selected(element)).toEqual(['Weight']);
    expect(host.tab()).toBe('weight');
  });

  it('draws a tab that is not available dimmed, as a person reads it before pressing', async () => {
    const { element } = await render((page) => page.photosOff.set(true));

    // Angular Aria keeps such a tab focusable and says so with aria-disabled, not `disabled`.
    expect(tab(element, 'Photos').disabled).toBe(false);
    expect(getComputedStyle(tab(element, 'Photos')).cursor).toBe('not-allowed');
    expect(getComputedStyle(tab(element, 'Photos')).opacity).toBe('0.5');
    expect(getComputedStyle(tab(element, 'Measurements')).cursor).toBe('pointer');
    expect(getComputedStyle(tab(element, 'Measurements')).opacity).not.toBe('0.5');
  });

  it('says a tab is not available and never opens it, by a press or by the arrows', async () => {
    const { fixture, element, host } = await render((page) => page.photosOff.set(true));
    const photos = tab(element, 'Photos');

    expect(photos.getAttribute('aria-disabled')).toBe('true');
    photos.click();
    await settle(fixture);
    expect(selected(element)).toEqual(['Weight']);

    tab(element, 'Measurements').click();
    await settle(fixture);
    await key(fixture, 'ArrowRight');

    expect(selected(element)).toEqual(['Measurements']);
    expect(shown(element)).toEqual(['Measurement entries']);
    expect(host.tab()).toBe('measurements');
  });
});
