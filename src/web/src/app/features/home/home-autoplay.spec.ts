import { describe, expect, it } from 'vitest';
import { Autoplay } from './home-autoplay';

function visibleAutoplay(count = 3, reducedMotion = false): Autoplay {
  const autoplay = new Autoplay(count, reducedMotion);
  autoplay.setOnScreen(true);
  return autoplay;
}

function focusEvent(region: HTMLElement, next: HTMLElement | null): FocusEvent {
  const event = new FocusEvent('focusout', { relatedTarget: next });
  Object.defineProperty(event, 'currentTarget', { value: region });
  return event;
}

describe('Autoplay', () => {
  it('advances through the steps and wraps back to the first', () => {
    const autoplay = visibleAutoplay(3);

    autoplay.advance();
    autoplay.advance();
    expect(autoplay.active()).toBe(2);

    autoplay.advance();
    expect(autoplay.active()).toBe(0);
  });

  it('runs only on screen, in a visible tab, unpaused and untouched', () => {
    const autoplay = new Autoplay(3, false);
    expect(autoplay.running()).toBe(false);

    autoplay.setOnScreen(true);
    expect(autoplay.running()).toBe(true);

    autoplay.setPageVisible(false);
    expect(autoplay.running()).toBe(false);
    autoplay.setPageVisible(true);

    autoplay.togglePaused();
    expect(autoplay.running()).toBe(false);
    autoplay.togglePaused();
    expect(autoplay.running()).toBe(true);
  });

  it('never runs when the visitor asked for reduced motion', () => {
    const autoplay = visibleAutoplay(3, true);

    expect(autoplay.running()).toBe(false);
  });

  it('holds while pointed at or focused, and each release is independent', () => {
    const autoplay = visibleAutoplay();

    autoplay.hold('pointer', true);
    autoplay.hold('focus', true);
    autoplay.hold('pointer', false);
    expect(autoplay.running()).toBe(false);

    autoplay.hold('focus', false);
    expect(autoplay.running()).toBe(true);
  });

  it('keeps the focus hold while focus moves inside the demo and releases it on leaving', () => {
    const autoplay = visibleAutoplay();
    const region = document.createElement('div');
    const inside = region.appendChild(document.createElement('button'));
    const outside = document.createElement('button');

    autoplay.hold('focus', true);
    autoplay.focusOut(focusEvent(region, inside));
    expect(autoplay.running()).toBe(false);

    autoplay.focusOut(focusEvent(region, outside));
    expect(autoplay.running()).toBe(true);
  });

  it('lets the visitor pick any step directly', () => {
    const autoplay = visibleAutoplay(5);

    autoplay.select(3);

    expect(autoplay.active()).toBe(3);
  });
});
