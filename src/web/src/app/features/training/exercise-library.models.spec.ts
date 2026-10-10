import { describe, expect, it } from 'vitest';
import { BACK_SQUAT } from '../../../testing/exercise-fixtures';
import {
  emptyExercise,
  exerciseErrors,
  exerciseRequest,
  filterParams,
  filtersFrom,
  initialsOf,
  parseVideoLink,
  summaryLine,
  valuesFrom,
} from './exercise-library.models';

describe('the exercise library, in coach words', () => {
  it('reads filters from the address, ignoring values the server would refuse', () => {
    const filters = filtersFrom({
      q: 'row',
      muscle: 'Back',
      type: 'Yoga',
      archived: '1',
      view: 'list',
    });
    expect(filters).toEqual({
      query: 'row',
      muscle: 'Back',
      pattern: null,
      type: null,
      equipment: null,
      archived: true,
      view: 'list',
    });
    expect(filterParams(filtersFrom({}))).toEqual({
      q: null,
      muscle: null,
      pattern: null,
      type: null,
      equipment: null,
      archived: null,
      view: null,
    });
  });

  it('counts with the server’s total, and says when the filters narrow it', () => {
    const plain = filtersFrom({});
    expect(summaryLine(1, 1, plain, 'en-US')).toBe('1 exercise');
    expect(summaryLine(1250, 48, plain, 'en-US')).toBe('48 of 1,250 shown');
    expect(summaryLine(3, 3, filtersFrom({ q: 'press' }), 'en-US')).toBe('3 exercises match');
  });

  it('letters a tile from the first two words', () => {
    expect(initialsOf('Romanian deadlift')).toBe('RD');
    expect(initialsOf('Pull-up')).toBe('PU');
    expect(initialsOf('Plank')).toBe('PL');
    expect(initialsOf('  ')).toBe('?');
  });

  it('finds the video in the links coaches copy, and nothing else', () => {
    expect(parseVideoLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42')).toEqual({
      provider: 'YouTube',
      id: 'dQw4w9WgXcQ',
    });
    expect(parseVideoLink('youtu.be/dQw4w9WgXcQ')?.id).toBe('dQw4w9WgXcQ');
    expect(parseVideoLink('https://youtube.com/shorts/dQw4w9WgXcQ')?.id).toBe('dQw4w9WgXcQ');
    expect(parseVideoLink('https://m.youtube.com/embed/dQw4w9WgXcQ')?.id).toBe('dQw4w9WgXcQ');
    expect(parseVideoLink('https://vimeo.com/channels/staff/123456789')).toEqual({
      provider: 'Vimeo',
      id: '123456789',
    });
    expect(parseVideoLink('https://player.vimeo.com/video/76979871')?.id).toBe('76979871');
    expect(parseVideoLink('https://www.youtube.com/watch?v=short')).toBeNull();
    expect(parseVideoLink('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(parseVideoLink('not a link')).toBeNull();
  });

  it('checks what the server would refuse before sending', () => {
    const valid = { ...emptyExercise(), name: 'Front squat' };
    expect(exerciseErrors(valid)).toEqual({});
    expect(Object.keys(exerciseErrors({ ...valid, name: 'x'.repeat(161) }))).toEqual(['name']);
    expect(Object.keys(exerciseErrors({ ...valid, tags: `ok, ${'t'.repeat(61)}` }))).toEqual([
      'tags',
    ]);
    expect(Object.keys(exerciseErrors({ ...valid, videoLink: 'youtube.com' }))).toEqual([
      'videoLink',
    ]);
  });

  it('sends the primary muscle once, secondary ones apart from it, and unique tags', () => {
    const values = {
      ...valuesFrom(BACK_SQUAT),
      secondaryMuscles: ['Glutes', 'Quadriceps'] as const,
      tags: 'compound, compound , home',
    };
    const request = exerciseRequest(values, ['m-1']);
    expect(request.muscles).toEqual([
      { muscle: 'Quadriceps', role: 'Primary' },
      { muscle: 'Glutes', role: 'Secondary' },
    ]);
    expect(request.tags).toEqual(['compound', 'home']);
    expect(request.mediaAssetIds).toEqual(['m-1']);
  });
});
