import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { fold, settle, toggleFold } from '../../../testing/dom';
import { LIBRARY, versionView } from '../../../testing/program-builder-fixtures';
import { libraryExercise } from './program-builder.models';
import { ProgramPublishPreview } from './program-publish-preview';
import { draftFromVersion } from './training-builder.models';

async function render() {
  const program = draftFromVersion(versionView());
  program.description = 'Private description for the coaching team';
  const exercise = program.weeks[0].sessions[0].exercises[0];
  exercise.sets[0].manualLoadOverride = 80;
  exercise.sets[0].loadUnit = 'Pound';
  exercise.sets[0].coachNotes = 'Keep the bar close';
  exercise.sets[1].loadValue = 82.5;
  program.weeks[1].isPublished = false;
  program.weeks[1].sessions[0].name = 'Hidden session';
  const fixture = TestBed.createComponent(ProgramPublishPreview);
  fixture.componentRef.setInput('program', program);
  fixture.componentRef.setInput('library', LIBRARY.map(libraryExercise));
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, program };
}

describe('the program’s client preview', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('shows each set exactly, preserves overrides and notes, and makes no invented load or date', async () => {
    const { fixture, host, program } = await render();
    // The first workout starts open; each other one opens on a press.
    expect(fold(host, program.weeks[0].sessions[0].name).open).toBe(true);
    for (const session of program.weeks[0].sessions.slice(1)) {
      await toggleFold(fixture, host, session.name);
    }
    const text = host.textContent!;
    expect(text).toContain('80 lb fixed load');
    expect(text).toContain('82.5% of training max');
    expect(text).toContain('Keep the bar close');
    expect(text).toContain('Rest 180 seconds');
    expect(text).toContain('Day 1');
    expect(text).not.toContain(program.description);
    expect(host.querySelectorAll('.exercise').length).toBe(3);
  });

  it('names the lifts that will need a training max, and when their weights are worked out', async () => {
    const { host } = await render();
    const text = (selector: string) =>
      (host.querySelector(selector)?.textContent ?? '').replace(/\s+/g, ' ').trim();
    expect(text('[data-needs-max]')).toBe(
      'Needs a training max for: Back squat, Bench press · set when you assign the program',
    );
    expect(text('.explanation:last-child')).toBe(
      'Shared weeks open from the program’s start date. Weights are worked out when you assign the program, from this client’s training max.',
    );
  });

  it('gives an Epley set its own share and no weight, since a template has no client (critique B15)', async () => {
    const program = draftFromVersion(versionView());
    const set = program.weeks[0].sessions[0].exercises[0].sets[0];
    set.loadStrategy = 'RpeBasedEpley';
    set.repetitionsMinimum = 5;
    set.repetitionsMaximum = 5;
    set.exertionDisplayPreference = 'Rpe';
    set.exertionTarget = 8;
    const fixture = TestBed.createComponent(ProgramPublishPreview);
    fixture.componentRef.setInput('program', program);
    await settle(fixture);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      '5 · RPE 8 · 81% of training max',
    );
  });

  it('says nothing of maxes for a program whose weights are typed', async () => {
    const program = draftFromVersion(versionView());
    for (const set of program.weeks
      .flatMap((week) => week.sessions)
      .flatMap((session) => session.exercises)
      .flatMap((exercise) => exercise.sets)) {
      set.loadStrategy = 'Direct';
      set.loadValue = 60;
    }
    const fixture = TestBed.createComponent(ProgramPublishPreview);
    fixture.componentRef.setInput('program', program);
    await settle(fixture);
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('[data-needs-max]')).toBeNull();
    expect(host.querySelector('[data-weights-when]')).toBeNull();
    expect(host.textContent).toContain('Shared weeks open from the program’s start date.');
  });

  it('shows a last time + step set’s step and start, and asks no max for its lift (N6a)', async () => {
    const program = draftFromVersion(versionView());
    for (const week of program.weeks) {
      for (const set of week.sessions[1].exercises[0].sets) {
        Object.assign(set, { loadStrategy: 'LastTimeStep', loadStep: 2, loadValue: 40 });
      }
    }
    const fixture = TestBed.createComponent(ProgramPublishPreview);
    fixture.componentRef.setInput('program', program);
    await settle(fixture);
    const host = fixture.nativeElement as HTMLElement;
    await toggleFold(fixture, host, 'Upper A');
    const text = (selector: string) =>
      (host.querySelector(selector)?.textContent ?? '').replace(/\s+/g, ' ').trim();

    expect(host.textContent).toContain('5 · last time + 2 kg · start 40 kg · RPE 7');
    // Only the squat still works its weight out from a max.
    expect(text('[data-needs-max]')).toBe(
      'Needs a training max for: Back squat · set when you assign the program',
    );

    // A program of step sets alone says nothing of maxes.
    for (const set of program.weeks
      .flatMap((week) => week.sessions)
      .flatMap((session) => session.exercises)
      .flatMap((exercise) => exercise.sets)) {
      Object.assign(set, { loadStrategy: 'LastTimeStep', loadStep: 2.5, loadValue: null });
    }
    const typed = TestBed.createComponent(ProgramPublishPreview);
    typed.componentRef.setInput('program', structuredClone(program));
    await settle(typed);
    const typedHost = typed.nativeElement as HTMLElement;
    expect(typedHost.querySelector('[data-needs-max]')).toBeNull();
    expect(typedHost.querySelector('[data-weights-when]')).toBeNull();
    expect(typedHost.textContent).toContain('5 · last time + 2.5 kg · RPE 7');
  });

  it('shows the client’s unshared-week message without rendering its sessions', async () => {
    const { fixture, host } = await render();
    const radio = host.querySelector<HTMLInputElement>('input[value="1"]')!;
    radio.checked = true;
    radio.dispatchEvent(new Event('change'));
    await settle(fixture);
    expect(host.textContent).toContain('Your coach hasn’t shared this week yet');
    expect(host.textContent).not.toContain('Hidden session');
    expect(host.querySelector('.session')).toBeNull();
  });
});
