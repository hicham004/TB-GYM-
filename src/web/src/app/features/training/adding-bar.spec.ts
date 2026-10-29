import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { settle } from '../../../testing/dom';
import { ADDING_BAR_BLOCK_SIZE, AddingBar } from './adding-bar';

@Component({
  imports: [AddingBar],
  template: `@if (shown()) {
    <app-adding-bar [name]="name()" (cancelled)="cancels = cancels + 1" />
  }`,
})
class Host {
  readonly shown = signal(true);
  readonly name = signal('Lentil soup');
  cancels = 0;
}

async function render() {
  const fixture = TestBed.createComponent(Host);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement };
}

describe('the adding bar (critique B5b)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.style.removeProperty(ADDING_BAR_BLOCK_SIZE);
  });

  it('says what is being added, the name in its own writing direction, and cancels', async () => {
    const { fixture, host } = await render();

    const text = host.querySelector('.text')!;
    expect(text.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Adding Lentil soup: press Add here where it goes.',
    );
    expect(text.querySelector('bdi')?.textContent).toBe('Lentil soup');
    host.querySelector<HTMLButtonElement>('button')!.click();
    expect(fixture.componentInstance.cancels).toBe(1);
  });

  it('publishes the room it takes at the foot of the screen, and takes it away when it goes', async () => {
    // jsdom has no layout, so the observer reports once on observe and the height reads as 0px.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private readonly report: () => void) {}
        observe(): void {
          this.report();
        }
        disconnect(): void {
          // Nothing to release.
        }
      },
    );
    const root = document.documentElement.style;
    const { fixture } = await render();
    expect(root.getPropertyValue(ADDING_BAR_BLOCK_SIZE)).toBe('calc(0px + 1.25rem)');

    fixture.componentInstance.shown.set(false);
    await settle(fixture);
    expect(root.getPropertyValue(ADDING_BAR_BLOCK_SIZE)).toBe('');
  });
});
