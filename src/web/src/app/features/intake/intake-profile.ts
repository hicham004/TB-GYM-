import { DOCUMENT } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  Injector,
  input,
  LOCALE_ID,
  signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import type { BodyweightUnit, ClientIntakeProfile } from '../../core/api/api.models';
import { GuardedSheets, type Closable } from '../../core/forms/guarded-sheets';
import { Button } from '../../ui/button';
import type { IsoDate } from '../../ui/calendar';
import { UiConfirm } from '../../ui/confirm';
import { IntakeEdit } from './intake-edit';
import {
  answerRows,
  groupTitle,
  healthClosedNote,
  healthOpen,
  intakeGroups,
  listWords,
  missingForSetup,
  setupItemLabel,
  type AnswerRow,
  type IntakeGroup,
  type IntakeSaver,
  type IntakeStepId,
  type IntakeSubject,
} from './intake.models';

/**
 * A finished profile as cards of answers (R5.3b), one per group, each with an Edit that opens that
 * group's boxes in a sheet. The client reads it as My profile and the coach as the client's intake, so
 * both see the same words in the same order. Nothing here saves by itself: the page's `saver` does,
 * and the sheet asks before it closes with typed work in it.
 */
@Component({
  selector: 'app-intake-profile',
  imports: [Button, IntakeEdit, UiConfirm],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './intake-profile.html',
  styleUrl: './intake-profile.scss',
})
export class IntakeProfile extends GuardedSheets {
  private readonly locale = inject(LOCALE_ID);
  private readonly document = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly editSheet = viewChild.required<TemplateRef<unknown>>('editSheet');
  private readonly confirmTemplate = viewChild.required<TemplateRef<unknown>>('confirmDialog');

  readonly profile = input.required<ClientIntakeProfile>();
  readonly saver = input.required<IntakeSaver>();
  readonly subject = input<IntakeSubject>({ kind: 'self' });
  /** Today in the coaching space, for the adult rule and the weighing day. */
  readonly today = input.required<IsoDate>();
  readonly firstDay = input<number | null>(null);
  readonly weightUnit = input<BodyweightUnit>('Kilogram');
  /** False for a former client, whose record is read and not changed (ADR 0027). */
  readonly editable = input(true);
  /** The coaching space's name, for the health sheet's line on who sees the answers (CLIENT-18). */
  readonly spaceName = input('');

  /**
   * The cards. While the profile's Health step is closed (a trainee of TB Gym's own space off Max, N9c5a),
   * its card is left out with nothing saved, and read with no Edit when answers are.
   */
  protected readonly groups = computed(() => intakeGroups(this.profile()));
  protected readonly healthOpen = computed(() => healthOpen(this.profile()));
  protected readonly closedNote = healthClosedNote();
  protected readonly notAdded = $localize`Not added`;
  protected readonly editing = signal<IntakeStepId>('about');

  protected readonly rows = computed<Record<IntakeGroup, AnswerRow[]>>(() => {
    const profile = this.profile();
    return {
      about: answerRows(profile, 'about', this.locale, this.today()),
      goal: answerRows(profile, 'goal', this.locale),
      life: answerRows(profile, 'life', this.locale),
      health: answerRows(profile, 'health', this.locale),
    };
  });

  /** Only a coach reads a profile that is not finished; the client is still in the steps then. */
  protected readonly setup = computed(() => {
    const subject = this.subject();
    if (subject.kind !== 'client') return null;
    const missing = missingForSetup(this.profile());
    if (missing.length === 0) return null;
    const name = subject.name;
    const ready = missing.every((item) => item === 'weight');
    const list = listWords(missing.map(setupItemLabel), this.locale);
    return {
      ready,
      text: ready
        ? $localize`${name}:name: has not finished setting up. Their starting weight is the last thing needed.`
        : $localize`${name}:name: has not finished setting up. Still needed: ${list}:list:. Add what you know with Edit below.`,
    };
  });

  protected confirmDialog(): TemplateRef<unknown> {
    return this.confirmTemplate();
  }

  protected titleOf(step: IntakeStepId): string {
    return groupTitle(step, this.subject());
  }

  protected edit(step: IntakeStepId): void {
    this.editing.set(step);
    this.show(this.editSheet(), this.titleOf(step)).closed.subscribe(() => this.keepFocus(step));
  }

  /**
   * A closed sheet gives focus back to the Edit that opened it. A Health step closing while its sheet was
   * open (N9c5a) takes that Edit away, or the whole card when nothing is saved, and focus would fall to the
   * page's body: it goes to the card's heading then, or to the first card's when that card is gone.
   */
  private keepFocus(step: IntakeStepId): void {
    if (this.destroyRef.destroyed) return;
    afterNextRender(
      () => {
        const active = this.document.activeElement;
        if (active && active !== this.document.body && active.isConnected) return;
        const host = this.host.nativeElement;
        const heading =
          host.querySelector<HTMLElement>(`#intake-${step}`) ??
          host.querySelector<HTMLElement>('.panel-head h2');
        heading?.focus({ preventScroll: true });
      },
      { injector: this.injector },
    );
  }

  /** The sheet's own buttons: Save changes closes it for good, Not now asks first when needed. */
  protected closeSheet(saved: boolean, sheet: Closable): void {
    if (saved) this.done(sheet, this.savedText(this.editing()));
    else void this.closeAsking(sheet);
  }

  private savedText(step: IntakeStepId): string {
    const subject = this.subject();
    if (subject.kind === 'self') return $localize`Your details were saved.`;
    const name = subject.name;
    return step === 'start'
      ? $localize`${name}:name: has finished setting up.`
      : $localize`${name}:name:’s details were saved.`;
  }
}
