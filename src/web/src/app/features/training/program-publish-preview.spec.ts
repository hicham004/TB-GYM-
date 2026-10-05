import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { settle } from '../../../testing/dom';
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
    const { host, program } = await render();
    const text = host.textContent!;
    expect(text).toContain('80 lb fixed load');
    expect(text).toContain('82.5% of training max');
    expect(text).toContain('Keep the bar close');
    expect(text).toContain('Rest 180 seconds');
    expect(text).toContain('Day 1');
    expect(text).not.toContain(program.description);
    expect(host.querySelectorAll('.exercise').length).toBe(3);
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
