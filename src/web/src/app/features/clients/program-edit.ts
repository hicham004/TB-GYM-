import {
  CdkDrag,
  type CdkDragDrop,
  CdkDragHandle,
  CdkDragPlaceholder,
  CdkDragPreview,
  CdkDropList,
} from '@angular/cdk/drag-drop';
import { CdkScrollable } from '@angular/cdk/scrolling';
import { formatDate } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  LOCALE_ID,
  signal,
  TemplateRef,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom, type Observable } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import type {
  ClientSessionState,
  FeatureAccessReason,
  ProgramEditPreviewView,
  ProgramEditWeekRequest,
  SavedSessionView,
} from '../../core/api/generated';
import type { HoldsUnsavedWork } from '../../core/forms/leave-guard';
import { UnsavedWork } from '../../core/forms/unsaved-work';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantAsyncScope, type TenantOperation } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button, ButtonLink } from '../../ui/button';
import { Checkbox } from '../../ui/checkbox';
import { UiConfirm } from '../../ui/confirm';
import { UiDialog } from '../../ui/dialog';
import { Control } from '../../ui/field';
import { Icon } from '../../ui/icon';
import { UiMenu, type UiMenuItem } from '../../ui/menu';
import { UiSheet } from '../../ui/sheet';
import { Skeleton } from '../../ui/skeleton';
import { StatusPill } from '../../ui/status-pill';
import { UiToast } from '../../ui/toast';
import {
  accepts,
  addExercise,
  addWeek,
  applyDrop,
  copySession,
  DAYS,
  type DayRef,
  daySessions,
  type DraftProblem,
  type DragItem,
  type DropTarget,
  exerciseSummary,
  findSession,
  insertSavedSession,
  libraryExercise,
  type LibraryExercise,
  MAX_WEEKS,
  removeExercise,
  removeSession,
  removeWeek,
  resortDays,
  type SessionRef,
  startSessionWith,
} from '../training/program-builder.models';
import { ExerciseDemo } from '../training/exercise-demo';
import { type LibraryThumbs, ProgramLibrary } from '../training/program-library';
import { ProgramSessionEditor } from '../training/program-session-editor';
import { ProgramSetsEditor } from '../training/program-sets-editor';
import {
  type DraftExercise,
  type DraftSession,
  type DraftWeek,
  emptyProgram,
  numeric,
  type ProgramDraft,
} from '../training/training-builder.models';
import { programWriteError } from './client-program-forms.models';
import { ClientProgramApi } from './client-program-api';
import { trainingClosed } from './client-profile.models';
import { addDays, daysBetween } from './client-overview.models';
import { ClientWorkspaceContext } from './client-workspace.context';
import {
  canMoveWeek,
  canRemoveWeek,
  dayDate,
  duplicateEditWeek,
  editProblem,
  editRequest,
  editReview,
  type EditReview,
  hasEdits,
  isClosedDay,
  type LockedSession,
  moveEditWeek,
  programEdit,
  type ProgramEdit,
} from './program-edit.models';

interface Closable {
  close(): void;
}

type PickTarget = { kind: 'session'; ref: SessionRef } | { kind: 'day'; at: DayRef };

interface ExerciseCell {
  key: string;
  draft: DraftExercise;
  editLabel: string;
  name: string;
  line: string;
  isMainLift: boolean;
  drag: DragItem;
  /** The library's demos of this exercise, for Watch demo (P4). */
  media: readonly string[];
}

interface SessionCell {
  key: string;
  listId: string;
  name: string;
  countLabel: string;
  ref: SessionRef;
  drag: DragItem;
  target: DropTarget;
  exercises: ExerciseCell[];
  menu: UiMenuItem[];
  menuLabel: string;
  addLabel: string;
}

interface DayCell {
  day: number;
  listId: string;
  /** "Mon 12". */
  label: string;
  /** A day already gone: it takes nothing new. */
  closed: boolean;
  at: DayRef;
  target: DropTarget;
  locked: readonly LockedSession[];
  sessions: SessionCell[];
  addLabel: string;
}

interface WeekRow {
  key: string;
  number: number;
  title: string;
  /** "Mon 12 – Sun 18 Oct". */
  dates: string;
  /** It holds a session that started or passed, so it keeps its place. */
  frozen: boolean;
  week: DraftWeek;
  days: DayCell[];
  menu: UiMenuItem[];
  menuLabel: string;
  labelName: string;
}

/** What went wrong with a review or an apply, and whether reading the program again is the way on. */
interface EditFailure {
  message: string;
  reload: boolean;
}

/**
 * A client's weeks in the builder's grid (P3b, TRN-028): the sessions still to come are edited
 * with the builder's drops, menus and sheets, beside the ones that started, finished or passed,
 * which are locked. Nothing is kept until the coach reviews what the server says the edit does,
 * every new weight worked out, and applies it; the server plans it again, checks the plan and the
 * program's version, and records it. Leaving with changes not applied asks first.
 */
@Component({
  selector: 'app-program-edit',
  imports: [
    Button,
    ButtonLink,
    CdkDrag,
    CdkDragHandle,
    CdkDragPlaceholder,
    CdkDragPreview,
    CdkDropList,
    CdkScrollable,
    Checkbox,
    Control,
    ExerciseDemo,
    FormsModule,
    Icon,
    ProgramLibrary,
    ProgramSessionEditor,
    ProgramSetsEditor,
    RouterLink,
    Skeleton,
    StatusPill,
    UiConfirm,
    UiMenu,
  ],
  templateUrl: './program-edit.html',
  styleUrls: [
    '../training/program-builder.scss',
    '../training/program-week.scss',
    './program-edit.scss',
  ],
  host: { '(window:beforeunload)': 'onBeforeUnload($event)' },
})
export class ProgramEditPage implements HoldsUnsavedWork {
  private readonly api = inject(ApiClient);
  private readonly programApi = inject(ClientProgramApi);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly sheets = inject(UiSheet);
  private readonly dialogs = inject(UiDialog);
  private readonly toast = inject(UiToast);
  private readonly injector = inject(Injector);
  private readonly locale = inject(LOCALE_ID);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  protected readonly context = inject(ClientWorkspaceContext);

  private readonly params = toSignal(this.route.paramMap, { requireSync: true });
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly sessionSheet = viewChild.required<TemplateRef<unknown>>('sessionSheet');
  private readonly pickerSheet = viewChild.required<TemplateRef<unknown>>('pickerSheet');
  private readonly reviewSheet = viewChild.required<TemplateRef<unknown>>('reviewSheet');
  private readonly confirmDialog = viewChild.required<TemplateRef<unknown>>('confirmDialog');
  private loadedKey: string | null = null;
  private libraryTenant: string | null = null;
  private pickerRef: Closable | null = null;
  private reviewRef: Closable | null = null;
  private csrfReady: Promise<void> | null = null;

  protected readonly mesocycleId = computed(() => this.params().get('mesocycleId') ?? '');
  protected readonly state = signal<'loading' | 'ready' | 'missing' | 'closed' | 'error'>(
    'loading',
  );
  protected readonly closedLine = signal('');
  /** The program as it was opened; the grid's draft starts as a copy of its open sessions. */
  protected readonly edit = signal<ProgramEdit | null>(null);
  protected readonly draft = signal<ProgramDraft>(emptyProgram());
  /** Increases on every change, so the open sheet and the dirty check see edits made in place. */
  protected readonly revision = signal(0);
  protected readonly inlineEditing = signal<string | null>(null);
  protected readonly problem = signal<DraftProblem | null>(null);
  protected readonly failure = signal<EditFailure | null>(null);
  protected readonly reviewing = signal(false);
  protected readonly applying = signal(false);
  /** The edit the open review sheet shows, with the weeks it was asked about. */
  protected readonly review = signal<{
    preview: ProgramEditPreviewView;
    summary: EditReview;
    weeks: ProgramEditWeekRequest[];
  } | null>(null);

  protected readonly exercises = signal<LibraryExercise[]>([]);
  protected readonly libraryState = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly saved = signal<SavedSessionView[]>([]);
  protected readonly thumbs = signal<LibraryThumbs>(new Map());
  protected readonly libraryOpen = signal(true);
  /** Each library exercise's demos, so a grid row can offer Watch demo (P4). */
  private readonly libraryMedia = computed(
    () => new Map(this.exercises().map((item) => [item.id, item.mediaIds] as const)),
  );
  protected readonly phoneWeek = signal<string | null>(null);
  protected readonly editing = signal<SessionRef | null>(null);
  protected readonly picking = signal<PickTarget | null>(null);
  protected readonly addedInSheet = signal<ReadonlySet<string>>(new Set());
  protected readonly announcement = signal('');
  protected readonly asking = signal<{ message: string; confirm: string; cancel: string } | null>(
    null,
  );

  protected readonly loadingLabel = $localize`Loading the program…`;
  protected readonly closeLabel = $localize`Close`;
  protected readonly dragDelay = { touch: 250, mouse: 0 };
  protected readonly maxWeeks = MAX_WEEKS;
  private readonly newSessionName = $localize`Training day`;

  protected readonly canEnter = (drag: CdkDrag<DragItem>, drop: CdkDropList<DropTarget>) =>
    accepts(drag.data, drop.data);

  protected readonly firstName = computed(() => this.context.profile()?.firstName ?? '');
  protected readonly sharedLabel = computed(() => $localize`Shared with ${this.firstName()}:name:`);
  protected readonly trainingLink = computed(() => [
    '/clients',
    this.context.clientId(),
    'training',
  ]);
  protected readonly backLabel = computed(() => $localize`${this.firstName()}:name:’s training`);

  /** Changes on screen that are not applied. */
  protected readonly dirty = computed(() => {
    this.revision();
    const edit = this.edit();
    return edit !== null && hasEdits(edit.draft, this.draft());
  });

  protected readonly statusLine = computed(() =>
    this.dirty()
      ? $localize`Changes not applied yet`
      : $localize`Sessions that started, finished or passed stay as they are`,
  );

  protected readonly runsLine = computed(() => {
    const edit = this.edit();
    if (!edit) return '';
    const weeks = this.draft().weeks.length;
    const start = formatDate(edit.startDate, 'EEE d MMM', this.locale);
    const end = formatDate(addDays(edit.startDate, weeks * 7 - 1), 'EEE d MMM yyyy', this.locale);
    const count = weeks === 1 ? $localize`1 week` : $localize`${weeks}:count: weeks`;
    return `${count} · ${start} – ${end}`;
  });

  protected readonly grid = computed(() => {
    this.revision();
    const edit = this.edit();
    return edit ? this.rows(edit, this.draft()) : [];
  });

  protected readonly columns = computed(() => {
    const key = this.inlineEditing();
    const draft = this.draft();
    const edit = this.edit();
    const used = new Set(draft.weeks.flatMap((week) => week.sessions.map((s) => s.dayOffset)));
    for (const sessions of edit?.locked.values() ?? []) {
      for (const session of sessions) used.add(session.day);
    }
    const editingDay =
      draft.weeks
        .flatMap((week) => week.sessions)
        .find((session) => session.exercises.some((exercise) => exercise.key === key))?.dayOffset ??
      null;
    return DAYS.map((day) =>
      day === editingDay
        ? 'minmax(20rem, 1.8fr)'
        : used.has(day)
          ? 'minmax(9rem, 1fr)'
          : 'minmax(4.25rem, 0.4fr)',
    ).join(' ');
  });

  /** Every list a drag can land in; the days already gone are left out. */
  protected readonly dropIds = computed(() =>
    this.grid().flatMap((row) =>
      row.days.flatMap((cell) => [
        ...(cell.closed ? [] : [cell.listId]),
        ...cell.sessions.map((item) => item.listId),
      ]),
    ),
  );

  /** A phone shows one week: the one chosen, else the week that holds today. */
  protected readonly shownWeek = computed(() => {
    const weeks = this.draft().weeks;
    const chosen = this.phoneWeek();
    if (weeks.some((week) => week.key === chosen)) return chosen;
    const edit = this.edit();
    const index = edit ? Math.floor(daysBetween(edit.startDate, edit.today) / 7) : 0;
    return weeks[Math.max(0, Math.min(index, weeks.length - 1))]?.key ?? null;
  });

  protected readonly editingSession = computed(() => {
    this.revision();
    const ref = this.editing();
    return ref ? (findSession(this.draft(), ref) ?? null) : null;
  });
  protected readonly editingWeekNumber = computed(() => {
    const ref = this.editing();
    return ref ? this.draft().weeks.findIndex((week) => week.key === ref.weekKey) + 1 : 0;
  });

  constructor() {
    this.scope.onReset(() => this.reset());
    const unregister = inject(UnsavedWork).register(this);
    inject(DestroyRef).onDestroy(() => {
      unregister();
      this.reviewRef?.close();
    });

    effect(() => {
      this.scope.epoch();
      const tenant = this.tenants.selectedTenantId();
      const clientId = this.context.clientId();
      const id = this.mesocycleId();
      const key = tenant && clientId && id ? `${tenant}|${clientId}|${id}` : null;
      if (!key || key === this.loadedKey) return;
      this.loadedKey = key;
      untracked(() => void this.load(clientId, id));
    });

    effect(() => {
      const tenant = this.tenants.selectedTenantId();
      if (tenant && tenant !== this.libraryTenant && this.state() === 'ready') {
        this.libraryTenant = tenant;
        untracked(() => void this.loadLibrary());
      }
    });
  }

  // ---------- reading ----------

  private load(clientId: string, mesocycleId: string): Promise<void> {
    return this.scope.run('load', async (owner) => {
      this.state.set('loading');
      try {
        const [program, view] = await owner.wait(
          Promise.all([
            firstValueFrom(this.programApi.getProgram(clientId)),
            firstValueFrom(this.api.getTrainingMesocycle(mesocycleId)),
          ]),
        );
        if (!program.isAllowed) {
          this.closedLine.set(
            trainingClosed(program.accessReason as FeatureAccessReason, this.firstName()),
          );
          this.state.set('closed');
          return;
        }
        if (view.status === 'Completed' || view.status === 'Cancelled') {
          this.closedLine.set(
            $localize`This program is closed, so its weeks stay as they are. Assign a new program to plan what comes next.`,
          );
          this.state.set('closed');
          return;
        }
        const block = program.blocks.find((item) => item.id === view.id);
        const states = new Map<string, ClientSessionState | null>(
          (block?.weeks ?? []).flatMap((week) =>
            week.sessions.map((session) => [session.sessionId, session.state] as const),
          ),
        );
        this.open(programEdit(view, program.localDate, states));
        this.state.set('ready');
        this.focusHeading();
      } catch (error) {
        if (!owner.current) return;
        this.state.set(
          error instanceof HttpErrorResponse && error.status === 404 ? 'missing' : 'error',
        );
      }
    });
  }

  protected retry(): void {
    this.loadedKey = null;
    void this.load(this.context.clientId(), this.mesocycleId());
  }

  private open(edit: ProgramEdit): void {
    this.edit.set(edit);
    this.draft.set(structuredClone(edit.draft));
    this.problem.set(null);
    this.failure.set(null);
    this.inlineEditing.set(null);
    this.revision.update((value) => value + 1);
  }

  protected async loadLibrary(): Promise<void> {
    return this.scope.run('library', async (owner) => {
      this.libraryState.set('loading');
      try {
        const [first, saved] = await owner.wait(
          Promise.all([
            firstValueFrom(this.api.searchExercises({})),
            firstValueFrom(this.api.listSavedSessions()),
          ]),
        );
        const items = [...first.items];
        const total = numeric(first.total);
        while (items.length < Math.min(total, 1000)) {
          const page = await owner.wait(
            firstValueFrom(this.api.searchExercises({ skip: items.length })),
          );
          if (page.items.length === 0) break;
          items.push(...page.items);
        }
        const library = items
          .filter((item) => !item.isArchived)
          .map(libraryExercise)
          .sort((a, b) => a.name.localeCompare(b.name, this.locale));
        this.exercises.set(library);
        this.saved.set(saved);
        this.libraryState.set('ready');
        void this.loadThumbs(library);
      } catch {
        if (owner.current) this.libraryState.set('error');
      }
    });
  }

  private async loadThumbs(library: readonly LibraryExercise[]): Promise<void> {
    const ids = [...new Set(library.flatMap((item) => (item.mediaId ? [item.mediaId] : [])))].slice(
      0,
      96,
    );
    if (ids.length === 0) return;
    return this.scope.run('thumbs', async (owner) => {
      try {
        await owner.wait(this.freshToken());
        const thumbs = new Map<string, string>();
        for (let start = 0; start < ids.length; start += 32) {
          const batch = await owner.wait(
            firstValueFrom(this.api.createMediaAccessBatch(ids.slice(start, start + 32))),
          );
          for (const item of batch.items) {
            if (item.kind === 'Image') thumbs.set(item.assetId, item.thumbnailUrl ?? item.url);
          }
        }
        this.thumbs.set(thumbs);
      } catch {
        // The tiles keep their initials.
      }
    });
  }

  // ---------- changing the grid ----------

  private commit(next: ProgramDraft): void {
    if (next === this.draft()) return;
    this.draft.set(next);
    this.changed();
  }

  /** An edit made in place, by a field or the session sheet. */
  protected touched(): void {
    const draft = this.draft();
    resortDays(draft);
    this.draft.set({ ...draft });
    this.changed();
  }

  private changed(): void {
    this.problem.set(null);
    this.failure.set(null);
    this.revision.update((value) => value + 1);
  }

  protected editSets(key: string): void {
    this.inlineEditing.set(this.inlineEditing() === key ? null : key);
  }

  protected dropped(event: CdkDragDrop<DropTarget, unknown, DragItem>): void {
    if (event.previousContainer === event.container && event.previousIndex === event.currentIndex) {
      return;
    }
    this.commit(
      applyDrop(
        this.draft(),
        event.item.data,
        event.container.data,
        event.currentIndex,
        this.newSessionName,
      ),
    );
  }

  protected addWeek(): void {
    this.commit(addWeek(this.draft()));
    this.focusWeek(this.draft().weeks.at(-1)?.key);
  }

  protected onWeekAction(weekKey: string, action: string): void {
    const edit = this.edit();
    if (!edit) return;
    const before = this.draft();
    const index = before.weeks.findIndex((week) => week.key === weekKey);
    switch (action) {
      case 'duplicate': {
        const next = duplicateEditWeek(edit, before, weekKey);
        this.commit(next);
        const known = new Set(before.weeks.map((week) => week.key));
        this.focusWeek(next.weeks.find((week) => !known.has(week.key))?.key);
        return;
      }
      case 'up':
      case 'down':
        this.commit(moveEditWeek(edit, before, weekKey, action === 'up' ? -1 : 1));
        this.focusWeek(weekKey);
        return;
      case 'delete':
        if (!canRemoveWeek(edit, before.weeks.length, index)) return;
        this.commit(removeWeek(before, weekKey));
        this.focusWeek(this.draft().weeks[Math.max(0, index - 1)]?.key);
        this.offerUndo($localize`Week ${index + 1}:number: removed.`, before);
        return;
    }
  }

  protected onSessionAction(ref: SessionRef, action: string): void {
    switch (action) {
      case 'edit':
        return this.openSession(ref);
      case 'copy':
        this.commit(copySession(this.draft(), ref).draft);
        this.toast.show($localize`Session copied.`, { tone: 'success' });
        return;
      case 'delete':
        return this.deleteSession(ref, null);
    }
  }

  protected deleteSession(ref: SessionRef, sheet: Closable | null): void {
    const before = this.draft();
    const name = findSession(before, ref)?.name.trim() || $localize`The session`;
    sheet?.close();
    this.commit(removeSession(before, ref));
    this.focusWeek(ref.weekKey);
    this.offerUndo($localize`${name}:session: removed.`, before);
  }

  private offerUndo(message: string, before: ProgramDraft): void {
    this.toast.show(message, {
      durationMs: 8000,
      action: {
        label: $localize`Undo`,
        run: () => {
          this.draft.set(before);
          this.changed();
        },
      },
    });
  }

  /** Back to the program as it was opened. */
  protected async discard(): Promise<void> {
    const agreed = await this.ask({
      title: $localize`Discard your changes?`,
      message: $localize`The weeks go back to how they were when you opened them. Nothing was applied, so ${this.firstName()}:name: has seen none of it.`,
      confirm: $localize`Discard changes`,
      cancel: $localize`Keep editing`,
    });
    const edit = this.edit();
    if (agreed && edit) this.open(edit);
  }

  // ---------- the sheets ----------

  protected openSession(ref: SessionRef): void {
    this.editing.set(ref);
    const sheet = this.sheets.open(this.sessionSheet(), {
      title: $localize`Edit session`,
      closeLabel: this.closeLabel,
    });
    sheet.closed.subscribe(() => this.editing.set(null));
  }

  protected openPicker(target: PickTarget): void {
    this.picking.set(target);
    this.addedInSheet.set(new Set());
    this.announcement.set('');
    const title =
      target.kind === 'session'
        ? $localize`Add exercises`
        : $localize`Add to week ${this.weekNumber(target.at.weekKey)}:week:, ${this.dayName(target.at)}:day:`;
    const sheet = this.sheets.open(this.pickerSheet(), { title, closeLabel: this.closeLabel });
    this.pickerRef = sheet;
    sheet.closed.subscribe(() => {
      this.picking.set(null);
      if (this.pickerRef === sheet) this.pickerRef = null;
    });
  }

  protected addToEditing(): void {
    const ref = this.editing();
    if (ref) this.openPicker({ kind: 'session', ref });
  }

  protected deleteEditing(sheet: Closable): void {
    const ref = this.editing();
    if (ref) this.deleteSession(ref, sheet);
  }

  protected removeFromEditing(exerciseKey: string): void {
    const ref = this.editing();
    if (!ref) return;
    const before = this.draft();
    const name =
      findSession(before, ref)?.exercises.find((item) => item.key === exerciseKey)?.exerciseName ||
      $localize`The exercise`;
    this.commit(removeExercise(before, { ...ref, exerciseKey }));
    this.offerUndo($localize`${name}:exercise: removed.`, before);
  }

  protected pickExercise(exercise: LibraryExercise): void {
    const target = this.picking();
    if (!target) return;
    if (target.kind === 'session') {
      this.commit(addExercise(this.draft(), target.ref, Number.MAX_SAFE_INTEGER, exercise));
    } else {
      const started = startSessionWith(this.draft(), target.at, this.newSessionName, {
        library: exercise,
      });
      this.commit(started.draft);
      if (started.sessionKey) {
        this.picking.set({
          kind: 'session',
          ref: { weekKey: target.at.weekKey, sessionKey: started.sessionKey },
        });
      }
    }
    this.addedInSheet.update((ids) => new Set(ids).add(exercise.id));
    this.announcement.set($localize`${exercise.name}:exercise: added.`);
  }

  protected pickSaved(saved: SavedSessionView): void {
    const target = this.picking();
    if (target?.kind !== 'day') return;
    const week = this.draft().weeks.find((item) => item.key === target.at.weekKey);
    this.commit(
      insertSavedSession(
        this.draft(),
        target.at,
        week ? daySessions(week, target.at.day).length : 0,
        saved,
      ).draft,
    );
    this.pickerRef?.close();
    this.toast.show($localize`${saved.name}:session: added.`, { tone: 'success' });
  }

  // ---------- review and apply ----------

  /** Asks the server what the grid would do; nothing is saved until the coach applies it. */
  protected async openReview(): Promise<void> {
    const edit = this.edit();
    if (!edit || this.reviewing() || this.reviewRef || !this.dirty()) return;
    const problem = editProblem(edit, this.draft(), this.locale);
    this.problem.set(problem);
    this.failure.set(null);
    if (problem) {
      this.openProblem();
      return;
    }
    const weeks = editRequest(this.draft());
    await this.scope.run('review', async (owner) => {
      this.reviewing.set(true);
      try {
        const preview = await this.write(owner, () =>
          this.programApi.previewProgramEdit(edit.mesocycleId, {
            mesocycleVersion: edit.version,
            weeks,
          }),
        );
        this.review.set({
          preview,
          weeks,
          summary: editReview(preview, edit.loadUnit, this.locale, this.firstName(), edit.draft),
        });
        const sheet = this.sheets.open(this.reviewSheet(), {
          title: $localize`Review changes`,
          closeLabel: this.closeLabel,
        });
        this.reviewRef = sheet;
        sheet.closed.subscribe(() => {
          this.reviewRef = null;
          this.review.set(null);
        });
      } catch (error) {
        if (owner.current) this.failure.set(this.editFailure(error));
      } finally {
        if (owner.current) this.reviewing.set(false);
      }
    });
  }

  /** Carries out exactly what the review showed; the server checks it all again. */
  protected async apply(): Promise<void> {
    const edit = this.edit();
    const review = this.review();
    if (!edit || !review || this.applying()) return;
    await this.scope.run('apply', async (owner) => {
      this.applying.set(true);
      this.failure.set(null);
      try {
        const applied = await this.write(owner, () =>
          this.programApi.applyProgramEdit(edit.mesocycleId, {
            mesocycleVersion: edit.version,
            weeks: review.weeks,
            previewHash: review.preview.previewHash,
          }),
        );
        // The grid now matches the program, so leaving asks nothing.
        this.draft.set(structuredClone(edit.draft));
        this.edit.set(null);
        this.reviewRef?.close();
        this.context.error.set(null);
        this.context.notice.set(
          $localize`${applied.name}:program: is updated. ${this.firstName()}:name: sees the changes in the weeks you share.`,
        );
        await this.router.navigate(this.trainingLink());
      } catch (error) {
        if (owner.current) this.failure.set(this.editFailure(error));
      } finally {
        if (owner.current) this.applying.set(false);
      }
    });
  }

  /** Reads the program again: the coach's changes here are dropped, so this asks first. */
  protected async reload(): Promise<void> {
    if (this.dirty()) {
      const agreed = await this.ask({
        title: $localize`Reload the program?`,
        message: $localize`Your changes here are not applied, and reloading discards them. You can make them again on the latest program.`,
        confirm: $localize`Reload`,
        cancel: $localize`Keep editing`,
      });
      if (!agreed) return;
    }
    this.reviewRef?.close();
    this.edit.set(null);
    this.retry();
  }

  private editFailure(error: unknown): EditFailure {
    const code =
      error instanceof HttpErrorResponse
        ? ((error.error as { code?: unknown } | null)?.code as string | undefined)
        : undefined;
    switch (code) {
      case 'program_edit_preview_changed':
        return {
          message: $localize`The program changed since you reviewed these changes. Review them again before applying.`,
          reload: false,
        };
      case 'program_edit_conflict':
      case 'concurrency_conflict':
        return {
          message: $localize`This program was changed somewhere else since you opened it, for example a workout started or the training maxes changed. Reload it to see the latest.`,
          reload: true,
        };
      default:
        return {
          message: programWriteError(
            error,
            $localize`The changes could not be checked. Try again.`,
            this.firstName(),
          ),
          reload: false,
        };
    }
  }

  protected openProblem(): void {
    const problem = this.problem();
    if (!problem?.weekKey || !problem.sessionKey) return;
    if (problem.exerciseKey && problem.setKey) {
      this.inlineEditing.set(problem.exerciseKey);
      this.phoneWeek.set(problem.weekKey);
      afterNextRender(
        () =>
          this.host.nativeElement
            .querySelector<HTMLElement>(
              `#inline-${problem.exerciseKey} input, #inline-${problem.exerciseKey} button`,
            )
            ?.focus(),
        { injector: this.injector },
      );
      return;
    }
    this.openSession({ weekKey: problem.weekKey, sessionKey: problem.sessionKey });
  }

  // ---------- leaving ----------

  async canLeave(): Promise<boolean> {
    if (!this.dirty()) return true;
    return this.ask({
      title: $localize`Leave without applying?`,
      message: $localize`Your changes to ${this.firstName()}:name:’s weeks are not applied. If you leave now, they are lost.`,
      confirm: $localize`Leave without applying`,
      cancel: $localize`Stay`,
    });
  }

  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.dirty()) {
      event.preventDefault();
      event.returnValue = '';
    }
  }

  // ---------- drawing the grid ----------

  private rows(edit: ProgramEdit, draft: ProgramDraft): WeekRow[] {
    const count = draft.weeks.length;
    const frozenLine = $localize`Weeks up to week ${edit.frozen}:number: have sessions that started or passed, so they stay where they are.`;
    return draft.weeks.map((week, index) => {
      const number = index + 1;
      const frozen = index < edit.frozen;
      const copyLandsLater = index + 1 < edit.frozen;
      const first = dayDate(edit.startDate, index, 0);
      const last = dayDate(edit.startDate, index, 6);
      const locked = (week.sourceId && edit.locked.get(week.sourceId)) || [];
      return {
        key: week.key,
        number,
        title: $localize`Week ${number}:number:`,
        dates: `${formatDate(first, 'EEE d MMM', this.locale)} – ${formatDate(last, 'EEE d MMM', this.locale)}`,
        frozen,
        week,
        labelName: $localize`Name of week ${number}:number:`,
        menuLabel: $localize`More for week ${number}:number:`,
        menu: [
          {
            label: $localize`Duplicate week`,
            action: 'duplicate',
            disabled: count >= this.maxWeeks,
            hint:
              count >= this.maxWeeks
                ? $localize`A program holds up to ${this.maxWeeks}:count: weeks.`
                : copyLandsLater
                  ? $localize`The copy goes after week ${edit.frozen}:number:`
                  : undefined,
          },
          {
            label: $localize`Move up`,
            action: 'up',
            disabled: !canMoveWeek(edit, count, index, -1),
            hint: frozen || index === edit.frozen ? frozenLine : undefined,
          },
          {
            label: $localize`Move down`,
            action: 'down',
            disabled: !canMoveWeek(edit, count, index, 1),
            hint: frozen ? frozenLine : undefined,
          },
          {
            label: $localize`Remove week`,
            action: 'delete',
            danger: true,
            disabled: !canRemoveWeek(edit, count, index),
            hint: frozen
              ? $localize`It has sessions that started or passed.`
              : count <= 1
                ? $localize`A program keeps at least one week.`
                : undefined,
          },
        ],
        days: DAYS.map((day) => {
          const at = { weekKey: week.key, day };
          const sessions = daySessions(week, day);
          const date = dayDate(edit.startDate, index, day);
          const label = formatDate(date, 'EEE d', this.locale);
          return {
            day,
            listId: `day-${week.key}-${day}`,
            label,
            closed: isClosedDay(edit, index, day),
            at,
            target: { kind: 'day', at, empty: sessions.length === 0 },
            locked: locked.filter((item) => item.day === day),
            sessions: sessions.map((session) => this.sessionCell(week, session)),
            addLabel: $localize`Add to week ${number}:week:, ${formatDate(date, 'EEEE d MMMM', this.locale)}:day:`,
          };
        }),
      };
    });
  }

  private sessionCell(week: DraftWeek, session: DraftSession): SessionCell {
    const ref = { weekKey: week.key, sessionKey: session.key };
    const name = session.name.trim() || $localize`Unnamed session`;
    return {
      key: session.key,
      listId: `exercises-${session.key}`,
      name,
      countLabel:
        session.exercises.length === 1
          ? $localize`1 exercise`
          : $localize`${session.exercises.length}:count: exercises`,
      ref,
      drag: { kind: 'session', ref },
      target: { kind: 'session', ref },
      menuLabel: $localize`More for ${name}:session:`,
      addLabel: $localize`Add exercise to ${name}:session:`,
      menu: [
        { label: $localize`Edit session`, action: 'edit' },
        { label: $localize`Copy session`, action: 'copy', hint: $localize`To the next free day` },
        { label: $localize`Remove session`, action: 'delete', danger: true },
      ],
      exercises: session.exercises.map((exercise) => ({
        key: exercise.key,
        draft: exercise,
        editLabel: $localize`Edit sets for ${exercise.exerciseName || $localize`Exercise`}:exercise:`,
        name: exercise.exerciseName || $localize`Exercise`,
        line: exerciseSummary(exercise),
        isMainLift: exercise.isMainLift,
        drag: { kind: 'exercise', ref: { ...ref, exerciseKey: exercise.key } },
        media: this.libraryMedia().get(exercise.exerciseId) ?? [],
      })),
    };
  }

  private weekNumber(weekKey: string): number {
    return this.draft().weeks.findIndex((week) => week.key === weekKey) + 1;
  }

  private dayName(at: DayRef): string {
    const edit = this.edit();
    const index = this.weekNumber(at.weekKey) - 1;
    return edit
      ? formatDate(dayDate(edit.startDate, index, at.day), 'EEEE d MMMM', this.locale)
      : '';
  }

  // ---------- helpers ----------

  private async write<T>(owner: TenantOperation, call: () => Observable<T>): Promise<T> {
    await owner.wait(this.freshToken());
    try {
      return await owner.wait(firstValueFrom(call()));
    } catch (error) {
      const expired =
        error instanceof HttpErrorResponse &&
        error.status === 400 &&
        (error.error as { code?: unknown } | null)?.code === 'antiforgery_token_invalid';
      if (!expired) throw error;
      this.csrfReady = null;
      await owner.wait(this.freshToken());
      return await owner.wait(firstValueFrom(call()));
    }
  }

  private freshToken(): Promise<void> {
    this.csrfReady ??= this.csrf.refresh().catch((error: unknown) => {
      this.csrfReady = null;
      throw error;
    });
    return this.csrfReady;
  }

  private async ask(question: {
    title: string;
    message: string;
    confirm: string;
    cancel: string;
  }): Promise<boolean> {
    this.asking.set(question);
    const dialog = this.dialogs.open<boolean>(this.confirmDialog(), {
      title: question.title,
      closeLabel: this.closeLabel,
      closeOnNavigation: false,
    });
    return (await firstValueFrom(dialog.closed)) === true;
  }

  private focusHeading(): void {
    afterNextRender(() => this.heading()?.nativeElement.focus({ preventScroll: true }), {
      injector: this.injector,
    });
  }

  private focusWeek(weekKey: string | undefined): void {
    if (!weekKey) return;
    this.phoneWeek.set(weekKey);
    afterNextRender(
      () =>
        this.host.nativeElement
          .querySelector<HTMLElement>(`[data-week="${weekKey}"]`)
          ?.focus({ preventScroll: false }),
      { injector: this.injector },
    );
  }

  private reset(): void {
    this.reviewRef?.close();
    this.loadedKey = null;
    this.libraryTenant = null;
    this.csrfReady = null;
    this.pickerRef = null;
    this.edit.set(null);
    this.draft.set(emptyProgram());
    this.state.set('loading');
    this.inlineEditing.set(null);
    this.phoneWeek.set(null);
    this.problem.set(null);
    this.failure.set(null);
    this.reviewing.set(false);
    this.applying.set(false);
  }
}
