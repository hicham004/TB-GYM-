import {
  CdkDrag,
  type CdkDragDrop,
  CdkDragHandle,
  CdkDragPlaceholder,
  CdkDragPreview,
  CdkDropList,
} from '@angular/cdk/drag-drop';
import { CdkScrollable } from '@angular/cdk/scrolling';
import { DOCUMENT, formatDate, Location } from '@angular/common';
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
  viewChildren,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom, type Observable } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import type {
  CreateProgramDraftRequest,
  ProgramDraftContent,
  ProgramDraftView,
  ProgramTemplateSummary,
  SavedSessionView,
  WeekProgressionPreviewView,
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
import { ExerciseDemo } from './exercise-demo';
import { DraftAutosave, PROGRAM_AUTOSAVE_TIMING, type SaveOutcome } from './program-autosave';
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
  copiesThatFit,
  duplicateWeekAfter,
  exerciseSummary,
  findSession,
  gridColumns,
  insertProgression,
  insertSavedSession,
  libraryExercise,
  type LibraryExercise,
  moveWeek,
  outsideChartCount,
  programFormula,
  removeExercise,
  removeSession,
  removeWeek,
  resortDays,
  rpeLoadedSetCount,
  type RpeFormula,
  type SessionRef,
  startSessionWith,
  versionRows,
  versionToOpen,
  withProgramFormula,
} from './program-builder.models';
import { type LibraryThumbs, ProgramLibrary } from './program-library';
import { ProgramSessionEditor } from './program-session-editor';
import { ProgramSetsEditor } from './program-sets-editor';
import { ProgramPublishPreview } from './program-publish-preview';
import { ProgramWeekProgression } from './program-week-progression';
import {
  type DraftSession,
  type DraftExercise,
  type DraftWeek,
  draftFromContent,
  draftFromVersion,
  emptyProgram,
  numeric,
  type ProgramDraft,
  toDraftContent,
} from './training-builder.models';

/** An open sheet, as far as the page needs it. */
interface Closable {
  close(): void;
}

/** Where the sheet's library adds what the coach picks: a session, or a rest day. */
type PickTarget = { kind: 'session'; ref: SessionRef } | { kind: 'day'; at: DayRef };

/** The coach's draft on the server (TRN-024): its id and the version the next save carries. */
interface StoredDraft {
  id: string;
  version: number;
}

/**
 * Why changes are not reaching the server: another tab or device moved on (reload to continue
 * there), the server refuses them as they stand, or saving is closed (a read-only coaching space).
 */
interface SaveProblem {
  kind: 'stale' | 'refused' | 'closed';
  message: string;
}

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

/** How long leaving waits for the last changes to reach the server before it asks instead. */
const LEAVE_WAIT_MS = 8000;

/**
 * The program builder (C4): the exercise library beside a week × day grid. Exercises are dragged
 * from the library into a session or onto a rest day, sessions between days and weeks, and
 * exercises between sessions (CDK drag and drop); every drag also has a button path, through the
 * session sheet, the add sheet and each card's menu.
 *
 * Changes keep themselves (TRN-024, R4.2a): a moment after the coach stops, the program is sent to
 * their own draft on the server, which follows them to any device and nobody else sees. Publish
 * turns the draft into a new version the coach can assign; clients already on the program keep
 * their own copy (TRN-001). Leaving with changes the server does not have yet saves them first and
 * asks only when that fails.
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
    ExerciseDemo,
    FormsModule,
    Icon,
    ProgramLibrary,
    ProgramSessionEditor,
    ProgramSetsEditor,
    ProgramPublishPreview,
    ProgramWeekProgression,
    RouterLink,
    Skeleton,
    StatusPill,
    UiConfirm,
    UiMenu,
  ],
  templateUrl: './program-builder.html',
  styleUrls: ['./program-builder.scss', './program-week.scss'],
  host: {
    '(window:beforeunload)': 'onBeforeUnload($event)',
    '(document:visibilitychange)': 'onVisibilityChange()',
  },
})
export class ProgramBuilder implements HoldsUnsavedWork {
  private readonly api = inject(ApiClient);
  private readonly programApi = inject(ProgramBuilderApi);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly sheets = inject(UiSheet);
  private readonly dialogs = inject(UiDialog);
  private readonly toast = inject(UiToast);
  private readonly injector = inject(Injector);
  private readonly locale = inject(LOCALE_ID);
  private readonly document = inject(DOCUMENT);
  private readonly location = inject(Location);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());

  private readonly params = toSignal(this.route.paramMap, { requireSync: true });
  private readonly query = toSignal(this.route.queryParamMap, { requireSync: true });
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  protected readonly sessionSheet = viewChild.required<TemplateRef<unknown>>('sessionSheet');
  protected readonly pickerSheet = viewChild.required<TemplateRef<unknown>>('pickerSheet');
  protected readonly historySheet = viewChild.required<TemplateRef<unknown>>('historySheet');
  private readonly confirmDialog = viewChild.required<TemplateRef<unknown>>('confirmDialog');
  private readonly previewSheet = viewChild.required<TemplateRef<unknown>>('previewSheet');
  private readonly progressionSheet = viewChild.required<TemplateRef<unknown>>('progressionSheet');
  private readonly setEditors = viewChildren(ProgramSetsEditor);
  private previewRef: Closable | null = null;
  private libraryTenant: string | null = null;
  private loadedKey: string | null = null;
  private pickerRef: Closable | null = null;
  private stored: StoredDraft | null = null;
  /** Moves whenever the page lets go of its draft, so a save landing afterwards changes nothing. */
  private draftEpoch = 0;
  /** The program's newest version number as read, which a new draft of it records (TRN-024). */
  private readNewest = 0;
  private csrfReady: Promise<void> | null = null;

  /** The program in the address, or null for a new one (`/training/programs/new`). */
  protected readonly templateId = computed(() => {
    const id = this.params().get('templateId');
    return id && id !== 'new' ? id : null;
  });
  private readonly requestedVersion = computed(() => this.query().get('version'));
  /** A new program not published yet, reopened from its draft (`/training/programs/new?draft=`). */
  private readonly requestedDraft = computed(() => this.query().get('draft'));

  protected readonly draft = signal<ProgramDraft>(emptyProgram());
  protected readonly template = signal<ProgramTemplateSummary | null>(null);
  protected readonly openVersionId = signal<string | null>(null);
  protected readonly state = signal<'loading' | 'ready' | 'missing' | 'error'>('loading');
  protected readonly publishing = signal(false);
  protected readonly preview = signal<ProgramDraft | null>(null);
  protected readonly inlineEditing = signal<string | null>(null);
  protected readonly problem = signal<DraftProblem | null>(null);
  protected readonly saveError = signal<string | null>(null);
  protected readonly saveProblem = signal<SaveProblem | null>(null);
  /** Set when someone published a version after this draft began, and Publish waits for a choice. */
  protected readonly newerVersion = signal<string | null>(null);
  /** True while the coach's draft of this program is on the server. */
  protected readonly hasDraft = signal(false);
  protected readonly draftSavedAt = signal<string | null>(null);
  protected readonly draftStartedAt = signal(0);
  /** Increases on every change, so the open session sheet redraws edits made around it. */
  protected readonly revision = signal(0);

  protected readonly autosave = new DraftAutosave(
    () => this.sendDraft(),
    inject(PROGRAM_AUTOSAVE_TIMING),
  );

  protected readonly exercises = signal<LibraryExercise[]>([]);
  protected readonly libraryState = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly saved = signal<SavedSessionView[]>([]);
  protected readonly thumbs = signal<LibraryThumbs>(new Map());
  protected readonly libraryOpen = signal(true);
  /** Each library exercise's demos, so a grid row can offer Watch demo (P4). */
  private readonly libraryMedia = computed(
    () => new Map(this.exercises().map((item) => [item.id, item.mediaIds] as const)),
  );
  /** The week a phone shows; null until one is chosen, then the first. */
  protected readonly phoneWeek = signal<string | null>(null);

  protected readonly editing = signal<SessionRef | null>(null);
  protected readonly picking = signal<PickTarget | null>(null);
  protected readonly addedInSheet = signal<ReadonlySet<string>>(new Set());
  protected readonly announcement = signal('');
  protected readonly savingSession = signal(false);
  /** The question the open confirmation dialog asks. */
  protected readonly asking = signal<{ message: string; confirm: string; cancel: string } | null>(
    null,
  );
  /** What a screen reader is told about saving: a failure, and the save that ends it. */
  protected readonly liveStatus = signal('');
  private announcedTrouble = false;

  protected readonly loadingLabel = $localize`Loading the program…`;
  protected readonly closeLabel = $localize`Close`;
  protected readonly sharedLabel = $localize`Shared with client`;
  protected readonly dragDelay = { touch: 250, mouse: 0 };
  /** A program holds up to 52 weeks, as the server allows (TRN-005). */
  protected readonly maxWeeks = 52;
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
  /** Changes on screen the server does not have yet. */
  protected readonly unsaved = computed(() => this.autosave.status() !== 'saved');
  /** Saving is ordinary; failing to is not, and the status line says so in the warm colour. */
  protected readonly troubled = computed(() =>
    ['retrying', 'refused', 'stopped'].includes(this.autosave.status()),
  );
  protected readonly columns = computed(() => {
    const draft = this.draft();
    const key = this.inlineEditing();
    const session = draft.weeks
      .flatMap((week) => week.sessions)
      .find((item) => item.exercises.some((exercise) => exercise.key === key));
    return gridColumns(draft, session?.dayOffset ?? null);
  });
  protected readonly grid = computed(() =>
    this.rows(this.draft(), this.hasDraft() || this.unsaved()),
  );
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

  /** The week whose "Duplicate with progression" sheet is open (TRN-025). */
  protected readonly progressing = signal<string | null>(null);
  /** The formula the program's RPE-loaded sets use (STR-010); null while no set uses one. */
  protected readonly formula = computed(() => {
    this.revision();
    return programFormula(this.draft());
  });
  protected readonly formulaLabel = computed(() => {
    const formula = this.formula();
    const name =
      formula === 'RpeChart'
        ? $localize`RTS chart`
        : formula === 'RpeBasedEpley'
          ? $localize`Epley curve`
          : $localize`mixed`;
    return $localize`Weights from RPE: ${name}:formula:`;
  });
  protected readonly formulaItems: UiMenuItem[] = [
    {
      label: $localize`RTS chart (recommended)`,
      hint: $localize`RPE 6.5 to 10, 1 to 12 reps`,
      action: 'RpeChart',
    },
    {
      label: $localize`Epley curve`,
      hint: $localize`Any RPE from 5, reps plus RIR up to 12`,
      action: 'RpeBasedEpley',
    },
  ];

  private readonly openVersion = computed(
    () => this.template()?.versions.find((version) => version.id === this.openVersionId()) ?? null,
  );
  private readonly isLatest = computed(
    () => this.template()?.versions[0]?.id === this.openVersionId(),
  );
  protected readonly olderLine = computed(() => {
    const open = this.openVersion();
    if (!open || this.isLatest() || this.hasDraft()) return null;
    const row = versionRows(this.template()!, open.id, this.locale).find(
      (item) => item.id === open.id,
    );
    return $localize`You’re looking at an earlier version (${row?.title}:version:, ${row?.date}:date:). Publishing makes it the newest version.`;
  });
  /** A draft begun before the program's newest version was published says so up front. */
  protected readonly behindLine = computed(() => {
    const template = this.template();
    const started = this.draftStartedAt();
    if (!template || !this.hasDraft() || started === 0) return null;
    const newest = numeric(template.currentVersionNumber);
    return newest > started
      ? $localize`Version ${newest}:number: was published after you started these changes. Publishing yours makes it the newest version; version ${newest}:number: stays in Versions.`
      : null;
  });
  protected readonly statusLine = computed(() => {
    switch (this.autosave.status()) {
      case 'pending':
      case 'saving':
        return $localize`Saving…`;
      case 'retrying':
        return $localize`Not saved yet. Trying again…`;
      case 'refused':
      case 'stopped':
        return $localize`Not saved`;
    }
    if (this.hasDraft()) return this.savedLine(this.draftSavedAt());
    const open = this.openVersion();
    if (!open) return $localize`Your changes save as you work`;
    return open.isPublished
      ? $localize`Published: you can assign it`
      : $localize`Draft: not ready to assign`;
  });
  protected readonly canPublish = computed(
    () =>
      this.isNew() ||
      this.hasDraft() ||
      this.unsaved() ||
      !this.isLatest() ||
      !(this.openVersion()?.isPublished ?? false),
  );
  protected readonly canDiscard = computed(() => this.hasDraft() || this.unsaved());
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
    const unregister = inject(UnsavedWork).register(this);
    inject(DestroyRef).onDestroy(() => {
      unregister();
      this.autosave.dispose();
    });
    effect(() => {
      const troubled = this.troubled();
      const status = this.autosave.status();
      const line = this.statusLine();
      untracked(() => {
        if (troubled) {
          this.announcedTrouble = true;
          this.liveStatus.set(line);
        } else if (status === 'saved' && this.announcedTrouble) {
          this.announcedTrouble = false;
          this.liveStatus.set($localize`Your changes are saved now.`);
        }
      });
    });
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
      const draftId = this.requestedDraft();
      if (!tenant) return;
      const key = this.addressKey(tenant, id, version, draftId);
      if (key === this.loadedKey) return;
      this.loadedKey = key;
      untracked(() => void this.loadProgram(id, version, draftId, false));
    });
  }

  // ---------- loading ----------

  protected async loadProgram(
    id: string | null,
    version: string | null,
    draftId: string | null,
    quiet: boolean,
  ): Promise<void> {
    return this.scope.run('program', async (owner) => {
      // The address changed under the page (Back, a link): changes still on their way go first.
      if (this.autosave.hasUnsaved) await owner.wait(this.sendRemaining());
      this.forgetDraft();
      if (id === null && draftId === null) {
        this.template.set(null);
        this.openVersionId.set(null);
        this.readNewest = 0;
        this.adopt(emptyProgram());
        this.state.set('ready');
        this.focusHeading();
        return;
      }
      if (!quiet) this.state.set('loading');
      try {
        if (id === null) {
          const view = await owner.wait(firstValueFrom(this.programApi.getDraft(draftId!)));
          if (view.templateId) {
            // Changes to a saved program open with that program.
            await owner.wait(
              this.router.navigate(['/training/programs', view.templateId], { replaceUrl: true }),
            );
            return;
          }
          this.template.set(null);
          this.openVersionId.set(null);
          this.readNewest = 0;
          this.adoptStored(view);
        } else {
          const template = await owner.wait(firstValueFrom(this.programApi.getProgram(id)));
          this.readNewest = numeric(template.currentVersionNumber);
          if (template.draft) {
            // The coach's own changes win over a version named in the address: they are never set
            // aside without asking.
            const view = await owner.wait(
              firstValueFrom(this.programApi.getDraft(template.draft.id)),
            );
            this.template.set(template);
            this.openVersionId.set(view.sourceVersionId);
            this.adoptStored(view);
            if (version) this.dropVersionFromAddress(owner.tenantId, id);
          } else {
            const versionId = versionToOpen(template, version);
            if (!versionId) {
              this.state.set('missing');
              return;
            }
            const view = await owner.wait(
              firstValueFrom(this.api.getProgramTemplateVersion(versionId)),
            );
            this.template.set(template);
            this.openVersionId.set(versionId);
            this.adopt(draftFromVersion(view));
          }
        }
        this.state.set('ready');
        if (!quiet) this.focusHeading();
      } catch (error) {
        if (!owner.current) return;
        if (error instanceof HttpErrorResponse && error.status === 404) {
          this.state.set('missing');
        } else if (quiet) {
          this.saveError.set(
            $localize`Published, but the newest version could not be opened. Reload the page.`,
          );
        } else {
          this.state.set('error');
        }
      }
    });
  }

  protected retryProgram(): void {
    void this.loadProgram(this.templateId(), this.requestedVersion(), this.requestedDraft(), false);
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

  protected editSets(key: string): void {
    this.inlineEditing.set(this.inlineEditing() === key ? null : key);
  }

  /** Previewing changes nothing; only the explicit action in the preview creates a version. */
  protected openPreview(replaceNewer = false): void {
    if (this.publishing() || this.previewRef) return;
    const problem = draftProblem(this.draft());
    this.problem.set(problem);
    this.saveError.set(null);
    if (problem) {
      if (problem.sessionKey) this.openProblem();
      else
        afterNextRender(
          () => this.host.nativeElement.querySelector<HTMLInputElement>('.name-input')?.focus(),
          { injector: this.injector },
        );
      return;
    }
    if (!replaceNewer) this.newerVersion.set(null);
    this.preview.set(structuredClone(this.draft()));
    const sheet = this.sheets.open(this.previewSheet(), {
      title: $localize`Preview before publishing`,
      closeLabel: this.closeLabel,
    });
    this.previewRef = sheet;
    sheet.closed.subscribe(() => {
      this.previewRef = null;
      this.preview.set(null);
    });
  }

  private changed(): void {
    this.problem.set(null);
    this.saveError.set(null);
    this.revision.update((value) => value + 1);
    this.autosave.changed();
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
      case 'progress':
        this.openProgression(weekKey);
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

  private openProgression(weekKey: string): void {
    this.progressing.set(weekKey);
    const sheet = this.sheets.open(this.progressionSheet(), {
      title: $localize`Duplicate with progression`,
      closeLabel: this.closeLabel,
    });
    sheet.closed.subscribe(() => this.progressing.set(null));
  }

  /** The weeks the coach has read join the draft after their source, with an Undo for all of them. */
  protected addProgression(
    weekKey: string,
    preview: WeekProgressionPreviewView,
    sheet: Closable,
  ): void {
    const before = this.draft();
    const next = insertProgression(before, weekKey, preview);
    if (next === before) return;
    const source = before.weeks.findIndex((week) => week.key === weekKey);
    sheet.close();
    this.commit(next);
    this.focusWeek(next.weeks[source + 1]?.key);
    const count = preview.weeks.length;
    this.offerUndo(
      count === 1
        ? $localize`1 week added after week ${source + 1}:number:.`
        : $localize`${count}:count: weeks added after week ${source + 1}:number:.`,
      before,
    );
  }

  /** The program's RPE-loaded sets all move to the chosen formula; Undo puts them back. */
  protected chooseFormula(action: string): void {
    const formula: RpeFormula | null =
      action === 'RpeChart' || action === 'RpeBasedEpley' ? action : null;
    const before = this.draft();
    if (!formula || programFormula(before) === formula) return;
    const count = rpeLoadedSetCount(before);
    const next = withProgramFormula(before, formula);
    this.commit(next);
    const outside = formula === 'RpeChart' ? outsideChartCount(next) : 0;
    const name = formula === 'RpeChart' ? $localize`the RTS chart` : $localize`the Epley curve`;
    const message =
      count === 1
        ? $localize`1 set now takes its weight from ${name}:formula:.`
        : $localize`${count}:count: sets now take their weight from ${name}:formula:.`;
    const warning =
      outside === 1
        ? $localize`1 of them is outside the chart: type a weight or use the Epley curve for it.`
        : $localize`${outside}:count: of them are outside the chart: type a weight or use the Epley curve for those.`;
    this.offerUndo(outside > 0 ? `${message} ${warning}` : message, before);
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
      initialFocus: findSession(this.draft(), ref)?.name.trim()
        ? undefined
        : 'app-program-session-editor .basics input',
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

  /** Another version from the Versions sheet; changes not published are discarded first, if asked. */
  protected async openOtherVersion(versionId: string | null, sheet: Closable): Promise<void> {
    sheet.close();
    const id = this.templateId();
    if (!id) return;
    if (this.canDiscard()) {
      const agreed = await this.ask({
        title: $localize`Open another version?`,
        message: $localize`Your changes that are not published will be discarded. This can’t be undone.`,
        confirm: $localize`Discard and open`,
        cancel: $localize`Keep my changes`,
      });
      if (agreed) await this.discardThenOpen(id, versionId);
      return;
    }
    await this.router.navigate(['/training/programs', id], {
      queryParams: versionId ? { version: versionId } : {},
    });
  }

  // ---------- keeping changes ----------

  /**
   * One autosave: the program as it stands now, to the coach's draft. Its first save starts the
   * draft; every later one carries the version it read, so two tabs never overwrite each other.
   */
  private sendDraft(): Promise<SaveOutcome> {
    return this.scope.run(
      'autosave',
      async (owner) => {
        // Read before anything is awaited, so the content matches the edits the autosave counted.
        const content = toDraftContent(this.draft());
        const stored = this.stored;
        const epoch = this.draftEpoch;
        try {
          const saved = await this.write(owner, () =>
            stored
              ? this.programApi.saveDraft(stored.id, { content, version: stored.version })
              : this.programApi.createDraft(this.startRequest(content)),
          );
          if (epoch !== this.draftEpoch) return 'stopped';
          this.stored = { id: saved.id, version: numeric(saved.version) };
          this.hasDraft.set(true);
          this.draftSavedAt.set(saved.updatedAtUtc);
          this.saveProblem.set(null);
          if (!stored && this.template() === null) {
            this.showDraftInAddress(saved.id);
          } else if (!stored) {
            this.draftStartedAt.set(this.readNewest);
          }
          return 'saved';
        } catch (error) {
          return owner.current && epoch === this.draftEpoch ? this.saveOutcome(error) : 'stopped';
        }
      },
      'stopped',
    );
  }

  private startRequest(content: ProgramDraftContent): CreateProgramDraftRequest {
    const template = this.template();
    return template
      ? {
          templateId: template.id,
          sourceVersionId: this.openVersionId(),
          templateVersionNumber: this.readNewest,
          content,
        }
      : { templateId: null, sourceVersionId: null, templateVersionNumber: null, content };
  }

  /** What a failed save means for the next one, said in coach words where the coach must act. */
  private saveOutcome(error: unknown): SaveOutcome {
    if (!(error instanceof HttpErrorResponse)) return 'retry';
    const code = (error.error as { code?: unknown } | null)?.code;
    if (error.status === 0 || error.status === 429 || error.status >= 500) return 'retry';
    if (error.status === 400 || code === 'program_draft_limit') {
      this.saveProblem.set({
        kind: 'refused',
        message: apiErrorMessage(error, $localize`Your latest changes could not be saved.`),
      });
      return 'refused';
    }
    if (error.status === 401 || error.status === 403) {
      this.saveProblem.set({
        kind: 'closed',
        message: apiErrorMessage(
          error,
          $localize`Your changes can’t be saved right now. Copy anything you need before you leave.`,
        ),
      });
      return 'stopped';
    }
    // Gone or moved on: published or discarded elsewhere, or saved in another tab since this read.
    this.saveProblem.set({
      kind: 'stale',
      message: $localize`This program was changed in another tab or on another device. Reload to continue with the latest changes.`,
    });
    return 'stopped';
  }

  /** Publish: everything on screen is stored first, then the stored draft becomes the version. */
  protected async publish(replaceNewer = false): Promise<void> {
    if (this.publishing()) return;
    const problem = draftProblem(this.draft());
    this.problem.set(problem);
    this.saveError.set(null);
    this.newerVersion.set(null);
    if (problem) return;

    return this.scope.run('publish', async (owner) => {
      this.publishing.set(true);
      const isFirst = this.template() === null;
      try {
        // An untouched program (an earlier version, or one never published) gets its draft now.
        if (!this.stored && !this.autosave.hasUnsaved) this.autosave.changed();
        if (!(await owner.wait(this.autosave.flush())) || !this.stored) {
          this.saveError.set(
            this.saveProblem()?.message ??
              $localize`Your latest changes could not be saved, so nothing was published. Check your connection and try again.`,
          );
          return;
        }
        const stored: StoredDraft = this.stored;
        const version = await this.write(owner, () =>
          this.programApi.publishDraft(stored.id, { version: stored.version, replaceNewer }),
        );
        this.previewRef?.close();
        this.forgetDraft();
        // The address names the program, and no longer a draft or an older version; the page stays.
        this.loadedKey = this.addressKey(owner.tenantId, version.templateId, null, null);
        await owner.wait(
          this.router.navigate(['/training/programs', version.templateId], { replaceUrl: true }),
        );
        await owner.wait(this.loadProgram(version.templateId, null, null, true));
        this.toast.show(
          isFirst
            ? $localize`Published. You can assign it to clients now.`
            : $localize`Published. Clients already on this program keep their own copy.`,
          { tone: 'success' },
        );
      } catch (error) {
        if (!owner.current) return;
        await this.publishRefused(owner, error);
      } finally {
        if (owner.current) this.publishing.set(false);
      }
    });
  }

  private async publishRefused(owner: TenantOperation, error: unknown): Promise<void> {
    const code =
      error instanceof HttpErrorResponse ? (error.error as { code?: unknown } | null)?.code : null;
    if (code === 'newer_version_published') {
      // Read again, so the sentence names the version that was published in between.
      const id = this.templateId();
      try {
        if (id) this.template.set(await owner.wait(firstValueFrom(this.programApi.getProgram(id))));
      } catch {
        // The sentence below still holds without the number.
      }
      const newest = numeric(this.template()?.currentVersionNumber ?? 0);
      this.newerVersion.set(
        newest > 0
          ? $localize`Version ${newest}:number: of this program was published after you started these changes. Publish yours as the newest version? Version ${newest}:number: stays in Versions.`
          : $localize`A newer version of this program was published after you started these changes. Publish yours as the newest version? The other one stays in Versions.`,
      );
      return;
    }
    if (
      error instanceof HttpErrorResponse &&
      (error.status === 404 || code === 'program_draft_stale')
    ) {
      this.saveOutcome(error);
      return;
    }
    this.saveError.set(
      apiErrorMessage(
        error,
        $localize`The program could not be published. Your changes are kept; try again.`,
      ),
    );
  }

  protected openProblem(): void {
    const problem = this.problem();
    if (problem?.exerciseKey && problem.setKey) {
      this.phoneWeek.set(problem.weekKey ?? null);
      this.inlineEditing.set(problem.exerciseKey);
      afterNextRender(
        () => {
          this.setEditors()
            .find((editor) => editor.exercise().key === problem.exerciseKey)
            ?.focus(problem.setKey!);
        },
        { injector: this.injector },
      );
      return;
    }
    if (problem?.weekKey && problem.sessionKey) {
      this.openSession({ weekKey: problem.weekKey, sessionKey: problem.sessionKey });
    }
  }

  /** Discard: the coach's changes go, and the program as last saved comes back. */
  protected async discard(): Promise<void> {
    const id = this.templateId();
    const agreed = await this.ask({
      title: id ? $localize`Discard your changes?` : $localize`Discard this program?`,
      message: id
        ? $localize`The program goes back to how it was last published. This can’t be undone.`
        : $localize`It was never published, so no client has it. This can’t be undone.`,
      confirm: id ? $localize`Discard changes` : $localize`Discard program`,
      cancel: $localize`Keep editing`,
    });
    if (agreed) await this.discardThenOpen(id, null);
  }

  /** Removes the coach's draft, then opens a version of the program (the newest when null). */
  private async discardThenOpen(id: string | null, versionId: string | null): Promise<void> {
    return this.scope.run('discard', async (owner) => {
      await owner.wait(this.autosave.hold());
      const stored = this.stored;
      try {
        if (stored) {
          await this.write(owner, () => this.programApi.discardDraft(stored.id, stored.version));
        }
      } catch (error) {
        if (!owner.current) return;
        // A draft already gone (published or discarded in another tab) needs no discarding.
        if (!(error instanceof HttpErrorResponse && error.status === 404)) {
          this.autosave.release();
          if (
            error instanceof HttpErrorResponse &&
            (error.error as { code?: unknown } | null)?.code === 'program_draft_stale'
          ) {
            this.saveOutcome(error);
          } else {
            this.saveError.set(
              apiErrorMessage(error, $localize`Your changes could not be discarded. Try again.`),
            );
          }
          return;
        }
      }
      this.forgetDraft();
      if (id === null) {
        this.loadedKey = null;
        await owner.wait(this.router.navigate(['/training/programs']));
        this.toast.show($localize`Program discarded.`);
        return;
      }
      this.loadedKey = this.addressKey(owner.tenantId, id, versionId, null);
      await owner.wait(
        this.router.navigate(['/training/programs', id], {
          queryParams: versionId ? { version: versionId } : {},
          replaceUrl: true,
        }),
      );
      await owner.wait(this.loadProgram(id, versionId, null, false));
      if (!versionId) this.toast.show($localize`Changes discarded.`);
    });
  }

  /** After another tab moved on: the page reads the program again, as the server now has it. */
  protected reloadLatest(): void {
    this.loadedKey = null;
    this.forgetDraft();
    this.retryProgram();
  }

  /**
   * Asked before the page goes (the route guard, a workspace switch, a sign-out). Changes not on the
   * server yet are sent first; only when that fails does the coach choose.
   */
  async canLeave(): Promise<boolean> {
    if (!this.autosave.hasUnsaved || (await this.sendRemaining())) return true;
    return this.ask({
      title: $localize`Leave without saving?`,
      message:
        this.saveProblem()?.message ??
        $localize`Your latest changes have not reached the server yet. If you leave now, they are lost.`,
      confirm: $localize`Leave without saving`,
      cancel: $localize`Stay`,
    });
  }

  /** A reload or a closed tab cannot wait for a save, so the browser asks first. */
  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.autosave.hasUnsaved) {
      event.preventDefault();
      event.returnValue = '';
    }
  }

  /** Changes go as the tab is hidden, while it can still send them (a phone locking, a new tab). */
  protected onVisibilityChange(): void {
    const status = this.autosave.status();
    if (
      this.document.visibilityState === 'hidden' &&
      (status === 'pending' || status === 'retrying')
    ) {
      void this.autosave.flush();
    }
  }

  protected async saveToLibrary(session: DraftSession): Promise<void> {
    const versionId = this.openVersionId();
    const sourceId = session.sourceId;
    if (!versionId || !sourceId) return;
    return this.scope.run('saveSession', async (owner) => {
      this.savingSession.set(true);
      try {
        await this.write(owner, () =>
          this.api.saveTrainingSession({
            name: session.name.trim(),
            sourceTemplateVersionId: versionId,
            sourceTemplateSessionId: sourceId,
          }),
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

  private rows(draft: ProgramDraft, changed: boolean): WeekRow[] {
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
          {
            label: $localize`Duplicate week`,
            action: 'duplicate',
            disabled: draft.weeks.length >= this.maxWeeks,
            hint:
              draft.weeks.length >= this.maxWeeks
                ? $localize`A program holds up to ${this.maxWeeks}:count: weeks.`
                : undefined,
          },
          {
            label: $localize`Duplicate with progression…`,
            action: 'progress',
            disabled: copiesThatFit(draft) === 0,
            hint:
              copiesThatFit(draft) === 0
                ? $localize`A program holds up to ${this.maxWeeks}:count: weeks.`
                : undefined,
          },
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
            sessions: sessions.map((session) => this.sessionCell(week, session, changed)),
          };
        }),
      };
    });
  }

  private sessionCell(week: DraftWeek, session: DraftSession, changed: boolean): SessionCell {
    const ref = { weekKey: week.key, sessionKey: session.key };
    const name = session.name.trim() || $localize`Unnamed session`;
    // A saved session is copied from a published version, so it waits for changes to be published.
    const canSave = Boolean(session.sourceId) && !changed;
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
          hint: canSave ? undefined : $localize`Publish the program first`,
        },
        { label: $localize`Delete session`, action: 'delete', danger: true },
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

  // ---------- helpers ----------

  /** Sends what the server does not have yet, waiting a few seconds at most; true once it has it. */
  private sendRemaining(): Promise<boolean> {
    return Promise.race([
      this.autosave.flush(),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), LEAVE_WAIT_MS)),
    ]);
  }

  /** "Saved at 14:32, not published yet", or the day when it was another day. */
  private savedLine(savedAt: string | null): string {
    if (!savedAt) return $localize`Changes saved, not published yet`;
    const day = formatDate(savedAt, 'yyyy-MM-dd', this.locale);
    const today = formatDate(new Date(), 'yyyy-MM-dd', this.locale);
    return day === today
      ? $localize`Saved at ${formatDate(savedAt, 'HH:mm', this.locale)}:time:, not published yet`
      : $localize`Saved on ${formatDate(savedAt, 'EEE d MMM', this.locale)}:date:, not published yet`;
  }

  /**
   * A write with the antiforgery token refreshed once per page (a write straight after sign-in is
   * refused otherwise), and refreshed again when the server says it expired.
   */
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

  private addressKey(
    tenant: string,
    id: string | null,
    version: string | null,
    draftId: string | null,
  ): string {
    return `${tenant}|${id ?? 'new'}|${version ?? ''}|${draftId ?? ''}`;
  }

  /** The program opened on the coach's draft, so the address no longer names an older version. */
  private dropVersionFromAddress(tenant: string, id: string): void {
    this.loadedKey = this.addressKey(tenant, id, null, null);
    void this.router.navigate(['/training/programs', id], { replaceUrl: true });
  }

  /**
   * A new program's draft goes into the address, so a refresh reopens it. Not through the router: a
   * navigation scrolls the page to the top, and this happens mid-edit, at the first autosave.
   */
  private showDraftInAddress(draftId: string): void {
    this.location.replaceState('/training/programs/new', `draft=${encodeURIComponent(draftId)}`);
  }

  private adopt(draft: ProgramDraft): void {
    this.draft.set(draft);
    this.problem.set(null);
    this.saveError.set(null);
    this.newerVersion.set(null);
    this.revision.update((value) => value + 1);
  }

  private adoptStored(view: ProgramDraftView): void {
    this.stored = { id: view.id, version: numeric(view.version) };
    this.hasDraft.set(true);
    this.draftSavedAt.set(view.updatedAtUtc);
    this.draftStartedAt.set(numeric(view.startedAtVersionNumber));
    this.adopt(draftFromContent(view));
  }

  /** The page no longer holds a draft: opened afresh, published or discarded. */
  private forgetDraft(): void {
    this.draftEpoch += 1;
    this.autosave.reset();
    this.stored = null;
    this.hasDraft.set(false);
    this.draftSavedAt.set(null);
    this.draftStartedAt.set(0);
    this.saveProblem.set(null);
    this.newerVersion.set(null);
    this.announcedTrouble = false;
    this.liveStatus.set('');
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
    this.previewRef?.close();
    this.inlineEditing.set(null);
    this.libraryTenant = null;
    this.loadedKey = null;
    this.csrfReady = null;
    this.phoneWeek.set(null);
    this.pickerRef = null;
    this.template.set(null);
    this.openVersionId.set(null);
    this.readNewest = 0;
    this.forgetDraft();
    this.draft.set(emptyProgram());
    this.state.set('loading');
    this.publishing.set(false);
    this.problem.set(null);
    this.saveError.set(null);
    this.exercises.set([]);
    this.saved.set([]);
    this.thumbs.set(new Map());
    this.libraryState.set('loading');
    this.editing.set(null);
    this.picking.set(null);
  }
}
