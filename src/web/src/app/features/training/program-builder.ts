import {
  CdkDrag,
  type CdkDragDrop,
  CdkDragHandle,
  CdkDragPlaceholder,
  CdkDragPreview,
  CdkDropList,
} from '@angular/cdk/drag-drop';
import { CdkScrollable } from '@angular/cdk/scrolling';
import { HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
  Component,
  computed,
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
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import type { ProgramTemplateSummary, SavedSessionView } from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button, ButtonLink } from '../../ui/button';
import { Checkbox } from '../../ui/checkbox';
import { Control } from '../../ui/field';
import { Icon } from '../../ui/icon';
import { UiMenu, type UiMenuItem } from '../../ui/menu';
import { UiSheet } from '../../ui/sheet';
import { Skeleton } from '../../ui/skeleton';
import { StatusPill } from '../../ui/status-pill';
import { UiToast } from '../../ui/toast';
import { ProgramBuilderApi } from './program-builder-api';
import {
  accepts,
  addExercise,
  addWeek,
  applyDrop,
  copySession,
  DAYS,
  type DayRef,
  daySessions,
  type DragItem,
  type DraftProblem,
  draftProblem,
  type DropTarget,
  duplicateWeekAfter,
  exerciseSummary,
  findSession,
  gridColumns,
  insertSavedSession,
  libraryExercise,
  type LibraryExercise,
  moveWeek,
  removeExercise,
  removeSession,
  removeWeek,
  resortDays,
  type SessionRef,
  startSessionWith,
  versionRows,
  versionToOpen,
} from './program-builder.models';
import { type LibraryThumbs, ProgramLibrary } from './program-library';
import { ProgramSessionEditor } from './program-session-editor';
import {
  type DraftSession,
  type DraftWeek,
  draftFromVersion,
  emptyProgram,
  numeric,
  type ProgramDraft,
  toProgramRequest,
} from './training-builder.models';

/** An open sheet, as far as the page needs it. */
interface Closable {
  close(): void;
}

/** Where the sheet's library adds what the coach picks: a session, or a rest day. */
type PickTarget = { kind: 'session'; ref: SessionRef } | { kind: 'day'; at: DayRef };

interface ExerciseCell {
  key: string;
  name: string;
  line: string;
  isMainLift: boolean;
  drag: DragItem;
}

interface SessionCell {
  key: string;
  /** The id of its exercise list, which every other list names to take drops from it. */
  listId: string;
  name: string;
  /** "5 exercises", on the small card that follows the pointer. */
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
  label: string;
  at: DayRef;
  target: DropTarget;
  sessions: SessionCell[];
  addLabel: string;
}

interface WeekRow {
  key: string;
  number: number;
  title: string;
  week: DraftWeek;
  days: DayCell[];
  menu: UiMenuItem[];
  menuLabel: string;
  labelName: string;
}

/**
 * The program builder (C4): the exercise library beside a week × day grid. Exercises are dragged
 * from the library into a session or onto a rest day, sessions between days and weeks, and
 * exercises between sessions (CDK drag and drop); every drag also has a button path, through the
 * session sheet, the add sheet and each card's menu. The program is one draft on the page until
 * it is saved: Save draft keeps a version the coach cannot assign yet, Publish one they can. Every
 * save is a new version; clients already on the program keep their own copy (TRN-001).
 */
@Component({
  selector: 'app-program-builder',
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
    FormsModule,
    Icon,
    ProgramLibrary,
    ProgramSessionEditor,
    RouterLink,
    Skeleton,
    StatusPill,
    UiMenu,
  ],
  templateUrl: './program-builder.html',
  styleUrls: ['./program-builder.scss', './program-week.scss'],
})
export class ProgramBuilder {
  private readonly api = inject(ApiClient);
  private readonly programApi = inject(ProgramBuilderApi);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly sheets = inject(UiSheet);
  private readonly toast = inject(UiToast);
  private readonly injector = inject(Injector);
  private readonly locale = inject(LOCALE_ID);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());

  private readonly params = toSignal(this.route.paramMap, { requireSync: true });
  private readonly query = toSignal(this.route.queryParamMap, { requireSync: true });
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  protected readonly sessionSheet = viewChild.required<TemplateRef<unknown>>('sessionSheet');
  protected readonly pickerSheet = viewChild.required<TemplateRef<unknown>>('pickerSheet');
  protected readonly historySheet = viewChild.required<TemplateRef<unknown>>('historySheet');
  private libraryTenant: string | null = null;
  private loadedKey: string | null = null;
  private pickerRef: Closable | null = null;

  /** The program in the address, or null for a new one (`/training/programs/new`). */
  protected readonly templateId = computed(() => {
    const id = this.params().get('templateId');
    return id && id !== 'new' ? id : null;
  });
  private readonly requestedVersion = computed(() => this.query().get('version'));

  protected readonly draft = signal<ProgramDraft>(emptyProgram());
  protected readonly template = signal<ProgramTemplateSummary | null>(null);
  protected readonly openVersionId = signal<string | null>(null);
  protected readonly state = signal<'loading' | 'ready' | 'missing' | 'error'>('loading');
  protected readonly dirty = signal(false);
  protected readonly saving = signal<'draft' | 'publish' | null>(null);
  protected readonly problem = signal<DraftProblem | null>(null);
  protected readonly saveError = signal<string | null>(null);
  protected readonly conflict = signal(false);
  /** Increases on every change, so the open session sheet redraws edits made around it. */
  protected readonly revision = signal(0);

  protected readonly exercises = signal<LibraryExercise[]>([]);
  protected readonly libraryState = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly saved = signal<SavedSessionView[]>([]);
  protected readonly thumbs = signal<LibraryThumbs>(new Map());
  protected readonly libraryOpen = signal(true);
  /** The week a phone shows; null until one is chosen, then the first. */
  protected readonly phoneWeek = signal<string | null>(null);

  protected readonly editing = signal<SessionRef | null>(null);
  protected readonly picking = signal<PickTarget | null>(null);
  protected readonly addedInSheet = signal<ReadonlySet<string>>(new Set());
  protected readonly announcement = signal('');
  protected readonly savingSession = signal(false);

  protected readonly loadingLabel = $localize`Loading the program…`;
  protected readonly closeLabel = $localize`Close`;
  protected readonly sharedLabel = $localize`Shared with client`;
  protected readonly dragDelay = { touch: 250, mouse: 0 };
  private readonly newSessionName = $localize`Training day`;

  /** Each list takes only its own kind of item, so nested lists never take each other's drops. */
  protected readonly canEnter = (drag: CdkDrag<DragItem>, drop: CdkDropList<DropTarget>) =>
    accepts(drag.data, drop.data);

  protected readonly shownWeek = computed(() => {
    const weeks = this.draft().weeks;
    const chosen = this.phoneWeek();
    return weeks.some((week) => week.key === chosen) ? chosen : (weeks[0]?.key ?? null);
  });
  protected readonly isNew = computed(() => this.templateId() === null);
  protected readonly columns = computed(() => gridColumns(this.draft()));
  protected readonly grid = computed(() => this.rows(this.draft(), this.dirty()));
  /**
   * Every list on the grid, by id. The lists are connected by name rather than by a
   * `cdkDropListGroup`, because the CDK keeps a list nested in another (a session's exercises
   * inside its day) out of the outer list's group.
   */
  protected readonly dropIds = computed(() =>
    this.grid().flatMap((row) =>
      row.days.flatMap((cell) => [cell.listId, ...cell.sessions.map((item) => item.listId)]),
    ),
  );
  protected readonly pageTitle = computed(
    () => this.draft().name.trim() || (this.isNew() ? $localize`New program` : $localize`Program`),
  );
  protected readonly counts = computed(() => {
    const weeks = this.draft().weeks;
    const sessions = weeks.reduce((sum, week) => sum + week.sessions.length, 0);
    const weekText =
      weeks.length === 1 ? $localize`1 week` : $localize`${weeks.length}:count: weeks`;
    const sessionText =
      sessions === 1 ? $localize`1 session` : $localize`${sessions}:count: sessions`;
    return `${weekText} · ${sessionText}`;
  });

  private readonly openVersion = computed(
    () => this.template()?.versions.find((version) => version.id === this.openVersionId()) ?? null,
  );
  private readonly isLatest = computed(
    () => this.template()?.versions[0]?.id === this.openVersionId(),
  );
  protected readonly olderLine = computed(() => {
    const open = this.openVersion();
    if (!open || this.isLatest()) return null;
    const row = versionRows(this.template()!, open.id, this.locale).find(
      (item) => item.id === open.id,
    );
    return $localize`You’re looking at an earlier version (${row?.title}:version:, ${row?.date}:date:). Saving makes it the newest version.`;
  });
  protected readonly statusLine = computed(() => {
    if (this.dirty()) return $localize`Unsaved changes`;
    const open = this.openVersion();
    if (!open) return $localize`Not saved yet`;
    return open.isPublished
      ? $localize`Published: you can assign it`
      : $localize`Draft: not ready to assign`;
  });
  protected readonly canSaveDraft = computed(() => this.isNew() || this.dirty());
  protected readonly canPublish = computed(
    () => this.isNew() || this.dirty() || !(this.openVersion()?.isPublished ?? false),
  );
  protected readonly historyRows = computed(() => {
    const template = this.template();
    return template ? versionRows(template, this.openVersionId(), this.locale) : [];
  });
  protected readonly editingSession = computed(() => {
    const ref = this.editing();
    return ref ? (findSession(this.draft(), ref) ?? null) : null;
  });
  protected readonly editingWeekNumber = computed(() => {
    const ref = this.editing();
    return ref ? this.draft().weeks.findIndex((week) => week.key === ref.weekKey) + 1 : 0;
  });

  constructor() {
    this.scope.onReset(() => this.resetTenantState());
    effect(() => {
      this.scope.epoch();
      const tenant = this.tenants.selectedTenantId();
      if (tenant && tenant !== this.libraryTenant) {
        this.libraryTenant = tenant;
        untracked(() => void this.loadLibrary());
      }
    });
    effect(() => {
      this.scope.epoch();
      const tenant = this.tenants.selectedTenantId();
      const id = this.templateId();
      const version = this.requestedVersion();
      if (!tenant) return;
      const key = `${tenant}|${id ?? 'new'}|${version ?? ''}`;
      if (key === this.loadedKey) return;
      this.loadedKey = key;
      untracked(() => void this.loadProgram(id, version, false));
    });
  }

  // ---------- loading ----------

  protected async loadProgram(
    id: string | null,
    version: string | null,
    quiet: boolean,
  ): Promise<void> {
    return this.scope.run('program', async (owner) => {
      if (id === null) {
        this.template.set(null);
        this.openVersionId.set(null);
        this.adopt(emptyProgram());
        this.state.set('ready');
        this.focusHeading();
        return;
      }
      if (!quiet) this.state.set('loading');
      try {
        const template = await owner.wait(firstValueFrom(this.programApi.getProgram(id)));
        const versionId = versionToOpen(template, version);
        if (!versionId) {
          this.state.set('missing');
          return;
        }
        const view = await owner.wait(
          firstValueFrom(this.api.getProgramTemplateVersion(versionId)),
        );
        const draft = draftFromVersion(view);
        // The token a save carries is the program's own, not the version's number.
        draft.sourceVersion = numeric(template.version);
        this.template.set(template);
        this.openVersionId.set(versionId);
        this.adopt(draft);
        this.state.set('ready');
        if (!quiet) this.focusHeading();
      } catch (error) {
        if (!owner.current) return;
        if (error instanceof HttpErrorResponse && error.status === 404) {
          this.state.set('missing');
        } else if (quiet) {
          this.saveError.set(
            $localize`Saved, but the newest version could not be opened. Reload the page.`,
          );
        } else {
          this.state.set('error');
        }
      }
    });
  }

  protected retryProgram(): void {
    void this.loadProgram(this.templateId(), this.requestedVersion(), false);
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
        // A page holds 100; a big library is read to the end, up to a thousand exercises.
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

  /**
   * Pictures for the library's tiles: one grant per exercise's first media, 32 to a request. A
   * video or a refused grant keeps the tile's initials.
   */
  private async loadThumbs(library: readonly LibraryExercise[]): Promise<void> {
    const ids = [...new Set(library.flatMap((item) => (item.mediaId ? [item.mediaId] : [])))].slice(
      0,
      96,
    );
    if (ids.length === 0) return;
    return this.scope.run('thumbs', async (owner) => {
      try {
        await owner.wait(this.csrf.refresh());
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

  // ---------- changing the program ----------

  /** A new draft from a drop, a menu or the add sheet. */
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
    this.dirty.set(true);
    this.problem.set(null);
    this.saveError.set(null);
    this.revision.update((value) => value + 1);
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
    const week = this.draft().weeks.at(-1);
    if (week) this.focusWeek(week.key);
  }

  protected onWeekAction(weekKey: string, action: string): void {
    const before = this.draft();
    const index = before.weeks.findIndex((week) => week.key === weekKey);
    switch (action) {
      case 'duplicate':
        this.commit(duplicateWeekAfter(before, weekKey));
        this.focusWeek(this.draft().weeks[index + 1]?.key);
        return;
      case 'up':
        this.commit(moveWeek(before, weekKey, -1));
        this.focusWeek(weekKey);
        return;
      case 'down':
        this.commit(moveWeek(before, weekKey, 1));
        this.focusWeek(weekKey);
        return;
      case 'delete':
        this.commit(removeWeek(before, weekKey));
        this.focusWeek(this.draft().weeks[Math.max(0, index - 1)]?.key);
        this.offerUndo($localize`Week ${index + 1}:number: deleted.`, before);
        return;
    }
  }

  protected onSessionAction(ref: SessionRef, action: string): void {
    const before = this.draft();
    switch (action) {
      case 'edit':
        return this.openSession(ref);
      case 'copy': {
        const copied = copySession(before, ref);
        this.commit(copied.draft);
        this.announce($localize`Session copied.`);
        return;
      }
      case 'library': {
        const session = findSession(before, ref);
        if (session) void this.saveToLibrary(session);
        return;
      }
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
    this.offerUndo($localize`${name}:session: deleted.`, before);
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

  // ---------- sheets ----------

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
        : $localize`Add to week ${this.weekNumber(target.at.weekKey)}:week:, day ${target.at.day + 1}:day:`;
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

  /** An exercise taken out in the session sheet, with an Undo like a deleted session's. */
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

  /**
   * An exercise picked in the add sheet. On a rest day the first one starts a session there, and
   * the rest join it; the sheet stays open for more.
   */
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
    const placed = insertSavedSession(
      this.draft(),
      target.at,
      week ? daySessions(week, target.at.day).length : 0,
      saved,
    );
    this.commit(placed.draft);
    this.pickerRef?.close();
    this.announce($localize`${saved.name}:session: added.`);
  }

  protected openHistory(): void {
    this.sheets.open(this.historySheet(), {
      title: $localize`Versions`,
      closeLabel: this.closeLabel,
    });
  }

  // ---------- saving ----------

  protected async save(publish: boolean): Promise<void> {
    if (this.saving()) return;
    const problem = draftProblem(this.draft());
    this.problem.set(problem);
    this.saveError.set(null);
    this.conflict.set(false);
    if (problem) return;

    return this.scope.run('save', async (owner) => {
      this.saving.set(publish ? 'publish' : 'draft');
      const id = this.templateId();
      const isFirst = id === null;
      try {
        await owner.wait(this.csrf.refresh());
        const request = toProgramRequest({ ...this.draft(), publish });
        const saved = await owner.wait(
          firstValueFrom(
            id
              ? this.api.addProgramTemplateVersion(id, request)
              : this.api.createProgramTemplate(request),
          ),
        );
        this.dirty.set(false);
        // The address names the program, and no longer an older version; the page stays.
        this.loadedKey = `${owner.tenantId}|${saved.templateId}|`;
        await owner.wait(
          this.router.navigate(['/training/programs', saved.templateId], { replaceUrl: true }),
        );
        await owner.wait(this.loadProgram(saved.templateId, null, true));
        this.toast.show(
          publish
            ? isFirst
              ? $localize`Published. You can assign it to clients now.`
              : $localize`Published. Clients already on this program keep their own copy.`
            : $localize`Draft saved. Publish it when it is ready to assign.`,
          { tone: 'success' },
        );
      } catch (error) {
        if (!owner.current) return;
        if (error instanceof HttpErrorResponse && error.status === 409) {
          this.conflict.set(true);
        } else {
          this.saveError.set(
            apiErrorMessage(
              error,
              $localize`The program could not be saved. Your changes are still here; try again.`,
            ),
          );
        }
      } finally {
        if (owner.current) this.saving.set(null);
      }
    });
  }

  /** After a conflict: the newest version replaces the changes made here. */
  protected openNewest(): void {
    const id = this.templateId();
    if (!id) return;
    this.conflict.set(false);
    this.loadedKey = null;
    void this.router.navigate(['/training/programs', id], { replaceUrl: true });
    void this.loadProgram(id, null, false);
  }

  protected openProblem(): void {
    const problem = this.problem();
    if (problem?.weekKey && problem.sessionKey) {
      this.openSession({ weekKey: problem.weekKey, sessionKey: problem.sessionKey });
    }
  }

  protected async saveToLibrary(session: DraftSession): Promise<void> {
    const versionId = this.openVersionId();
    const sourceId = session.sourceId;
    if (!versionId || !sourceId) return;
    return this.scope.run('saveSession', async (owner) => {
      this.savingSession.set(true);
      try {
        await owner.wait(this.csrf.refresh());
        await owner.wait(
          firstValueFrom(
            this.api.saveTrainingSession({
              name: session.name.trim(),
              sourceTemplateVersionId: versionId,
              sourceTemplateSessionId: sourceId,
            }),
          ),
        );
        this.saved.set(await owner.wait(firstValueFrom(this.api.listSavedSessions())));
        this.toast.show($localize`${session.name.trim()}:session: is in your saved sessions.`, {
          tone: 'success',
        });
      } catch (error) {
        if (!owner.current) return;
        this.toast.show(
          apiErrorMessage(error, $localize`The session could not be added to your saved sessions.`),
          { tone: 'error' },
        );
      } finally {
        if (owner.current) this.savingSession.set(false);
      }
    });
  }

  // ---------- drawing the grid ----------

  private rows(draft: ProgramDraft, dirty: boolean): WeekRow[] {
    const last = draft.weeks.length - 1;
    return draft.weeks.map((week, index) => {
      const number = index + 1;
      const title = $localize`Week ${number}:number:`;
      return {
        key: week.key,
        number,
        title,
        week,
        labelName: $localize`Name of week ${number}:number:`,
        menuLabel: $localize`More for week ${number}:number:`,
        menu: [
          { label: $localize`Duplicate week`, action: 'duplicate' },
          { label: $localize`Move up`, action: 'up', disabled: index === 0 },
          { label: $localize`Move down`, action: 'down', disabled: index === last },
          {
            label: $localize`Delete week`,
            action: 'delete',
            danger: true,
            disabled: last === 0,
            hint: last === 0 ? $localize`A program keeps at least one week.` : undefined,
          },
        ],
        days: DAYS.map((day) => {
          const sessions = daySessions(week, day);
          const at = { weekKey: week.key, day };
          return {
            day,
            listId: `day-${week.key}-${day}`,
            label: $localize`Day ${day + 1}:day:`,
            at,
            target: { kind: 'day', at, empty: sessions.length === 0 },
            addLabel: $localize`Add to week ${number}:week:, day ${day + 1}:day:`,
            sessions: sessions.map((session) => this.sessionCell(week, session, dirty)),
          };
        }),
      };
    });
  }

  private sessionCell(week: DraftWeek, session: DraftSession, dirty: boolean): SessionCell {
    const ref = { weekKey: week.key, sessionKey: session.key };
    const name = session.name.trim() || $localize`Unnamed session`;
    const canSave = Boolean(session.sourceId) && !dirty;
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
        {
          label: $localize`Add to saved sessions`,
          action: 'library',
          disabled: !canSave,
          hint: canSave ? undefined : $localize`Save the program first`,
        },
        { label: $localize`Delete session`, action: 'delete', danger: true },
      ],
      exercises: session.exercises.map((exercise) => ({
        key: exercise.key,
        name: exercise.exerciseName || $localize`Exercise`,
        line: exerciseSummary(exercise),
        isMainLift: exercise.isMainLift,
        drag: { kind: 'exercise', ref: { ...ref, exerciseKey: exercise.key } },
      })),
    };
  }

  private weekNumber(weekKey: string): number {
    return this.draft().weeks.findIndex((week) => week.key === weekKey) + 1;
  }

  // ---------- focus and announcements ----------

  private adopt(draft: ProgramDraft): void {
    this.draft.set(draft);
    this.dirty.set(false);
    this.problem.set(null);
    this.saveError.set(null);
    this.conflict.set(false);
    this.revision.update((value) => value + 1);
  }

  private focusHeading(): void {
    afterNextRender(() => this.heading()?.nativeElement.focus({ preventScroll: true }), {
      injector: this.injector,
    });
  }

  /** After a week or session moves or goes, focus lands on its week rather than on the page. */
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

  private announce(message: string): void {
    this.toast.show(message, { tone: 'success' });
  }

  private resetTenantState(): void {
    this.libraryTenant = null;
    this.loadedKey = null;
    this.phoneWeek.set(null);
    this.pickerRef = null;
    this.template.set(null);
    this.openVersionId.set(null);
    this.draft.set(emptyProgram());
    this.state.set('loading');
    this.dirty.set(false);
    this.saving.set(null);
    this.problem.set(null);
    this.saveError.set(null);
    this.conflict.set(false);
    this.exercises.set([]);
    this.saved.set([]);
    this.thumbs.set(new Map());
    this.libraryState.set('loading');
    this.editing.set(null);
    this.picking.set(null);
  }
}
