import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  Injector,
  signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom, type Observable } from 'rxjs';
import { apiErrorMessage } from '../../core/api/api-error';
import { AuthStore } from '../../core/auth/auth.store';
import { CsrfService } from '../../core/security/csrf.service';
import { initialsOf } from '../../shell/initials';
import { Avatar } from '../../ui/avatar';
import { Button } from '../../ui/button';
import { UiConfirm } from '../../ui/confirm';
import { UiDialog } from '../../ui/dialog';
import { EmptyState } from '../../ui/empty-state';
import { Icon } from '../../ui/icon';
import { UiSheet } from '../../ui/sheet';
import { Skeleton } from '../../ui/skeleton';
import { UiToast } from '../../ui/toast';
import {
  PlatformCoachAdd,
  PlatformCoachConfirm,
  PlatformCoachErase,
  PlatformCoachLines,
} from './platform-coach-sheets';
import { PlatformCoachesApi } from './platform-coaches-api';
import {
  coachCountSummary,
  countLine,
  erasureToast,
  matchesCoach,
  roleLabel,
  type AddedLine,
  type CertificateCoach,
  type CertificateErasure,
  type CertificateLine,
  type CertificateLines,
} from './platform-coaches.models';

interface CoachRow {
  /** One row per membership: the coach and the space. */
  readonly key: string;
  readonly coach: CertificateCoach;
  readonly initials: string;
  readonly role: string;
  readonly count: string;
}

interface Question {
  readonly message: string;
  readonly confirm: string;
  readonly cancel: string;
}

interface Closable {
  close(result?: unknown): void;
}

/**
 * The platform admin's Coaches page (notes plan N4a, CLI-021): every owner and coach of every coaching
 * space, one row per space they are staff in, with their certificate lines counted. A row opens the
 * coach's sheet with their lines in that space; adding a line, marking one confirmed and erasing on
 * the coach's request open in a sheet on top of it, and dropping or taking a line down asks first.
 * Nothing here reaches a coach or a client.
 *
 * Presentation only. The API authorizes the global role on every request, writes every line's
 * sentence in the space's language, keeps the space's day, refuses the words a line may not hold and
 * keeps what an erasure leaves; nothing is decided in the browser.
 */
@Component({
  selector: 'app-platform-coaches',
  imports: [
    Avatar,
    Button,
    EmptyState,
    Icon,
    PlatformCoachAdd,
    PlatformCoachConfirm,
    PlatformCoachErase,
    PlatformCoachLines,
    RouterLink,
    Skeleton,
    UiConfirm,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './platform-coaches.html',
  styleUrls: ['./platform-coaches.scss', '../clients/clients-toolbar.scss'],
})
export class PlatformCoaches {
  private readonly api = inject(PlatformCoachesApi);
  private readonly csrf = inject(CsrfService);
  private readonly auth = inject(AuthStore);
  private readonly sheets = inject(UiSheet);
  private readonly dialogs = inject(UiDialog);
  private readonly toast = inject(UiToast);
  private readonly injector = inject(Injector);
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly searchBox = viewChild<ElementRef<HTMLInputElement>>('searchBox');
  private readonly coachSheet = viewChild.required<TemplateRef<unknown>>('coachSheet');
  private readonly addSheet = viewChild.required<TemplateRef<unknown>>('addSheet');
  private readonly confirmSheet = viewChild.required<TemplateRef<unknown>>('confirmSheet');
  private readonly eraseSheet = viewChild.required<TemplateRef<unknown>>('eraseSheet');
  private readonly confirmDialog = viewChild.required<TemplateRef<unknown>>('confirmDialog');

  /** The coach's sheet, the write sheet open on top of it, and a question open on top of those. */
  private coachRef: (Closable & { readonly id: string }) | null = null;
  private topRef: Closable | null = null;
  private questionRef: Closable | null = null;
  private topDirty = false;
  /** True while the write sheet on top is saving: it stays open until the answer lands. */
  private topBusy = false;
  /** Set when the page goes, so a read that answers later moves no focus. */
  private destroyed = false;
  /** Counts the reads of a coach's lines, so an answer for a sheet since closed lands nowhere. */
  private linesRead = 0;

  protected readonly closeLabel = $localize`Close`;
  protected readonly loadingLabel = $localize`Loading coaches…`;

  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly coaches = signal<readonly CertificateCoach[]>([]);
  protected readonly search = signal('');
  protected readonly asking = signal<Question | null>(null);

  /** The row whose sheet is open, and that coach's lines as last read. */
  protected readonly sheetCoach = signal<CertificateCoach | null>(null);
  protected readonly linesState = signal<'loading' | 'error' | 'ready'>('loading');
  protected readonly lines = signal<CertificateLines | null>(null);
  /** The line a drop or a take-down is changing. */
  protected readonly working = signal<string | null>(null);

  /**
   * What each write sheet was opened with, kept from that moment: a read of the lines that lands
   * meanwhile must not reset what the admin typed.
   */
  protected readonly addWith = signal<CertificateLines | null>(null);
  protected readonly confirmWith = signal<{
    readonly coach: CertificateLines;
    readonly line: CertificateLine;
    readonly prefill: string;
  } | null>(null);
  protected readonly eraseWith = signal<CertificateLines | null>(null);

  protected readonly query = computed(() => this.search().trim());
  protected readonly rows = computed<CoachRow[]>(() =>
    this.coaches()
      .filter((coach) => matchesCoach(coach, this.search()))
      .map((coach) => ({
        key: `${coach.userId}-${coach.tenantId}`,
        coach,
        initials: initialsOf(coach.name, coach.email),
        role: roleLabel(coach),
        count: countLine(coach),
      })),
  );
  protected readonly resultSummary = computed(() => coachCountSummary(this.rows().length));

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.questionRef?.close();
      this.topRef?.close();
      this.coachRef?.close();
    });
    afterNextRender(() => this.heading()?.nativeElement.focus({ preventScroll: true }));
    void this.load();
  }

  protected async load(): Promise<void> {
    if (this.coaches().length === 0) this.state.set('loading');
    try {
      this.coaches.set(await firstValueFrom(this.api.getCoaches()));
      this.state.set('ready');
    } catch {
      // A reload after a write keeps the list on screen; only a first load shows the failure.
      if (this.coaches().length === 0) this.state.set('error');
    }
  }

  /** Empties the search; the box takes the focus the button that cleared it had. */
  protected clearSearch(): void {
    this.search.set('');
    afterNextRender(() => this.searchBox()?.nativeElement.focus(), { injector: this.injector });
  }

  // ---------- a coach's sheet ----------

  protected openCoach(coach: CertificateCoach): void {
    this.questionRef?.close();
    this.topRef?.close();
    this.coachRef?.close();
    this.sheetCoach.set(coach);
    this.lines.set(null);
    const sheet = this.sheets.open(this.coachSheet(), {
      title: coach.name,
      closeLabel: this.closeLabel,
    });
    this.coachRef = sheet;
    sheet.closed.subscribe(() => {
      if (this.coachRef !== sheet) return;
      this.coachRef = null;
      this.topRef?.close();
      this.linesRead++;
      this.sheetCoach.set(null);
      this.lines.set(null);
    });
    void this.loadLines();
  }

  /** Reads the open sheet's lines; `quiet` keeps the lines on show while it reads after a write. */
  protected async loadLines(quiet = false): Promise<void> {
    const coach = this.sheetCoach();
    if (!coach) return;
    const read = ++this.linesRead;
    if (!quiet) this.linesState.set('loading');
    try {
      const lines = await firstValueFrom(this.api.getLines(coach.userId, coach.tenantId));
      if (read !== this.linesRead) return;
      this.lines.set(lines);
      this.linesState.set('ready');
    } catch {
      if (read !== this.linesRead) return;
      this.linesState.set('error');
    }
  }

  // ---------- the writes, each on top of the coach's sheet ----------

  protected openAdd(): void {
    const lines = this.lines();
    if (!lines?.isActiveStaff) return;
    this.addWith.set(lines);
    this.openTop<AddedLine>(this.addSheet(), $localize`Add a line`, (added) =>
      added.created
        ? this.toast.show($localize`Line added.`, { tone: 'success' })
        : this.toast.show($localize`That line is already on the record.`, { tone: 'info' }),
    );
  }

  protected openConfirm(line: CertificateLine): void {
    const lines = this.lines();
    if (!lines) return;
    this.confirmWith.set({
      coach: lines,
      line,
      prefill: this.auth.user()?.displayName?.trim() ?? '',
    });
    this.openTop<CertificateLine>(this.confirmSheet(), $localize`Mark confirmed`, () =>
      this.toast.show($localize`Line confirmed.`, { tone: 'success' }),
    );
  }

  protected openErase(): void {
    const lines = this.lines();
    if (!lines) return;
    this.eraseWith.set(lines);
    this.openTop<CertificateErasure>(this.eraseSheet(), $localize`Erase on request`, (erasure) =>
      this.toast.show(erasureToast(erasure), {
        tone: erasure.erased + erasure.dropped > 0 ? 'success' : 'info',
      }),
    );
  }

  protected setTopDirty(dirty: boolean): void {
    this.topDirty = dirty;
  }

  protected setTopBusy(busy: boolean): void {
    this.topBusy = busy;
  }

  /** A write sheet's answer: what it saved closes it at once; its Not now asks first when typed work would go. */
  protected async finish(sheet: Closable, result: unknown): Promise<void> {
    if (result) {
      this.topDirty = false;
      sheet.close(result);
      return;
    }
    // A save under way keeps the sheet: closing it now would lose what the server answers.
    if (this.topBusy) return;
    if (!this.topDirty || (await this.askToDiscard())) sheet.close(false);
  }

  protected drop(line: CertificateLine): Promise<void> {
    return this.change(
      line,
      $localize`Drop this line?`,
      {
        message: $localize`Nothing about it is kept.`,
        confirm: $localize`Drop`,
        cancel: $localize`Keep`,
      },
      (lines) => this.api.dropLine(lines.userId, lines.tenantId, line.id, line.version),
      $localize`Line dropped.`,
      $localize`The line couldn’t be dropped. Try again.`,
    );
  }

  protected takeDown(line: CertificateLine): Promise<void> {
    return this.change(
      line,
      $localize`Take this line down?`,
      {
        message: $localize`The coach’s clients stop seeing it at once. TB Gym keeps the words for the keeping period, then erases them.`,
        confirm: $localize`Take down`,
        cancel: $localize`Keep`,
      },
      (lines) => this.api.takeDownLine(lines.userId, lines.tenantId, line.id, line.version),
      $localize`Line taken down.`,
      $localize`The line couldn’t be taken down. Try again.`,
    );
  }

  /** Asks, then changes the line; a refusal (409) says the server's sentence. Either way the lines are read again. */
  private async change(
    line: CertificateLine,
    title: string,
    question: Question,
    send: (lines: CertificateLines) => Observable<unknown>,
    done: string,
    failed: string,
  ): Promise<void> {
    const lines = this.lines();
    if (!lines || this.working()) return;
    if (!(await this.ask(title, question))) return;
    this.working.set(line.id);
    try {
      await this.csrf.refresh();
      await firstValueFrom(send(lines));
      this.toast.show(done, { tone: 'success' });
    } catch (error) {
      this.toast.show(apiErrorMessage(error, failed), { tone: 'error' });
    } finally {
      this.working.set(null);
      await this.refresh();
    }
  }

  private openTop<R>(
    content: TemplateRef<unknown>,
    title: string,
    saved: (result: R) => void,
  ): void {
    this.topRef?.close();
    this.topDirty = false;
    this.topBusy = false;
    const sheet = this.sheets.open<R | false>(content, {
      title,
      closeLabel: this.closeLabel,
      // While its save runs the sheet stays, whichever way it is closed; then typed work is asked about.
      canClose: () => !this.topBusy && (!this.topDirty || this.askToDiscard()),
    });
    this.topRef = sheet;
    sheet.closed.subscribe((result) => {
      if (this.topRef === sheet) this.topRef = null;
      this.topDirty = false;
      this.topBusy = false;
      if (result) saved(result);
      // Whatever happened, show the lines and the list as they are now: a refusal may mean they changed.
      void this.refresh();
    });
  }

  /** The coach's lines and the list, read again after a write. */
  private async refresh(): Promise<void> {
    if (this.destroyed) return;
    await Promise.all([this.loadLines(true), this.load()]);
    this.keepFocus();
  }

  /** When the button that had focus went with the line it served, the coach's sheet's title takes it. */
  private keepFocus(): void {
    const sheet = this.coachRef;
    if (this.destroyed || !sheet || this.topRef) return;
    afterNextRender(
      () => {
        const active = document.activeElement;
        if (active && active !== document.body) return;
        const surface = document.getElementById(sheet.id);
        const title = document.getElementById(surface?.getAttribute('aria-labelledby') ?? '');
        if (!title) return;
        if (!title.hasAttribute('tabindex')) {
          title.setAttribute('tabindex', '-1');
          title.addEventListener('blur', () => title.removeAttribute('tabindex'), { once: true });
        }
        title.focus({ preventScroll: true });
      },
      { injector: this.injector },
    );
  }

  private askToDiscard(): Promise<boolean> {
    return this.ask($localize`Discard what you typed?`, {
      message: $localize`Close without saving? What you typed will be lost.`,
      confirm: $localize`Discard`,
      cancel: $localize`Keep editing`,
    });
  }

  private async ask(title: string, question: Question): Promise<boolean> {
    this.asking.set(question);
    const dialog = this.dialogs.open<boolean>(this.confirmDialog(), {
      title,
      closeLabel: this.closeLabel,
    });
    this.questionRef = dialog;
    const answer = await firstValueFrom(dialog.closed);
    if (this.questionRef === dialog) this.questionRef = null;
    this.asking.set(null);
    return answer === true;
  }
}
