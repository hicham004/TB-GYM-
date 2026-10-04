import type {
  SavedReplyList as ContractSavedReplyList,
  SavedReplyView as ContractSavedReplyView,
} from '../../core/api/generated';

/**
 * A coach's saved replies (C6, R3.5c, MSG-023) as the composer's sheet uses them. They are plain
 * text the coach drops into the composer and may still change; nothing here fills anything in.
 */
export interface SavedReply {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly version: number;
}

export interface SavedReplies {
  readonly items: readonly SavedReply[];
  /** How many one person may keep. */
  readonly maximum: number;
}

/** The same limits the server enforces, stated once for the form. */
export const maximumTitleLength = 60;
export const maximumReplyLength = 2000;

export function mapSavedReply(value: ContractSavedReplyView): SavedReply {
  return { id: value.id, title: value.title, body: value.body, version: Number(value.version) };
}

export function mapSavedReplies(value: ContractSavedReplyList): SavedReplies {
  return { items: value.items.map(mapSavedReply), maximum: Number(value.maximum) };
}

/** Every word typed must be in the title or the text, ignoring case and accents. */
export function filterReplies(items: readonly SavedReply[], search: string): readonly SavedReply[] {
  const words = searchable(search).split(/\s+/).filter(Boolean);
  if (words.length === 0) return items;
  return items.filter((item) => {
    const text = searchable(`${item.title} ${item.body}`);
    return words.every((word) => text.includes(word));
  });
}

/**
 * The composer's text once a reply is dropped in: the reply alone into an empty composer, or on a
 * new line after what the coach has already written, which is never replaced.
 */
export function insertReply(draft: string, body: string): string {
  if (draft.trim() === '') return body;
  return draft.endsWith('\n') ? `${draft}${body}` : `${draft}\n${body}`;
}

/** The reasons a reply cannot be saved yet, by field, in the order the server reports them. */
export function replyIssues(title: string, body: string): { title: string[]; body: string[] } {
  const name = title.trim();
  const text = body.trim();
  return {
    title:
      name === ''
        ? [$localize`Give the reply a short title.`]
        : name.length > maximumTitleLength
          ? [$localize`A title can be at most ${maximumTitleLength}:max: characters.`]
          : [],
    body:
      text === ''
        ? [$localize`Write the reply’s text.`]
        : text.length > maximumReplyLength
          ? [$localize`A reply can be at most ${maximumReplyLength}:max: characters.`]
          : [],
  };
}

function searchable(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
}
