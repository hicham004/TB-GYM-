import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientHoverCard, HOVER_CLOSE_MS, HOVER_OPEN_MS } from './client-hover-card';
import type { ClientRow } from './clients.models';

@Component({
  imports: [ClientHoverCard],
  template: `
    <ng-template #card let-row>
      <p class="card">{{ row.name }}</p>
    </ng-template>
    <div class="row" [appClientHoverCard]="row" [hoverCardTemplate]="card">
      <span class="who">{{ row.name }}</span>
    </div>
  `,
})
class Host {
  readonly row = { name: 'Tala Rizk' } as ClientRow;
}

/** The pointer this device has: one that hovers and points finely, or a finger's. */
function pointer(hovers: boolean): void {
  Object.defineProperty(document.defaultView, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn(() => ({ matches: hovers })),
  });
}

function enter(row: Element, pointerType?: string): void {
  const event = new Event('pointerenter', { bubbles: false });
  if (pointerType !== undefined)
    Object.defineProperty(event, 'pointerType', { value: pointerType });
  row.dispatchEvent(event);
}

const card = () => document.querySelector<HTMLElement>('.cdk-overlay-pane .card');

describe('a client’s hover card (motion plan W14)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (document.defaultView as { matchMedia?: unknown }).matchMedia;
    document.querySelector('.cdk-overlay-container')?.remove();
  });

  function render() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const row = fixture.nativeElement.querySelector('.row') as HTMLElement;
    return { fixture, row };
  }

  it('opens after 700 ms of the mouse resting on the row and closes 300 ms after it leaves', () => {
    pointer(true);
    const { fixture, row } = render();

    enter(row, 'mouse');
    vi.advanceTimersByTime(HOVER_OPEN_MS - 1);
    fixture.detectChanges();
    expect(card()).toBeNull();

    vi.advanceTimersByTime(1);
    fixture.detectChanges();
    expect(card()?.textContent?.trim()).toBe('Tala Rizk');
    const pane = card()?.closest<HTMLElement>('.cdk-overlay-pane');
    // A reading, not a control: never between the pointer and the rows, and nothing for a reader.
    expect(pane?.style.pointerEvents).toBe('none');
    expect(pane?.classList.contains('tb-hover-pane')).toBe(true);

    row.dispatchEvent(new Event('pointerleave'));
    vi.advanceTimersByTime(HOVER_CLOSE_MS - 1);
    expect(card()).not.toBeNull();

    vi.advanceTimersByTime(1);
    expect(card()).toBeNull();
  });

  it('stays when the mouse comes back before it has closed, and leaves at once on a press', () => {
    pointer(true);
    const { fixture, row } = render();

    enter(row, 'mouse');
    vi.advanceTimersByTime(HOVER_OPEN_MS);
    fixture.detectChanges();
    row.dispatchEvent(new Event('pointerleave'));
    vi.advanceTimersByTime(HOVER_CLOSE_MS - 50);
    enter(row, 'mouse');
    vi.advanceTimersByTime(1000);
    expect(card()).not.toBeNull();

    row.dispatchEvent(new Event('pointerdown'));
    expect(card()).toBeNull();
  });

  it('never opens for a finger, nor on a device whose pointer does not hover', () => {
    pointer(true);
    const first = render();
    enter(first.row, 'touch');
    vi.advanceTimersByTime(HOVER_OPEN_MS * 2);
    expect(card()).toBeNull();
    first.fixture.destroy();

    pointer(false);
    const second = render();
    enter(second.row, 'mouse');
    vi.advanceTimersByTime(HOVER_OPEN_MS * 2);
    expect(card()).toBeNull();
  });

  it('leaving the row before 700 ms opens nothing', () => {
    pointer(true);
    const { row } = render();

    enter(row, 'mouse');
    vi.advanceTimersByTime(HOVER_OPEN_MS - 100);
    row.dispatchEvent(new Event('pointerleave'));
    vi.advanceTimersByTime(HOVER_OPEN_MS);

    expect(card()).toBeNull();
  });
});
