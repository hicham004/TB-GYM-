import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HeroLab } from './hero-lab';

describe('HeroLab prototype preview', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
  });
  afterEach(() => vi.unstubAllGlobals());

  function render() {
    TestBed.configureTestingModule({ imports: [HeroLab] });
    const fixture = TestBed.createComponent(HeroLab);
    fixture.detectChanges();
    return { fixture, lab: fixture.componentInstance };
  }

  it('uses the approved brand presets and lets a coach clear a need', () => {
    const { fixture, lab } = render();
    expect(lab.brand().name).toBe('Atlas Performance');
    lab.setBrand('cedar');
    expect(lab.brand().accent).toBe('#ffb48c');
    const first = lab.needs()[0];
    lab.resolveNeed(first);
    expect(lab.needs().map((need) => need.initials)).not.toContain('MR');
    expect(lab.needs()).toHaveLength(4);
    fixture.destroy();
  });

  it('keeps the preview workout local while sets, records and summary advance', () => {
    const { fixture, lab } = render();
    lab.openPlayer();
    expect(lab.scene()).toBe('player');
    lab.logSet();
    expect(lab.workout()[0].sets[0]).toMatchObject({ done: true, pr: true });
    expect(lab.personalRecords()).toHaveLength(1);
    expect(lab.restRemaining()).toBe(90);
    lab.skipRest();
    for (let index = 1; index < 4; index++) lab.logSet();
    expect(lab.exerciseComplete()).toBe(true);
    lab.nextExercise();
    expect(lab.exerciseIndex()).toBe(1);
    for (let index = 0; index < 3; index++) lab.logSet();
    lab.nextExercise();
    for (let index = 0; index < 3; index++) lab.logSet();
    lab.nextExercise();
    expect(lab.scene()).toBe('summary');
    expect(lab.doneCount()).toBe(10);
    expect(lab.volume()).toBeGreaterThan(0);
    lab.backToday();
    expect(lab.finished()).toBe(true);
    expect(lab.scene()).toBe('today');
    fixture.destroy();
  });
});
