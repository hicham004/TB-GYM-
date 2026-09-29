import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { press, query, settle } from '../../testing/dom';
import { UiToast } from './toast';

@Component({
  template: `
    <button type="button" (click)="success()">Show success</button>
    <button type="button" (click)="error()">Show error</button>
    <button type="button" (click)="action()">Show action</button>
  `,
})
class Host {
  private readonly toast = inject(UiToast);
  actionCount = 0;

  success(): void {
    this.toast.show('Plan saved', { tone: 'success', durationMs: 120 });
  }

  error(): void {
    this.toast.show('The plan could not be saved', { tone: 'error' });
  }

  action(): void {
    this.toast.show('Plan removed', {
      action: { label: 'Undo', run: () => this.actionCount++ },
    });
  }
}

async function render() {
  await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement };
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('UiToast', () => {
  it('announces a short success politely, pauses on hover, then dismisses on time', async () => {
    const { fixture, host } = await render();
    press(host, 'Show success');
    await settle(fixture);

    const card = query<HTMLElement>(document, '.tb-toast');
    const message = query<HTMLElement>(card, '[role="status"]');
    expect(message.textContent?.trim()).toBe('Plan saved');
    expect(message.getAttribute('aria-live')).toBe('polite');
    expect(card.querySelector('button')?.getAttribute('aria-label')).toBe('Dismiss notification');

    card.dispatchEvent(new MouseEvent('mouseenter'));
    await delay(140);
    expect(document.querySelector('[role="status"]')).not.toBeNull();

    card.dispatchEvent(new MouseEvent('mouseleave'));
    await delay(140);
    fixture.detectChanges();
    expect(document.querySelector('[role="status"]')).toBeNull();
  });

  it('keeps an error until dismissed and announces it assertively', async () => {
    const { fixture, host } = await render();
    press(host, 'Show error');
    await settle(fixture);

    const message = query<HTMLElement>(document, '[role="alert"]');
    expect(message.textContent?.trim()).toBe('The plan could not be saved');
    expect(message.getAttribute('aria-live')).toBe('assertive');
    await delay(40);
    expect(document.querySelector('[role="alert"]')).not.toBeNull();

    query<HTMLButtonElement>(document, '[aria-label="Dismiss notification"]').click();
    await settle(fixture);
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it('keeps an actionable toast until its control runs', async () => {
    const { fixture, host } = await render();
    press(host, 'Show action');
    await settle(fixture);

    expect(query<HTMLElement>(document, '[role="status"]').textContent?.trim()).toBe(
      'Plan removed',
    );
    await delay(40);
    expect(document.querySelector('[role="status"]')).not.toBeNull();
    press(document, 'Undo');
    await settle(fixture);
    expect(fixture.componentInstance.actionCount).toBe(1);
    expect(document.querySelector('[role="status"]')).toBeNull();
  });
});
