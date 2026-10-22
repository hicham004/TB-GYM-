import { provideLocationMocks } from '@angular/common/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { confirmBeforeLeaving, confirmSheetLeave, type HoldsUnsavedWork } from './leave-guard';
import { UnsavedWork } from './unsaved-work';

@Component({ template: '<p>Other page</p>' })
class OtherPage {}

/** An editor page whose own answer the test sets, noting in `asked` when it was asked. */
@Component({ template: '<p>Editor</p>' })
class EditorPage implements HoldsUnsavedWork {
  answer: boolean | Promise<boolean> = true;
  asked: string[] | null = null;

  canLeave(): boolean | Promise<boolean> {
    this.asked?.push('page');
    return this.answer;
  }
}

async function open(path: '/sheets-only' | '/editor') {
  TestBed.configureTestingModule({
    providers: [
      provideLocationMocks(),
      provideRouter([
        { path: 'other', component: OtherPage },
        { path: 'sheets-only', component: EditorPage, canDeactivate: [confirmSheetLeave] },
        { path: 'editor', component: EditorPage, canDeactivate: [confirmBeforeLeaving] },
      ]),
    ],
  });
  const harness = await RouterTestingHarness.create();
  const page = await harness.navigateByUrl(path, EditorPage);
  const asked: string[] = [];
  page.asked = asked;
  return { harness, page, asked, router: TestBed.inject(Router) };
}

/** An open sheet, as `GuardedSheets` registers one, answering the leave question as told. */
function openSheet(asked: string[], answer: boolean | Promise<boolean>): () => void {
  return TestBed.inject(UnsavedWork).registerSheet({
    canLeave: () => {
      asked.push('sheet');
      return answer;
    },
  });
}

describe('the leave guards', () => {
  afterEach(() => TestBed.resetTestingModule());

  describe('confirmSheetLeave, for a page whose only typed work is in its sheets', () => {
    it('lets the person leave when every open sheet agrees, and never asks the page', async () => {
      const { asked, router } = await open('/sheets-only');
      openSheet(asked, true);

      expect(await router.navigateByUrl('/other')).toBe(true);
      expect(router.url).toBe('/other');
      expect(asked).toEqual(['sheet']);
    });

    it('keeps the person on the page while an open sheet keeps its work', async () => {
      const { asked, router } = await open('/sheets-only');
      openSheet(asked, false);

      expect(await router.navigateByUrl('/other')).toBe(false);
      expect(router.url).toBe('/sheets-only');
    });

    it('lets the person go at once when no sheet is open, even though the page would refuse', async () => {
      const { page, asked, router } = await open('/sheets-only');
      page.answer = false;

      expect(await router.navigateByUrl('/other')).toBe(true);
      expect(asked).toEqual([]);
    });
  });

  describe('confirmBeforeLeaving, for an editor page', () => {
    it('asks the open sheets first, then the page, and lets the person go when both agree', async () => {
      const { asked, router } = await open('/editor');
      openSheet(asked, true);

      expect(await router.navigateByUrl('/other')).toBe(true);
      expect(router.url).toBe('/other');
      expect(asked).toEqual(['sheet', 'page']);
    });

    it('keeps the person there when a sheet keeps its work, without asking the page', async () => {
      const { asked, router } = await open('/editor');
      openSheet(asked, false);

      expect(await router.navigateByUrl('/other')).toBe(false);
      expect(router.url).toBe('/editor');
      expect(asked).toEqual(['sheet']);
    });

    it('keeps the person there when the page keeps its work', async () => {
      const { page, asked, router } = await open('/editor');
      page.answer = false;

      expect(await router.navigateByUrl('/other')).toBe(false);
      expect(router.url).toBe('/editor');
      expect(asked).toEqual(['page']);
    });

    it('holds the navigation until the page answers, then follows the answer', async () => {
      const { page, router } = await open('/editor');
      let answer!: (leave: boolean) => void;
      page.answer = new Promise<boolean>((resolve) => (answer = resolve));

      const leaving = router.navigateByUrl('/other');
      await new Promise((resolve) => setTimeout(resolve));
      expect(router.url).toBe('/editor');

      answer(true);
      expect(await leaving).toBe(true);
      expect(router.url).toBe('/other');
    });
  });
});
