import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  LOCALE_ID,
  linkedSignal,
  output,
  signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { FormAttempt } from '../../core/forms/form-attempt';
import { CsrfService } from '../../core/security/csrf.service';
import { Button } from '../../ui/button';
import { UiConfirm } from '../../ui/confirm';
import { DateField } from '../../ui/date-field';
import { UiDialog } from '../../ui/dialog';
import { Control, Field } from '../../ui/field';
import { ModalFooter, modalFormId } from '../../ui/modal-footer';
import { Skeleton } from '../../ui/skeleton';
import { StatusPill } from '../../ui/status-pill';
import { PlatformCoachesApi } from './platform-coaches-api';
import {
  addLineErrors,
  byLine,
  CERTIFICATE_EARLIEST_DAY,
  certificateRefusal,
  confirmLineErrors,
  deadlineSentence,
  erasedText,
  eraseErrors,
  pillFor,
  roleLabel,
  type AddedLine,
  type CertificateCoach,
  type CertificateErasure,
  type CertificateField,
  type CertificateFieldErrors,
  type CertificateLine,
  type CertificateLines,
  type CertificateLineState,
  type CertificatePill,
  type CertificateSpace,
} from './platform-coaches.models';
import { focusFirstProblem, SHEET_STYLES } from './platform-sheets';

/**
 * The Coaches page's sheets (notes plan N4a, CLI-021): a coach's lines in one coaching space, and the
 * three writes that open on top of it, adding a line, marking one confirmed and erasing every line on
 * the coach's request. Like the billing sheets they ask only for what the server needs, keep a
 * refusal on screen in the server's own words (under its field when the server names one), and tell
 * the page when they hold typed work. The server writes each line's sentence, keeps the space's day
 * and refuses what a line may not hold; nothing is decided here. Their templates are files of their
 * own, so the words test reads them as they are.
 */

/** The coach's lines: one per proof, each with its pill, who acted and what can be done to it. */
const LINES_STYLES = `
  .add {
    display: flex;
  }

  .failed {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem 1rem;
    justify-content: space-between;
  }

  .none {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .lines {
    display: flex;
    flex-direction: column;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .line {
    border-block-start: 1px solid var(--tb-line);
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    padding-block: 0.875rem;
  }

  .line:first-child {
    border-block-start: 0;
    padding-block-start: 0;
  }

  .head {
    align-items: flex-start;
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem 0.75rem;
    justify-content: space-between;
  }

  .sentence {
    flex: 1 1 14rem;
    font-weight: 600;
    min-inline-size: 0;
  }

  .sentence.muted {
    font-weight: 400;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .foot {
    border-block-start: 1px solid var(--tb-line);
    padding-block-start: 0.75rem;
  }
`;

interface LineRow {
  readonly id: string;
  readonly line: CertificateLine;
  readonly state: CertificateLineState;
  /** The server's sentence, or null once the line is erased. */
  readonly text: string | null;
  /** What an erased line shows in place of its sentence. */
  readonly erased: string | null;
  readonly pill: CertificatePill;
  /** Who acted, unless it would only say again what an erased line already says. */
  readonly by: string | null;
}

@Component({
  selector: 'app-platform-coach-lines',
  imports: [Button, Skeleton, StatusPill],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './platform-coach-lines.html',
  styles: SHEET_STYLES + LINES_STYLES,
})
export class PlatformCoachLines {
  private readonly locale = inject(LOCALE_ID);

  /** The row the sheet was opened from, which says who it is about until the lines are read. */
  readonly coach = input.required<CertificateCoach>();
  readonly state = input.required<'loading' | 'error' | 'ready'>();
  readonly lines = input<CertificateLines | null>(null);
  /** The line a drop or a take-down is changing, so its buttons wait. */
  readonly working = input<string | null>(null);

  readonly retry = output<void>();
  readonly add = output<void>();
  readonly confirmLine = output<CertificateLine>();
  readonly dropLine = output<CertificateLine>();
  readonly takeDownLine = output<CertificateLine>();
  readonly erase = output<void>();

  protected readonly loadingLabel = $localize`Loading their lines…`;
  /** The latest word on who they are: the lines as read, else the row. */
  protected readonly who = computed(() => this.lines() ?? this.coach());
  protected readonly role = computed(() => roleLabel(this.who()));
  protected readonly rows = computed<LineRow[]>(() =>
    (this.lines()?.lines ?? []).map((line) => this.toRow(line)),
  );
  /** An erasure on request has something to erase while any line is not erased yet. */
  protected readonly canErase = computed(() =>
    (this.lines()?.lines ?? []).some((line) => line.state !== 'Erased'),
  );

  private toRow(line: CertificateLine): LineRow {
    const erased = line.state === 'Erased' ? erasedText(line) : null;
    const by = byLine(line, this.locale);
    return {
      id: line.id,
      line,
      state: line.state,
      text: line.state === 'Erased' ? null : line.text,
      erased,
      pill: pillFor(line, this.locale),
      by: by === erased ? null : by,
    };
  }
}

// ------------------------------------------------------------------------------------------------

@Component({
  selector: 'app-platform-coach-add',
  imports: [Button, Control, DateField, Field, ModalFooter],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './platform-coach-add.html',
  styles: SHEET_STYLES,
})
export class PlatformCoachAdd {
  private readonly api = inject(PlatformCoachesApi);
  private readonly csrf = inject(CsrfService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  /** The coach and the space, with the space's today, as the page read them when the sheet opened. */
  readonly coach = input.required<CertificateSpace>();
  /** The line the server answered with, or false when the sheet was closed without adding. */
  readonly closed = output<AddedLine | false>();
  readonly dirtyChange = output<boolean>();
  /** True while the save runs: the page keeps the sheet open until its answer lands. */
  readonly busyChange = output<boolean>();

  protected readonly attempt = new FormAttempt();
  protected readonly formId = modalFormId('platform-coach-add');
  protected readonly earliest = CERTIFICATE_EARLIEST_DAY;
  protected readonly whatLabel = $localize`What they showed`;
  protected readonly whatHelp = $localize`In the coach’s own words: the certificate, the gym they own, the years they coached, the degree.`;
  protected readonly shownOnLabel = $localize`Shown on`;

  protected readonly what = signal('');
  /** The space's today to start with, never the device's. */
  protected readonly shownOn = linkedSignal(() => this.coach().spaceToday);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  /** What the server said of a field, until that field changes. */
  private readonly refused = signal<CertificateFieldErrors>({});

  protected readonly errors = computed(() =>
    addLineErrors({ what: this.what(), shownOn: this.shownOn() }, this.coach().spaceToday),
  );
  protected readonly problemCount = computed(() => Object.keys(this.errors()).length);

  constructor() {
    effect(() =>
      this.dirtyChange.emit(
        this.what().trim() !== '' || this.shownOn() !== this.coach().spaceToday,
      ),
    );
    effect(() => this.busyChange.emit(this.busy()));
  }

  protected setWhat(value: string): void {
    this.what.set(value);
    this.forget('what');
  }

  protected setShownOn(value: string): void {
    this.shownOn.set(value);
    this.forget('shownOn');
  }

  /** The field's own message once it is due, else what the server said of it. */
  protected errorsFor(field: CertificateField): readonly string[] | null {
    const local = this.errors()[field] ?? [];
    if (this.attempt.shows(field, local)) return local;
    return this.refused()[field] ?? null;
  }

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    if (this.problemCount() > 0) {
      this.attempt.attempt();
      focusFirstProblem(this.host, this.injector);
      return;
    }
    const coach = this.coach();
    this.busy.set(true);
    this.error.set(null);
    this.refused.set({});
    try {
      await this.csrf.refresh();
      const added = await firstValueFrom(
        this.api.addLine(coach.userId, coach.tenantId, this.what().trim(), this.shownOn()),
      );
      this.closed.emit(added);
    } catch (error) {
      const refusal = certificateRefusal(error, $localize`The line couldn’t be added. Try again.`);
      this.refused.set(refusal.fields);
      this.error.set(refusal.message);
      if (Object.keys(refusal.fields).length > 0) focusFirstProblem(this.host, this.injector);
    } finally {
      this.busy.set(false);
    }
  }

  private forget(field: CertificateField): void {
    if (!this.refused()[field]) return;
    this.refused.update((refused) => {
      const left = { ...refused };
      delete left[field];
      return left;
    });
  }
}

// ------------------------------------------------------------------------------------------------

@Component({
  selector: 'app-platform-coach-confirm',
  imports: [Button, Control, Field, ModalFooter],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './platform-coach-confirm.html',
  styles: SHEET_STYLES,
})
export class PlatformCoachConfirm {
  private readonly api = inject(PlatformCoachesApi);
  private readonly csrf = inject(CsrfService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly coach = input.required<CertificateSpace>();
  /** The waiting line to confirm, at the version the page read. */
  readonly line = input.required<CertificateLine>();
  /** The signed-in admin's own name: one press for the person who did the confirming. */
  readonly prefill = input('');
  /** The confirmed line, or false when the sheet was closed without confirming. */
  readonly closed = output<CertificateLine | false>();
  readonly dirtyChange = output<boolean>();
  /** True while the save runs: the page keeps the sheet open until its answer lands. */
  readonly busyChange = output<boolean>();

  protected readonly attempt = new FormAttempt();
  protected readonly formId = modalFormId('platform-coach-confirm');
  protected readonly nameLabel = $localize`Who confirmed it with the coach?`;

  protected readonly confirmedByName = linkedSignal(() => this.prefill());
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly refused = signal<CertificateFieldErrors>({});

  protected readonly errors = computed(() =>
    confirmLineErrors({ confirmedByName: this.confirmedByName() }),
  );
  protected readonly problemCount = computed(() => Object.keys(this.errors()).length);

  constructor() {
    effect(() => this.dirtyChange.emit(this.confirmedByName().trim() !== this.prefill().trim()));
    effect(() => this.busyChange.emit(this.busy()));
  }

  protected setName(value: string): void {
    this.confirmedByName.set(value);
    if (this.refused().confirmedByName) this.refused.set({});
  }

  protected errorsFor(field: CertificateField): readonly string[] | null {
    const local = this.errors()[field] ?? [];
    if (this.attempt.shows(field, local)) return local;
    return this.refused()[field] ?? null;
  }

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    if (this.problemCount() > 0) {
      this.attempt.attempt();
      focusFirstProblem(this.host, this.injector);
      return;
    }
    const coach = this.coach();
    const line = this.line();
    this.busy.set(true);
    this.error.set(null);
    this.refused.set({});
    try {
      await this.csrf.refresh();
      const confirmed = await firstValueFrom(
        this.api.confirmLine(
          coach.userId,
          coach.tenantId,
          line.id,
          this.confirmedByName().trim(),
          line.version,
        ),
      );
      this.closed.emit(confirmed);
    } catch (error) {
      const refusal = certificateRefusal(
        error,
        $localize`The line couldn’t be marked confirmed. Try again.`,
      );
      this.refused.set(refusal.fields);
      this.error.set(refusal.message);
      if (Object.keys(refusal.fields).length > 0) focusFirstProblem(this.host, this.injector);
    } finally {
      this.busy.set(false);
    }
  }
}

// ------------------------------------------------------------------------------------------------

@Component({
  selector: 'app-platform-coach-erase',
  imports: [Button, DateField, ModalFooter, UiConfirm],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './platform-coach-erase.html',
  styles: SHEET_STYLES,
})
export class PlatformCoachErase {
  private readonly api = inject(PlatformCoachesApi);
  private readonly csrf = inject(CsrfService);
  private readonly dialogs = inject(UiDialog);
  private readonly locale = inject(LOCALE_ID);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly confirmTemplate = viewChild.required<TemplateRef<unknown>>('confirmDialog');
  private question: { close(): void } | null = null;

  readonly coach = input.required<CertificateSpace>();
  /** What the erasure did, in counts, or false when the sheet was closed without erasing. */
  readonly closed = output<CertificateErasure | false>();
  readonly dirtyChange = output<boolean>();
  /** True while the save runs: the page keeps the sheet open until its answer lands. */
  readonly busyChange = output<boolean>();

  protected readonly attempt = new FormAttempt();
  protected readonly formId = modalFormId('platform-coach-erase');
  protected readonly earliest = CERTIFICATE_EARLIEST_DAY;
  protected readonly askedLabel = $localize`The day the coach asked`;
  protected readonly confirmMessage = $localize`The words are gone for good; the dates and who acted stay.`;
  protected readonly confirmLabel = $localize`Erase`;
  protected readonly keepLabel = $localize`Keep`;

  /** The space's today to start with, never the device's. */
  protected readonly requestedOn = linkedSignal(() => this.coach().spaceToday);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly refused = signal<CertificateFieldErrors>({});

  protected readonly deadline = computed(() => deadlineSentence(this.requestedOn(), this.locale));
  protected readonly errors = computed(() =>
    eraseErrors({ requestedOn: this.requestedOn() }, this.coach().spaceToday),
  );
  protected readonly problemCount = computed(() => Object.keys(this.errors()).length);

  constructor() {
    effect(() => this.dirtyChange.emit(this.requestedOn() !== this.coach().spaceToday));
    effect(() => this.busyChange.emit(this.busy()));
    // The question goes with the sheet, should the sheet go first.
    inject(DestroyRef).onDestroy(() => this.question?.close());
  }

  protected setRequestedOn(value: string): void {
    this.requestedOn.set(value);
    if (this.refused().requestedOn) this.refused.set({});
  }

  protected errorsFor(field: CertificateField): readonly string[] | null {
    const local = this.errors()[field] ?? [];
    if (this.attempt.shows(field, local)) return local;
    return this.refused()[field] ?? null;
  }

  /** Asks first; only Erase sends. */
  protected async submit(): Promise<void> {
    if (this.busy() || this.question) return;
    if (this.problemCount() > 0) {
      this.attempt.attempt();
      focusFirstProblem(this.host, this.injector);
      return;
    }
    if (!(await this.ask())) return;
    const coach = this.coach();
    this.busy.set(true);
    this.error.set(null);
    this.refused.set({});
    try {
      await this.csrf.refresh();
      const erasure = await firstValueFrom(
        this.api.erase(coach.userId, coach.tenantId, this.requestedOn()),
      );
      this.closed.emit(erasure);
    } catch (error) {
      const refusal = certificateRefusal(
        error,
        $localize`The lines couldn’t be erased. Try again.`,
      );
      this.refused.set(refusal.fields);
      this.error.set(refusal.message);
      if (Object.keys(refusal.fields).length > 0) focusFirstProblem(this.host, this.injector);
    } finally {
      this.busy.set(false);
    }
  }

  private async ask(): Promise<boolean> {
    const dialog = this.dialogs.open<boolean>(this.confirmTemplate(), {
      title: $localize`Erase every line of this coach in this space?`,
      closeLabel: $localize`Close`,
    });
    this.question = dialog;
    const answer = await firstValueFrom(dialog.closed);
    this.question = null;
    return answer === true;
  }
}
