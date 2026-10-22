import { Component, signal, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { query, settle } from '../../testing/dom';
import type { IconName } from './icon';
import { UiMenu, type UiMenuItem } from './menu';

const WEEK: UiMenuItem[] = [
  { label: 'Rename week', action: 'rename' },
  { label: 'Copy to next week', hint: 'Every session and its sets', action: 'copy' },
  { label: 'Move week', hint: 'Finish the open workout first', action: 'move', disabled: true },
  { label: 'Delete week', action: 'delete', danger: true },
];

@Component({
  imports: [UiMenu],
  template: `
    <div class="row">
      <app-menu
        [label]="label()"
        [items]="items()"
        [icon]="icon()"
        [align]="align()"
        [variant]="variant()"
        [size]="size()"
        [selected]="selected()"
        [disabled]="disabled()"
        [current]="current()"
        (chosen)="chosen($event)"
      />
      <button type="button" id="after">After</button>
    </div>
  `,
})
class Host {
  readonly label = signal('More for week 2');
  readonly items = signal<readonly UiMenuItem[]>(WEEK);
  readonly icon = signal<IconName | null>(null);
  readonly align = signal<'start' | 'end'>('end');
  readonly variant = signal<'button' | 'chip'>('button');
  readonly size = signal<'default' | 'touch'>('default');
  readonly selected = signal(false);
  readonly disabled = signal(false);
  readonly current = signal<string | null>(null);
  readonly menu = viewChild.required(UiMenu);
  /** Each choice the page heard, with where focus was when it heard it. */
  readonly heard: { action: string; focus: Element | null }[] = [];

  chosen(action: string): void {
    this.heard.push({ action, focus: document.activeElement });
  }
}

async function render(setup: (host: Host) => void = () => undefined) {
  await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  setup(fixture.componentInstance);
  await settle(fixture);
  const element = fixture.nativeElement as HTMLElement;
  // What a sheet around the menu would hear: any key the menu lets through.
  const outer = vi.fn<(event: KeyboardEvent) => void>();
  query<HTMLElement>(element, '.row').addEventListener('keydown', outer);
  return { fixture, element, host: fixture.componentInstance, outer };
}

type Rendered = Awaited<ReturnType<typeof render>>;

const trigger = (element: HTMLElement) =>
  query<HTMLButtonElement>(element, 'app-menu .menu > button');
const list = (element: HTMLElement) => element.querySelector<HTMLElement>('app-menu ul');
const items = (element: HTMLElement) =>
  Array.from(element.querySelectorAll<HTMLButtonElement>('app-menu .item'));
const item = (element: HTMLElement, label: string) => {
  const found = items(element).find(
    (candidate) => candidate.querySelector('.item-title')?.textContent?.trim() === label,
  );
  if (!found) throw new Error(`No menu item "${label}".`);
  return found;
};
const words = (element: Element | null | undefined) =>
  element?.textContent?.replace(/\s+/g, ' ').trim();

async function open({ fixture, element }: Rendered): Promise<void> {
  trigger(element).click();
  await settle(fixture);
}

async function key({ fixture }: Rendered, name: string): Promise<KeyboardEvent> {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
  (document.activeElement ?? document.body).dispatchEvent(event);
  await settle(fixture);
  return event;
}

describe('UiMenu', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (document.documentElement as unknown as { clientWidth?: number }).clientWidth;
    TestBed.resetTestingModule();
  });

  it('is a button named by its words that says whether its list is open and which list it opens', async () => {
    const view = await render();
    const button = trigger(view.element);

    expect(words(button)).toBe('More for week 2');
    expect(button.type).toBe('button');
    expect(button.classList).toContain('tb-button--outlined');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(list(view.element)).toBeNull();

    await open(view);

    const opened = list(view.element)!;
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.getAttribute('aria-controls')).toBe(opened.id);
    expect(items(view.element).map((choice) => words(choice.querySelector('.item-title')))).toEqual(
      ['Rename week', 'Copy to next week', 'Move week', 'Delete week'],
    );
  });

  it('with an icon shows only the glyph and takes its label as its name', async () => {
    const view = await render((host) => host.icon.set('more'));
    const button = trigger(view.element);

    expect(button.getAttribute('aria-label')).toBe('More for week 2');
    expect(words(button)).toBe('');
    expect(button.querySelector('app-icon')).not.toBeNull();
    expect(button.classList).toContain('tb-icon-button');
    expect(button.classList).not.toContain('trigger-touch');
    expect(getComputedStyle(button).blockSize).toBe('2.25rem');
  });

  it('draws the 44 px icon button a client’s thumb needs when asked', async () => {
    const view = await render((host) => {
      host.icon.set('more');
      host.size.set('touch');
    });

    expect(trigger(view.element).classList).toContain('trigger-touch');
    expect(getComputedStyle(trigger(view.element)).blockSize).toBe('2.75rem');
    expect(getComputedStyle(trigger(view.element)).inlineSize).toBe('2.75rem');
  });

  it('draws a filter chip, filled while its filter is on', async () => {
    const view = await render((host) => host.variant.set('chip'));
    const button = trigger(view.element);

    expect(button.classList).toContain('chip');
    expect(button.classList).not.toContain('tb-button');
    expect(button.classList).not.toContain('selected');

    view.host.selected.set(true);
    await settle(view.fixture);
    expect(button.classList).toContain('selected');
  });

  it('opens with focus on the first choice; the arrows wrap round, Home and End go to either end', async () => {
    const view = await render();
    await open(view);
    const [rename, copy, move, remove] = items(view.element);
    expect(document.activeElement).toBe(rename);

    const down = await key(view, 'ArrowDown');
    expect(down.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(copy);
    await key(view, 'ArrowDown');
    // A choice that is not available can still be reached, so its hint can be read.
    expect(document.activeElement).toBe(move);
    await key(view, 'ArrowUp');
    await key(view, 'ArrowUp');
    expect(document.activeElement).toBe(rename);
    await key(view, 'ArrowUp');
    expect(document.activeElement).toBe(remove);
    await key(view, 'ArrowDown');
    expect(document.activeElement).toBe(rename);
    await key(view, 'End');
    expect(document.activeElement).toBe(remove);
    await key(view, 'Home');
    expect(document.activeElement).toBe(rename);
    expect(list(view.element)).not.toBeNull();
  });

  it('leaves other keys alone', async () => {
    const view = await render();
    await open(view);

    const tab = await key(view, 'Tab');
    expect(tab.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(items(view.element)[0]);
  });

  it('closes on Escape, gives focus back to its button and keeps that Escape from the sheet around it', async () => {
    const view = await render();
    await open(view);
    await key(view, 'ArrowDown');

    await key(view, 'Escape');

    expect(list(view.element)).toBeNull();
    expect(trigger(view.element).getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger(view.element));
    expect(view.outer).not.toHaveBeenCalledWith(expect.objectContaining({ key: 'Escape' }));

    // Closed, an Escape is the sheet's again.
    await key(view, 'Escape');
    expect(view.outer).toHaveBeenCalledWith(expect.objectContaining({ key: 'Escape' }));
  });

  it('closes when focus leaves it, and stays open while focus moves between its choices', async () => {
    const view = await render();
    await open(view);
    const [rename, copy] = items(view.element);

    rename.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: copy }));
    await settle(view.fixture);
    expect(list(view.element)).not.toBeNull();

    copy.dispatchEvent(
      new FocusEvent('focusout', {
        bubbles: true,
        relatedTarget: query(view.element, '#after'),
      }),
    );
    await settle(view.fixture);
    expect(list(view.element)).toBeNull();
    expect(view.host.heard).toEqual([]);
  });

  it('closes on a choice and puts focus back on its button before the page hears which', async () => {
    const view = await render();
    await open(view);

    item(view.element, 'Copy to next week').click();
    await settle(view.fixture);

    expect(view.host.heard).toEqual([{ action: 'copy', focus: trigger(view.element) }]);
    expect(list(view.element)).toBeNull();
    expect(document.activeElement).toBe(trigger(view.element));
  });

  it('says why a choice is not available, and choosing it does nothing', async () => {
    const view = await render();
    await open(view);
    const move = item(view.element, 'Move week');

    expect(move.getAttribute('aria-disabled')).toBe('true');
    expect(words(move.querySelector('.item-hint'))).toBe('Finish the open workout first');
    move.click();
    await settle(view.fixture);

    expect(view.host.heard).toEqual([]);
    expect(list(view.element)).not.toBeNull();
  });

  it('shows a hint under a name only where one is given, and draws a removal in the danger colour', async () => {
    const view = await render();
    await open(view);

    expect(words(item(view.element, 'Copy to next week').querySelector('.item-hint'))).toBe(
      'Every session and its sets',
    );
    expect(item(view.element, 'Rename week').querySelector('.item-hint')).toBeNull();
    expect(item(view.element, 'Delete week').classList).toContain('danger');
    expect(item(view.element, 'Rename week').classList).not.toContain('danger');
  });

  it('marks the choice in effect', async () => {
    const view = await render((host) => host.current.set('copy'));
    await open(view);

    expect(item(view.element, 'Copy to next week').getAttribute('aria-current')).toBe('true');
    expect(item(view.element, 'Copy to next week').classList).toContain('current');
    expect(item(view.element, 'Rename week').hasAttribute('aria-current')).toBe(false);
  });

  it('cannot be opened while its button is disabled', async () => {
    const view = await render((host) => host.disabled.set(true));

    expect(trigger(view.element).disabled).toBe(true);
    trigger(view.element).click();
    await settle(view.fixture);

    expect(list(view.element)).toBeNull();
  });

  it('closes again on a second press of its button', async () => {
    const view = await render();
    await open(view);
    await open(view);

    expect(list(view.element)).toBeNull();
    expect(trigger(view.element).getAttribute('aria-expanded')).toBe('false');
  });

  it('puts focus back on its button when the page asks, after the choice removed what had focus', async () => {
    const view = await render();
    query<HTMLButtonElement>(view.element, '#after').focus();

    view.host.menu().focus();

    expect(document.activeElement).toBe(trigger(view.element));
  });

  describe('near the edge of the screen', () => {
    const realBox = Element.prototype.getBoundingClientRect;

    /** The list's box once drawn, on a screen 390 px wide. */
    function screenWith(panel: Partial<DOMRect>): void {
      Object.defineProperty(document.documentElement, 'clientWidth', {
        configurable: true,
        get: () => 390,
      });
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: Element,
      ) {
        return this.classList.contains('panel')
          ? ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, ...panel } as DOMRect)
          : realBox.call(this);
      });
    }

    const startAligned = (element: HTMLElement) => list(element)!.classList.contains('start');

    it('lines the list up with the button’s end, or its start when asked', async () => {
      screenWith({ left: 120, right: 360 });
      const view = await render();
      await open(view);
      expect(startAligned(view.element)).toBe(false);
      await open(view);

      view.host.align.set('start');
      await settle(view.fixture);
      await open(view);
      expect(startAligned(view.element)).toBe(true);
    });

    it('opens from the other edge when the list would run off the screen', async () => {
      screenWith({ left: 200, right: 440 });
      const view = await render();
      await open(view);
      expect(startAligned(view.element)).toBe(true);
      await open(view);

      screenWith({ left: -40, right: 200 });
      view.host.align.set('start');
      await settle(view.fixture);
      await open(view);
      expect(startAligned(view.element)).toBe(false);
    });

    it('reads the screen again each time it opens', async () => {
      screenWith({ left: 200, right: 440 });
      const view = await render();
      await open(view);
      expect(startAligned(view.element)).toBe(true);
      await open(view);

      screenWith({ left: 120, right: 360 });
      await open(view);
      expect(startAligned(view.element)).toBe(false);
    });
  });
});
