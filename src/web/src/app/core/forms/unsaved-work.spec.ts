import { describe, expect, it } from 'vitest';
import type { HoldsUnsavedWork } from './leave-guard';
import { UnsavedWork } from './unsaved-work';

/** An open editor that answers the leave question as told, and notes in `asked` when it was asked. */
function editor(
  name: string,
  asked: string[],
  answer: boolean | (() => boolean | Promise<boolean>) = true,
): HoldsUnsavedWork {
  return {
    canLeave: () => {
      asked.push(name);
      return typeof answer === 'function' ? answer() : answer;
    },
  };
}

describe('UnsavedWork', () => {
  it('lets a workspace switch or a sign-out go ahead when no editor is open', async () => {
    const work = new UnsavedWork();

    expect(await work.confirmLeave()).toBe(true);
    expect(await work.confirmSheets()).toBe(true);
  });

  it('asks every open sheet before any page, each in the order it opened', async () => {
    const work = new UnsavedWork();
    const asked: string[] = [];
    work.register(editor('page one', asked));
    work.registerSheet(editor('sheet one', asked));
    work.register(editor('page two', asked));
    work.registerSheet(editor('sheet two', asked));

    expect(await work.confirmLeave()).toBe(true);
    expect(asked).toEqual(['sheet one', 'sheet two', 'page one', 'page two']);
  });

  it('stops at the first sheet that keeps its work: nothing after it is asked', async () => {
    const work = new UnsavedWork();
    const asked: string[] = [];
    work.registerSheet(editor('sheet one', asked));
    work.registerSheet(editor('sheet two', asked, false));
    work.registerSheet(editor('sheet three', asked));
    work.register(editor('page', asked));

    expect(await work.confirmLeave()).toBe(false);
    expect(asked).toEqual(['sheet one', 'sheet two']);
  });

  it('stops at the first page that keeps its work once every sheet agreed', async () => {
    const work = new UnsavedWork();
    const asked: string[] = [];
    work.registerSheet(editor('sheet', asked));
    work.register(editor('page one', asked, false));
    work.register(editor('page two', asked));

    expect(await work.confirmLeave()).toBe(false);
    expect(asked).toEqual(['sheet', 'page one']);
  });

  it('waits for an answer given later before asking the next editor', async () => {
    const work = new UnsavedWork();
    const asked: string[] = [];
    let answer!: (leave: boolean) => void;
    work.registerSheet(
      editor('sheet', asked, () => new Promise<boolean>((resolve) => (answer = resolve))),
    );
    work.register(editor('page', asked));

    const leaving = work.confirmLeave();
    await new Promise((resolve) => setTimeout(resolve));
    // The sheet's question is still open: the page has not been asked yet.
    expect(asked).toEqual(['sheet']);

    answer(true);
    expect(await leaving).toBe(true);
    expect(asked).toEqual(['sheet', 'page']);
  });

  it('asks only the sheets when only the sheets are asked, so a page that would refuse is not', async () => {
    const work = new UnsavedWork();
    const asked: string[] = [];
    work.registerSheet(editor('sheet', asked));
    work.register(editor('page', asked, false));

    expect(await work.confirmSheets()).toBe(true);
    expect(asked).toEqual(['sheet']);
  });

  it('no longer asks an editor once it has gone and removed itself', async () => {
    const work = new UnsavedWork();
    const asked: string[] = [];
    const removeSheet = work.registerSheet(editor('sheet', asked, false));
    const removePage = work.register(editor('page', asked, false));

    removeSheet();
    removePage();

    expect(await work.confirmLeave()).toBe(true);
    expect(asked).toEqual([]);
  });

  it('still asks the others when an editor goes away while it is being asked', async () => {
    const work = new UnsavedWork();
    const asked: string[] = [];
    // A sheet whose question ends with the sheet closing, which removes it from the list.
    let removeFirst: () => void = () => undefined;
    removeFirst = work.registerSheet(
      editor('closing sheet', asked, () => {
        removeFirst();
        return true;
      }),
    );
    work.registerSheet(editor('other sheet', asked));
    work.register(editor('page', asked));

    expect(await work.confirmLeave()).toBe(true);
    expect(asked).toEqual(['closing sheet', 'other sheet', 'page']);

    // Gone for good: the next switch asks only the editors still open.
    asked.length = 0;
    expect(await work.confirmLeave()).toBe(true);
    expect(asked).toEqual(['other sheet', 'page']);
  });
});
