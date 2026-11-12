import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  LOCALE_ID,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { apiErrorMessage } from '../../core/api/api-error';
import { FormAttempt } from '../../core/forms/form-attempt';
import { CsrfService } from '../../core/security/csrf.service';
import { Button } from '../../ui/button';
import { DateField } from '../../ui/date-field';
import { Control, Field } from '../../ui/field';
import { Icon } from '../../ui/icon';
import { ModalFooter, modalFormId } from '../../ui/modal-footer';
import { formatDay } from '../billing/billing.models';
import {
  markGuaranteeSentence,
  markSeatSentence,
  markTermsSentence,
  type FoundingTerms,
} from '../billing/founding.models';
import { PlatformFoundingApi } from './platform-founding-api';
import {
  endErrors,
  endPresets,
  FOUNDING_EARLIEST_DAY,
  markErrors,
  termsChanges,
  termsEntryFrom,
  termsErrors,
  termsFields,
  toPublishTermsRequest,
  type TermsField,
  type TermsKey,
} from './platform-founding.models';
import { CHANGES_STYLES, focusFirstProblem, PRESET_STYLES, SHEET_STYLES } from './platform-sheets';

/**
 * The platform admin's three founding writes, each in a sheet (notes plan N3b, PBL-009): mark a
 * coaching space as founding, end its founding status for cause, and publish the badge's terms. Like
 * the billing sheets they ask only for what the server needs, keep a refusal on screen in the
 * server's own words, and tell the page when they hold typed work. The server records every mark and
 * end, counts the clients and the months, and decides the badge; nothing is decided here. Their
 * templates are files of their own, so the words test reads them as they are.
 */

@Component({
  selector: 'app-platform-founding-mark',
  imports: [Button, Control, DateField, Field, ModalFooter],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './platform-founding-mark.html',
  styles: SHEET_STYLES,
})
export class PlatformFoundingMark {
  private readonly api = inject(PlatformFoundingApi);
  private readonly csrf = inject(CsrfService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly tenantId = input.required<string>();
  readonly spaceName = input.required<string>();
  /** Today in UTC, the latest founding day the server takes. */
  readonly today = input.required<string>();
  /** The terms in force, for the sentence; null when they could not be read. */
  readonly terms = input<FoundingTerms | null>(null);
  /** The clients the price plan in force includes with a seat (notes plan N11b); null when unknown. */
  readonly planSeatClients = input<number | null>(null);
  /** True when the space was marked. */
  readonly closed = output<boolean>();
  readonly dirtyChange = output<boolean>();

  protected readonly attempt = new FormAttempt();
  protected readonly formId = modalFormId('platform-founding-mark');
  protected readonly earliest = FOUNDING_EARLIEST_DAY;
  protected readonly sinceLabel = $localize`Founding since`;
  protected readonly sinceHelp = $localize`Today or an earlier day. Days are UTC, like billing’s.`;
  protected readonly noteLabel = $localize`What it is for`;
  protected readonly noteHelp = $localize`Only TB Gym’s admin sees it.`;

  protected readonly foundingSince = linkedSignal(() => this.today());
  protected readonly note = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  /**
   * The terms in force in a sentence, then the discount's place and how long the space keeps its plan
   * version (notes plan N8); every number is the server's.
   */
  protected readonly notice = computed(() => {
    const terms = this.terms();
    return [
      terms
        ? markTermsSentence(terms.clientsWithActivePlan, terms.monthsSinceStart)
        : $localize`The badge is earned under the terms in force.`,
      $localize`The discount is separate: grant it on this page too.`,
      markGuaranteeSentence(terms),
    ].join(' ');
  });
  /** What marking changes: no access, and the owner's seat while it stays founding (notes plan N11b). */
  protected readonly seatSentence = computed(() =>
    markSeatSentence(this.terms(), this.planSeatClients()),
  );
  protected readonly errors = computed(() =>
    markErrors({ foundingSince: this.foundingSince(), note: this.note() }, this.today()),
  );
  protected readonly problemCount = computed(() => Object.keys(this.errors()).length);

  constructor() {
    effect(() =>
      this.dirtyChange.emit(this.note().trim() !== '' || this.foundingSince() !== this.today()),
    );
  }

  protected shows(field: string): boolean {
    return this.attempt.shows(field, this.errors()[field] ?? []);
  }

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    if (this.problemCount() > 0) {
      this.attempt.attempt();
      focusFirstProblem(this.host, this.injector);
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.csrf.refresh();
      await firstValueFrom(
        this.api.markFounding(this.tenantId(), this.foundingSince(), this.note().trim()),
      );
      this.closed.emit(true);
    } catch (error) {
      this.error.set(
        apiErrorMessage(error, $localize`The space could not be marked as founding. Try again.`),
      );
    } finally {
      this.busy.set(false);
    }
  }
}

// ------------------------------------------------------------------------------------------------

@Component({
  selector: 'app-platform-founding-end',
  imports: [Button, Control, Field, ModalFooter],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './platform-founding-end.html',
  styles: SHEET_STYLES + PRESET_STYLES,
})
export class PlatformFoundingEnd {
  private readonly api = inject(PlatformFoundingApi);
  private readonly csrf = inject(CsrfService);
  private readonly locale = inject(LOCALE_ID);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  /** The open founding status to end. */
  readonly foundingId = input.required<string>();
  readonly spaceName = input.required<string>();
  /** The day the space became founding, as the admin marked it. */
  readonly foundingSince = input.required<string>();
  /** True when the status ended. */
  readonly closed = output<boolean>();
  readonly dirtyChange = output<boolean>();

  protected readonly attempt = new FormAttempt();
  protected readonly formId = modalFormId('platform-founding-end');
  protected readonly reasonLabel = $localize`Why?`;
  protected readonly reasonHelp = $localize`Kept on record. Only TB Gym’s admin sees it.`;
  protected readonly presetsLabel = $localize`Fill in a common cause`;
  protected readonly presets = endPresets();

  protected readonly reason = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly since = computed(() => formatDay(this.foundingSince(), this.locale));
  protected readonly errors = computed(() => endErrors({ reason: this.reason() }));
  protected readonly problemCount = computed(() => Object.keys(this.errors()).length);

  constructor() {
    effect(() => this.dirtyChange.emit(this.reason().trim() !== ''));
  }

  /** A cause fills the box as its words, ready for more; the admin may still change it. */
  protected usePreset(preset: string): void {
    this.reason.set(preset);
    this.attempt.touch('reason');
    afterNextRender(
      () => {
        const box = this.host.nativeElement.querySelector<HTMLTextAreaElement>('textarea');
        box?.focus();
        box?.setSelectionRange(box.value.length, box.value.length);
      },
      { injector: this.injector },
    );
  }

  protected shows(field: string): boolean {
    return this.attempt.shows(field, this.errors()[field] ?? []);
  }

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    if (this.problemCount() > 0) {
      this.attempt.attempt();
      focusFirstProblem(this.host, this.injector);
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.csrf.refresh();
      await firstValueFrom(this.api.endFounding(this.foundingId(), this.reason().trim()));
      this.closed.emit(true);
    } catch (error) {
      this.error.set(
        apiErrorMessage(error, $localize`The founding status could not be ended. Try again.`),
      );
    } finally {
      this.busy.set(false);
    }
  }
}

// ------------------------------------------------------------------------------------------------

@Component({
  selector: 'app-platform-founding-terms',
  imports: [Button, Control, Field, Icon, ModalFooter],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './platform-founding-terms.html',
  styles: SHEET_STYLES + CHANGES_STYLES,
})
export class PlatformFoundingTerms {
  private readonly api = inject(PlatformFoundingApi);
  private readonly csrf = inject(CsrfService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly current = input.required<FoundingTerms>();
  /** The clients the price plan in force includes with a seat, for the founding seat's help. */
  readonly planSeatClients = input<number | null>(null);
  /** The version that was published, or false when the sheet was closed without publishing. */
  readonly closed = output<FoundingTerms | false>();
  readonly dirtyChange = output<boolean>();

  protected readonly attempt = new FormAttempt();
  protected readonly formId = modalFormId('platform-founding-terms');
  protected readonly fields = computed(() => termsFields(this.planSeatClients()));
  protected readonly entry = linkedSignal(() => termsEntryFrom(this.current()));
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  /** Boxes the browser could not read: marked, never sent as none (the founding seat's, N11b). */
  private readonly unreadable = signal<ReadonlySet<TermsKey>>(new Set());
  protected readonly errors = computed(() => {
    const errors = termsErrors(this.entry());
    for (const field of termsFields()) {
      if (this.unreadable().has(field.key) && field.range) errors[field.key] = [field.range];
    }
    return errors;
  });
  protected readonly problemCount = computed(() => Object.keys(this.errors()).length);
  /** What differs from the version in force, leaving out a number that is not valid yet. */
  protected readonly changes = computed(() =>
    termsChanges(this.current(), this.entry()).filter((change) => !this.errors()[change.key]),
  );

  constructor() {
    effect(() =>
      this.dirtyChange.emit(
        this.changes().length > 0 || this.problemCount() > 0 || this.entry().note.trim() !== '',
      ),
    );
  }

  /**
   * An empty box is none for the founding seat's number, which allows it (notes plan N11b); a box the
   * browser cannot read is never none, so it is marked rather than published as none.
   */
  protected setNumber(field: TermsField, box: HTMLInputElement): void {
    const value = box.valueAsNumber;
    // A box that allows none and that the browser cannot read keeps its entry as it was, so what
    // was typed stays in sight under its error instead of being cleared and sent as none.
    const unreadable = !Number.isFinite(value) && field.missing === null && box.validity.badInput;
    this.unreadable.update((keys) => {
      const next = new Set(keys);
      if (unreadable) next.add(field.key);
      else next.delete(field.key);
      return next;
    });
    if (unreadable) return;
    this.entry.update((entry) => ({
      ...entry,
      [field.key]: Number.isFinite(value) ? value : null,
    }));
  }

  protected setNote(note: string): void {
    this.entry.update((entry) => ({ ...entry, note }));
  }

  protected shows(field: string): boolean {
    return this.attempt.shows(field, this.errors()[field] ?? []);
  }

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    if (this.problemCount() > 0) {
      this.attempt.attempt();
      focusFirstProblem(this.host, this.injector);
      return;
    }
    if (this.changes().length === 0) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.csrf.refresh();
      const published = await firstValueFrom(
        this.api.publishFoundingTerms(toPublishTermsRequest(this.entry(), this.current())),
      );
      this.closed.emit(published);
    } catch (error) {
      this.error.set(
        apiErrorMessage(error, $localize`The badge’s terms could not be published. Try again.`),
      );
    } finally {
      this.busy.set(false);
    }
  }
}
