import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, describe, expect, it } from 'vitest';
import { press, settle } from '../../../testing/dom';
import { ClientAction, ClientActions } from './client-actions';

@Component({
  imports: [ClientActions],
  template: `
    <button id="before" type="button">Before</button>
    <app-client-actions label="Actions" [items]="items" />
    <button id="after" type="button">After</button>
  `,
})
class Host {
  items: ClientAction[] = [
    { label: 'Assign program', hint: 'Choose a program', link: '/clients/c-1/training' },
    { label: 'Renew plan', link: '/clients/c-1/service', queryParams: { renew: 'e-1' } },
    { label: 'Edit intake', link: '/clients/c-1/intake' },
  ];
}

/** Items the page handles itself, one of them not available right now. */
@Component({
  imports: [ClientActions],
  template: `<app-client-actions label="Actions" [items]="items" (chosen)="chosen.push($event)" />`,
})
class ActionHost {
  chosen: string[] = [];
  items: ClientAction[] = [
    { label: 'Assign program', hint: 'Choose a program', action: 'assign' },
    {
      label: 'Reschedule',
      hint: 'Not possible once a workout has started',
      action: 'reschedule',
      disabled: true,
    },
    { label: 'Cancel program', action: 'cancel' },
  ];
}

@Component({ template: 'page' })
class Page {}

async function render() {
  // Any route will do: choosing an item navigates, and the router must have somewhere to go.
  TestBed.configureTestingModule({ providers: [provideRouter([{ path: '**', component: Page }])] });
  const fixture = TestBed.createComponent(Host);
  document.body.append(fixture.nativeElement);
  await settle(fixture);
  const host = fixture.nativeElement as HTMLElement;
  return {
    fixture,
    host,
    trigger: () => host.querySelector('app-client-actions button') as HTMLButtonElement,
    items: () => Array.from(host.querySelectorAll<HTMLAnchorElement>('a.item')),
    keydown: async (key: string, target: Element = document.activeElement!) => {
      target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      await settle(fixture);
    },
  };
}

describe('ClientActions', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    TestBed.resetTestingModule();
  });

  it('is closed until it is pressed, and says whether it is open', async () => {
    const { fixture, host, trigger, items } = await render();

    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(items()).toHaveLength(0);

    press(host, 'Actions');
    await settle(fixture);
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(trigger().getAttribute('aria-controls')).toBe(
      host.querySelector('ul.panel')?.getAttribute('id'),
    );

    press(host, 'Actions');
    await settle(fixture);
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(items()).toHaveLength(0);
  });

  it('lists real links with their hints and query parameters, and moves focus to the first', async () => {
    const { fixture, host, items } = await render();

    press(host, 'Actions');
    await settle(fixture);

    expect(items().map((item) => item.getAttribute('href'))).toEqual([
      '/clients/c-1/training',
      '/clients/c-1/service?renew=e-1',
      '/clients/c-1/intake',
    ]);
    expect(items()[0].textContent).toContain('Choose a program');
    expect(items()[1].querySelector('.item-hint')).toBeNull();
    expect(document.activeElement).toBe(items()[0]);
  });

  it('moves through the items with the arrow keys, wrapping, and with Home and End', async () => {
    const { fixture, host, items, keydown } = await render();
    press(host, 'Actions');
    await settle(fixture);

    await keydown('ArrowDown');
    expect(document.activeElement).toBe(items()[1]);
    await keydown('ArrowDown');
    await keydown('ArrowDown');
    expect(document.activeElement).toBe(items()[0]);
    await keydown('ArrowUp');
    expect(document.activeElement).toBe(items()[2]);
    await keydown('Home');
    expect(document.activeElement).toBe(items()[0]);
    await keydown('End');
    expect(document.activeElement).toBe(items()[2]);
    // Other keys are left alone, so typing and tabbing behave as usual.
    await keydown('a');
    expect(document.activeElement).toBe(items()[2]);
  });

  it('closes on Escape and hands focus back to the button', async () => {
    const { fixture, host, trigger, items, keydown } = await render();
    press(host, 'Actions');
    await settle(fixture);
    expect(items()).toHaveLength(3);

    await keydown('Escape');

    expect(items()).toHaveLength(0);
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger());
  });

  it('closes when focus leaves it, and stays open while focus moves within it', async () => {
    const { fixture, host, items } = await render();
    press(host, 'Actions');
    await settle(fixture);

    items()[1].focus();
    await settle(fixture);
    expect(items()).toHaveLength(3);

    (host.querySelector('#after') as HTMLButtonElement).focus();
    await settle(fixture);
    expect(items()).toHaveLength(0);
  });

  it('closes when an item is chosen', async () => {
    const { fixture, host, items } = await render();
    press(host, 'Actions');
    await settle(fixture);

    items()[2].click();
    await settle(fixture);

    expect(items()).toHaveLength(0);
  });

  describe('items the page handles itself', () => {
    async function renderActions() {
      TestBed.configureTestingModule({ providers: [provideRouter([])] });
      const fixture = TestBed.createComponent(ActionHost);
      document.body.append(fixture.nativeElement);
      await settle(fixture);
      const host = fixture.nativeElement as HTMLElement;
      return {
        fixture,
        host,
        trigger: () => host.querySelector('app-client-actions button') as HTMLButtonElement,
        items: () => Array.from(host.querySelectorAll<HTMLButtonElement>('button.item')),
      };
    }

    it('lists buttons, not links, and reports the action chosen once focus is back on the button', async () => {
      const { fixture, host, trigger, items } = await renderActions();
      press(host, 'Actions');
      await settle(fixture);

      expect(host.querySelectorAll('a.item')).toHaveLength(0);
      expect(items().map((item) => item.querySelector('.item-title')?.textContent)).toEqual([
        'Assign program',
        'Reschedule',
        'Cancel program',
      ]);
      expect(document.activeElement).toBe(items()[0]);

      items()[2].click();
      await settle(fixture);

      expect(fixture.componentInstance.chosen).toEqual(['cancel']);
      expect(items()).toHaveLength(0);
      expect(document.activeElement).toBe(trigger());
    });

    it('keeps an unavailable item in the list, says why, and does nothing when it is chosen', async () => {
      const { fixture, host, items } = await renderActions();
      press(host, 'Actions');
      await settle(fixture);

      const blocked = items()[1];
      expect(blocked.getAttribute('aria-disabled')).toBe('true');
      expect(blocked.textContent).toContain('Not possible once a workout has started');
      expect(items()[0].getAttribute('aria-disabled')).toBeNull();

      blocked.click();
      await settle(fixture);

      expect(fixture.componentInstance.chosen).toEqual([]);
      expect(items()).toHaveLength(3);
    });
  });
});
