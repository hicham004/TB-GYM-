import { describe, expect, it } from 'vitest';
import {
  filterReplies,
  insertReply,
  mapSavedReplies,
  replyIssues,
  type SavedReply,
} from './saved-replies.models';

const reply = (title: string, body: string): SavedReply => ({
  id: title,
  title,
  body,
  version: 1,
});

const REPLIES = [
  reply('Check-in reminder', 'Your check-in is due today.'),
  reply('Deload week', 'Lighter this week, same sessions.'),
  reply('Évaluation', 'On refait le point dimanche.'),
];

describe('saved replies', () => {
  it('maps the server’s numbers, which may come as strings', () => {
    expect(
      mapSavedReplies({
        items: [
          { id: 'a', title: 'T', body: 'B', updatedAtUtc: '2026-10-04T08:00:00Z', version: '42' },
        ],
        maximum: '100',
      }),
    ).toEqual({ items: [{ id: 'a', title: 'T', body: 'B', version: 42 }], maximum: 100 });
  });

  it('finds a reply by every word typed, in its title or its text, ignoring case and accents', () => {
    expect(filterReplies(REPLIES, '').map((item) => item.title)).toHaveLength(3);
    expect(filterReplies(REPLIES, 'CHECK').map((item) => item.title)).toEqual([
      'Check-in reminder',
    ]);
    expect(filterReplies(REPLIES, 'evaluation').map((item) => item.title)).toEqual(['Évaluation']);
    expect(filterReplies(REPLIES, 'lighter sessions').map((item) => item.title)).toEqual([
      'Deload week',
    ]);
    expect(filterReplies(REPLIES, 'deload sunday')).toEqual([]);
  });

  it('puts a reply in an empty composer, or on a new line after what was written', () => {
    expect(insertReply('', 'Due today.')).toBe('Due today.');
    expect(insertReply('   ', 'Due today.')).toBe('Due today.');
    expect(insertReply('Hi Maya!', 'Due today.')).toBe('Hi Maya!\nDue today.');
    expect(insertReply('Hi Maya!\n', 'Due today.')).toBe('Hi Maya!\nDue today.');
  });

  it('says why a reply cannot be saved, field by field', () => {
    expect(replyIssues('Title', 'Text')).toEqual({ title: [], body: [] });
    expect(replyIssues('  ', 'Text').title).toEqual(['Give the reply a short title.']);
    expect(replyIssues('t'.repeat(61), 'Text').title).toEqual([
      'A title can be at most 60 characters.',
    ]);
    expect(replyIssues('Title', ' \n ').body).toEqual(['Write the reply’s text.']);
    expect(replyIssues('Title', 'b'.repeat(2001)).body).toEqual([
      'A reply can be at most 2000 characters.',
    ]);
  });
});
