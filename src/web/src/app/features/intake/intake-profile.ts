import { protectSheetEdits } from '../../core/forms/sheet-exit-protection';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  LOCALE_ID,
  signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { BodyweightUnit, ClientIntakeProfile } from '../../core/api/api.models';
import { Button } from '../../ui/button';
import type { IsoDate } from '../../ui/calendar';
import { UiConfirm } from '../../ui/confirm';
import { UiDialog } from '../../ui/dialog';
import { UiSheet } from '../../ui/sheet';
import { UiToast } from '../../ui/toast';
import { IntakeEdit } from './intake-edit';
import {
  answerRows,
  groupTitle,
  INTAKE_GROUPS,
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
export class IntakeProfile {
  private readonly locale = inject(LOCALE_ID);
  private readonly sheets = inject(UiSheet);
  private readonly dialogs = inject(UiDialog);
  private leaveDecision: Promise<boolean> | null = null;
  private activeConfirm: { close(): void } | null = null;
  private readonly toast = inject(UiToast);
  private readonly editSheet = viewChild.required<TemplateRef<unknown>>('editSheet');
  private readonly confirmDialog = viewChild.required<TemplateRef<unknown>>('confirmDialog');
  private openSheet: { close: () => void } | null = null;
  private sheetDirty = false;

  readonly profile = input.required<ClientIntakeProfile>();
  readonly saver = input.required<IntakeSaver>();
  readonly subject = input<IntakeSubject>({ kind: 'self' });
  /** Today in the coaching space, for the adult rule and the weighing day. */
  readonly today = input.required<IsoDate>();
  readonly firstDay = input<number | null>(null);
  readonly weightUnit = input<BodyweightUnit>('Kilogram');
  /** False for a former client, whose record is read and not changed (ADR 0027). */
  readonly editable = input(true);

  protected readonly groups = INTAKE_GROUPS;
  protected readonly closeLabel = $localize`Close`;
  protected readonly notAdded = $localize`Not added`;
  protected readonly editing = signal<IntakeStepId>('about');
  protected readonly asking = signal<{ message: string; confirm: string; cancel: string } | null>(
    null,
  );

  protected readonly rows = computed<Record<IntakeGroup, AnswerRow[]>>(() => {
    const profile = this.profile();
    return {
      about: answerRows(profile, 'about', this.locale),
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

  async canLeave(): Promise<boolean> {
    const allowed = await this.canCloseSheet();
    if (allowed) this.sheetDirty = false;
    return allowed;
  }

  constructor() {
    protectSheetEdits(
      this,
      () => this.sheetDirty,
      () => {
        this.openSheet?.close();
        this.activeConfirm?.close();
      },
    );
    inject(DestroyRef).onDestroy(() => this.openSheet?.close());
  }

  protected titleOf(step: IntakeStepId): string {
    return groupTitle(step, this.subject());
  }

  protected edit(step: IntakeStepId): void {
    this.editing.set(step);
    this.sheetDirty = false;
    this.openSheet?.close();
    const sheet = this.sheets.open<boolean>(this.editSheet(), {
      title: this.titleOf(step),
      closeLabel: this.closeLabel,
      closeOnNavigation: false,
      canClose: () => this.canCloseSheet(),
    });
    this.openSheet = sheet;
    sheet.closed.subscribe((saved) => {
      if (this.openSheet === sheet) {
        this.openSheet = null;
        this.sheetDirty = false;
      }
      if (saved) this.toast.show(this.savedText(step), { tone: 'success' });
    });
  }

  protected setDirty(dirty: boolean): void {
    this.sheetDirty = dirty;
  }

  /** The close button, Escape, the backdrop and Not now all ask the same question. */
  private canCloseSheet(): boolean | Promise<boolean> {
    return (
      !this.sheetDirty ||
      this.ask(
        $localize`Close without saving? What you typed will be lost.`,
        $localize`Close`,
        $localize`Keep editing`,
        $localize`Discard what you typed?`,
      )
    );
  }

  /** The sheet's own buttons: Save changes closes it for good, Not now asks first when needed. */
  protected async closeSheet(
    saved: boolean,
    sheet: { close(result: boolean): void },
  ): Promise<void> {
    if (saved || (await this.canCloseSheet())) sheet.close(saved);
  }

  private savedText(step: IntakeStepId): string {
    const subject = this.subject();
    if (subject.kind === 'self') return $localize`Your details were saved.`;
    const name = subject.name;
    return step === 'start'
      ? $localize`${name}:name: has finished setting up.`
      : $localize`${name}:name:’s details were saved.`;
  }

  private async ask(
    message: string,
    confirm: string,
    cancel: string,
    title: string,
  ): Promise<boolean> {
    if (this.leaveDecision) return this.leaveDecision;
    this.asking.set({ message, confirm, cancel });
    const dialog = this.dialogs.open<boolean>(this.confirmDialog(), {
      closeOnNavigation: false,
      title,
      closeLabel: this.closeLabel,
    });
    this.activeConfirm = dialog;
    this.leaveDecision = firstValueFrom(dialog.closed).then((answer) => answer === true);
    const answer = await this.leaveDecision;
    this.leaveDecision = null;
    this.activeConfirm = null;
    this.asking.set(null);
    return answer === true;
  }
}
