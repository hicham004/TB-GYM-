import { DOCUMENT } from '@angular/common';
import { afterNextRender, computed, ElementRef, inject, Injector, signal } from '@angular/core';
import { UiToast } from '../../ui/toast';
import { readTipClosed, writeTipClosed } from './builder-preferences';
import {
  accepts,
  applyDrop,
  type DayRef,
  daySessions,
  type DropTarget,
  findSession,
} from './program-builder.models';
import { type ChosenItem, chosenKey } from './program-library';
import type { ProgramDraft } from './training-builder.models';

/** What a page with a program grid lends the way of adding. */
export interface AddingGrid {
  readonly draft: () => ProgramDraft;
  readonly commit: (next: ProgramDraft) => void;
  /** The week a phone shows, where focus goes when a choice is let go and no + is there to take it. */
  readonly shownWeek: () => string | null;
  readonly focusWeek: (weekKey: string | undefined) => void;
  /** A day in the page's words: "day 3" on a program, a date on a client's weeks. */
  readonly dayName: (at: DayRef) => string;
  readonly newSessionName: string;
}

function chosenName(item: ChosenItem): string {
  return item.kind === 'library' ? item.exercise.name : item.saved.name;
}

/** While a row chosen with + waits, the name of the Add here a day offers, where it can land. */
export function dayAddHere(
  chosen: ChosenItem | null,
  target: DropTarget,
  week: number,
  day: string,
): string | null {
  if (!chosen || !accepts(chosen, target)) return null;
  return chosen.kind === 'library'
    ? $localize`Add here: a new workout on week ${week}:week:, ${day}:day:`
    : $localize`Add here: week ${week}:week:, ${day}:day:`;
}

/** The same on a workout, which takes an exercise and not a saved workout. */
export function sessionAddHere(
  chosen: ChosenItem | null,
  target: DropTarget,
  name: string,
  week: number,
  day: string,
): string | null {
  return chosen && accepts(chosen, target)
    ? $localize`Add here: ${name}:session:, week ${week}:week:, ${day}:day:`
    : null;
}

/**
 * Adding without dragging (critique B5b), the way the builder and Edit weeks share: a library row's +
 * chooses it, and every place a drop could land offers Add here, the grid's own select-then-place way
 * (WCAG 2.5.7). The page draws the grid; this keeps what is chosen, puts it where the coach says, tells
 * a screen reader, and looks after focus and the first-use tip.
 */
export class ProgramAdding {
  private readonly document = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly toast = inject(UiToast);

  /** The library row chosen with +, while the grid offers Add here for it. */
  readonly chosen = signal<ChosenItem | null>(null);
  readonly name = computed(() => {
    const item = this.chosen();
    return item ? chosenName(item) : null;
  });
  /** What a screen reader is told when a row is chosen, or let go without an add. */
  readonly status = signal('');
  /** "How adding works" beside the library: open on a first visit here, until the first add. */
  readonly tipOpen = signal(!readTipClosed('program'));
  private tipClosedOnce = !this.tipOpen();

  constructor(private readonly grid: AddingGrid) {}

  /** A row's + in the library: the grid offers Add here for it; a second press lets it go. */
  choose(item: ChosenItem): void {
    const chosen = this.chosen();
    if (chosen && chosenKey(chosen) === chosenKey(item)) {
      this.stop();
      return;
    }
    this.start(item);
  }

  start(item: ChosenItem): void {
    this.chosen.set(item);
    this.status.set(
      item.kind === 'library'
        ? $localize`${item.exercise.name}:exercise: chosen. Press Add here on a workout, or on a rest day to start one.`
        : $localize`${item.saved.name}:session: chosen. Press Add here on a day for a copy of it.`,
    );
  }

  /** An Add here on the grid: what was chosen goes there, last, and says where it went. */
  addHere(target: DropTarget): void {
    const item = this.chosen();
    if (!item) return;
    const before = this.grid.draft();
    const weekKey = target.kind === 'session' ? target.ref.weekKey : target.at.weekKey;
    const week = before.weeks.find((row) => row.key === weekKey);
    if (!week) return;
    const index =
      target.kind === 'session' ? Number.MAX_SAFE_INTEGER : daySessions(week, target.at.day).length;
    const next = applyDrop(before, item, target, index, this.grid.newSessionName);
    if (next === before) return;
    this.grid.commit(next);
    this.added();
    this.toast.show(this.whereItWent(item, target, before), { tone: 'success' });
    this.grid.focusWeek(week.key);
  }

  /** A row reached the grid, by Add here or a drop: that ends a choice, and folds the first-use tip. */
  added(): void {
    this.chosen.set(null);
    this.status.set('');
    if (!this.tipClosedOnce) this.tipChanged(false);
  }

  /**
   * Escape, Cancel or a second press: nothing is added. Focus on an Add here or on Cancel, which go
   * with the choice, moves to the row's + in the library, or to the week shown on a phone.
   */
  stop(): void {
    const item = this.chosen();
    if (!item) return;
    const active = this.document.activeElement;
    const losing = active instanceof HTMLElement && !!active.closest('.add-here, app-adding-bar');
    this.chosen.set(null);
    this.status.set($localize`${chosenName(item)}:name: not added.`);
    if (!losing) return;
    const week = this.grid.shownWeek() ?? undefined;
    afterNextRender(
      () => {
        const plus = this.host.nativeElement.querySelector<HTMLElement>(
          `app-program-library [data-choose="${chosenKey(item)}"]`,
        );
        plus?.focus();
        if (!plus || this.document.activeElement !== plus) this.grid.focusWeek(week);
      },
      { injector: this.injector },
    );
  }

  /** Escape lets a chosen row go, unless an open sheet or menu took the key for itself. */
  onEscape(event: Event): void {
    if (this.chosen() && !event.defaultPrevented) this.stop();
  }

  /** "How adding works" opened or folded; folded once, it stays folded on later visits. */
  tipChanged(open: boolean): void {
    this.tipOpen.set(open);
    if (open) return;
    this.tipClosedOnce = true;
    writeTipClosed('program');
  }

  reset(): void {
    this.chosen.set(null);
    this.status.set('');
  }

  /**
   * "Back Squat added to Lower A.", or where the new workout or the copy is. Only an exercise goes
   * into a workout; on a day, an exercise starts a workout and a saved workout is copied.
   */
  private whereItWent(item: ChosenItem, target: DropTarget, before: ProgramDraft): string {
    if (target.kind === 'session') {
      const name = findSession(before, target.ref)?.name.trim() || $localize`the workout`;
      return $localize`${chosenName(item)}:exercise: added to ${name}:session:.`;
    }
    const week = before.weeks.findIndex((row) => row.key === target.at.weekKey) + 1;
    const day = this.grid.dayName(target.at);
    return item.kind === 'library'
      ? $localize`${item.exercise.name}:exercise: added: a new workout on week ${week}:week:, ${day}:day:.`
      : $localize`${item.saved.name}:session: added on week ${week}:week:, ${day}:day:.`;
  }
}
