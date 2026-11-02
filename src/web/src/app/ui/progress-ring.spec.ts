import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ProgressRing } from './progress-ring';

@Component({
  imports: [ProgressRing],
  template: `<app-progress-ring
    [value]="value()"
    [max]="80"
    label="Calories"
    valueText="40 / 80 kcal"
  />`,
})
class Host {
  readonly value = signal(40);
}

describe('ProgressRing', () => {
  it('draws its fill through a custom property the stylesheet sweeps (W9), and keeps the progressbar', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const fill = fixture.nativeElement.querySelector('.fill') as SVGCircleElement;
    const bar = fixture.nativeElement.querySelector('[role="progressbar"]') as SVGSVGElement;
    // Half of 2π·26: the offset hides half the ring.
    expect(fill.style.getPropertyValue('--offset')).toBe('81.68');
    expect(fill.getAttribute('stroke-dashoffset')).toBeNull();
    expect(bar.getAttribute('aria-valuenow')).toBe('40');
    expect(bar.getAttribute('aria-valuetext')).toBe('40 / 80 kcal');
    expect(fixture.nativeElement.querySelector('strong').textContent).toBe('50%');

    fixture.componentInstance.value.set(80);
    await fixture.whenStable();
    expect(fill.style.getPropertyValue('--offset')).toBe('0.00');
    expect(bar.getAttribute('aria-valuenow')).toBe('80');
  });
});
