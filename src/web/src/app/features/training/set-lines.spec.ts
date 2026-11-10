import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { settle } from '../../../testing/dom';
import { SetLines } from './set-lines';

describe('an exercise’s set lines on the grid', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('draws a line per run of sets, which breaks only between its parts', async () => {
    const fixture = TestBed.createComponent(SetLines);
    fixture.componentRef.setInput('lines', [
      '1 × 3 · RPE 8 · 86% of training max',
      '3 × 5 · 75% of training max',
    ]);
    await settle(fixture);
    const host = fixture.nativeElement as HTMLElement;
    const lines = Array.from(host.querySelectorAll('.run'));
    expect(lines.map((line) => line.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      '1 × 3 · RPE 8 · 86% of training max',
      '3 × 5 · 75% of training max',
    ]);
    // Each part is kept whole; a break falls before a dot, which a no-break space ties to the next part.
    expect(Array.from(lines[0].querySelectorAll('.part')).map((part) => part.textContent)).toEqual([
      '1 × 3',
      'RPE 8',
      '86% of training max',
    ]);
    expect(lines[0].querySelector('.sep')?.textContent).toBe(' · ');
  });

  it('keeps a last time + step line’s step and its start whole (N6a)', async () => {
    const fixture = TestBed.createComponent(SetLines);
    fixture.componentRef.setInput('lines', ['3 × 10 · last time + 2 kg · start 5 kg']);
    await settle(fixture);
    const host = fixture.nativeElement as HTMLElement;
    expect(Array.from(host.querySelectorAll('.part')).map((part) => part.textContent)).toEqual([
      '3 × 10',
      'last time + 2 kg',
      'start 5 kg',
    ]);
  });
});
