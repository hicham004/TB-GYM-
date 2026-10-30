import { describe, expect, it } from 'vitest';
import { BACK_SQUAT } from '../../../testing/exercise-fixtures';
import {
  cardCover,
  cardMenu,
  coverFromAsset,
  emptyExercise,
  exerciseCard,
  exerciseErrors,
  exerciseRequest,
  filterParams,
  filtersFrom,
  initialsOf,
  isFiltered,
  NO_FACETS,
  parseVideoLink,
  statusOptions,
  summaryLine,
  valuesFrom,
  withFilter,
  withoutFilters,
} from './exercise-library.models';
import { access, asset, exercise } from '../../../testing/exercise-fixtures';

describe('the exercise library, in coach words', () => {
  it('reads filters from the address, ignoring values the server would refuse', () => {
    const filters = filtersFrom({
      q: 'row',
      muscle: 'Back',
      pattern: 'Cartwheel',
      tag: ' knee-friendly ',
      archived: '1',
      view: 'list',
    });
    expect(filters).toEqual({
      query: 'row',
      muscle: 'Back',
      pattern: null,
      type: null,
      typeName: null,
      equipment: null,
      tag: 'knee-friendly',
      archived: true,
      view: 'list',
    });
    expect(filterParams(filtersFrom({}))).toEqual({
      q: null,
      muscle: null,
      pattern: null,
      type: null,
      equipment: null,
      tag: null,
      archived: null,
      view: null,
    });
  });

  it('reads a type that is none of the seven as one of the coach’s own, under Other', () => {
    expect(filtersFrom({ type: 'WarmUp' })).toMatchObject({ type: 'WarmUp', typeName: null });
    const own = filtersFrom({ type: ' Rehab ' });
    expect(own).toMatchObject({ type: 'Other', typeName: 'Rehab' });
    expect(filterParams(own)).toMatchObject({ type: 'Rehab' });
    // The old General is no type any more: a link that kept it now names an own type of that name.
    expect(filtersFrom({ type: 'General' })).toMatchObject({ type: 'Other', typeName: 'General' });
    expect(withFilter(own, 'type', 'Power')).toMatchObject({ type: 'Power', typeName: null });
    expect(withFilter(filtersFrom({}), 'type', 'own:Prehab')).toMatchObject({
      type: 'Other',
      typeName: 'Prehab',
    });
    expect(withFilter(own, 'type', '')).toMatchObject({ type: null, typeName: null });
  });

  it('keeps the view and the layout when the filters are cleared, as neither is a filter', () => {
    const archived = filtersFrom({ archived: '1', view: 'list', tag: 'home', q: 'row' });
    expect(isFiltered(filtersFrom({ archived: '1' }))).toBe(false);
    expect(withoutFilters(archived)).toEqual({ ...filtersFrom({}), archived: true, view: 'list' });
  });

  it('offers Your exercises and Archived (n) while something is archived or the view is open', () => {
    expect(statusOptions(NO_FACETS, false, 'en-US')).toEqual([]);
    expect(statusOptions({ ...NO_FACETS, archived: 1200 }, false, 'en-US')).toEqual([
      { value: 'active', label: 'Your exercises' },
      { value: 'archived', label: 'Archived (1,200)' },
    ]);
    expect(statusOptions(NO_FACETS, true, 'en-US').map((option) => option.label)).toEqual([
      'Your exercises',
      'Archived (0)',
    ]);
  });

  it('counts with the server’s total, and says when the filters narrow it', () => {
    const plain = filtersFrom({});
    expect(summaryLine(1, 1, plain, 'en-US')).toBe('1 exercise');
    expect(summaryLine(1250, 48, plain, 'en-US')).toBe('48 of 1,250 shown');
    expect(summaryLine(3, 3, filtersFrom({ q: 'press' }), 'en-US')).toBe('3 exercises match');
    expect(summaryLine(1, 1, filtersFrom({ archived: '1' }), 'en-US')).toBe('1 archived exercise');
    expect(summaryLine(4, 4, filtersFrom({ archived: '1' }), 'en-US')).toBe('4 archived exercises');
  });

  it('opens a link on the video’s own page only, from the list or a grant, under its own title', () => {
    const link = asset({
      kind: 'Video',
      source: 'ExternalEmbed',
      externalTitle: '  The Hip Hinge ',
      watchUrl: 'https://vimeo.com/76979871',
    });
    expect(coverFromAsset(link)).toEqual({
      kind: 'link',
      provider: 'Vimeo',
      url: 'https://vimeo.com/76979871',
      title: 'The Hip Hinge',
    });
    // An address that is neither provider's page is never a link.
    expect(coverFromAsset({ ...link, watchUrl: 'https://example.com/x' })).toEqual({
      kind: 'video',
      label: 'Video link',
    });
    expect(
      cardCover(
        access({
          kind: 'Video',
          source: 'ExternalEmbed',
          watchUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          externalTitle: null,
        }),
      ),
    ).toEqual({
      kind: 'link',
      provider: 'YouTube',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: null,
    });
    const card = exerciseCard(exercise('Hip Hinge'));
    expect(cardMenu(card, coverFromAsset(link)).map((item) => [item.label, item.href])).toEqual([
      ['Watch on Vimeo', 'https://vimeo.com/76979871'],
      ['Edit', undefined],
      ['Archive', undefined],
    ]);
    expect(cardMenu(card, null)).toBe(card.menu);
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
