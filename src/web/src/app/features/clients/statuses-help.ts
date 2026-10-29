import type { DialogRef } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  TemplateRef,
  viewChild,
} from '@angular/core';
import { Button } from '../../ui/button';
import type { ModalSurface } from '../../ui/modal-surface';
import { UiSheet } from '../../ui/sheet';
import { StatusPill } from '../../ui/status-pill';
import { Tag } from '../../ui/tag';
import { DayMarkView } from './day-mark';

/**
 * "How these statuses work" (critique B4a), beside the Clients chips and under Today's Needs you: what
 * each reason means and when it starts and clears, the plan's pills and the strip's marks, in the words
 * of the rules behind them. Coach attention v4 (CLI-018) with overdue check-ins v1 (CHK-015) and
 * training signals v1 (TRN-021); its numbers are theirs, so a change to a rule changes this text too.
 */
@Component({
  selector: 'app-statuses-help',
  imports: [Button, DayMarkView, StatusPill, Tag],
  templateUrl: './statuses-help.html',
  styleUrl: './statuses-help.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatusesHelp {
  private readonly sheets = inject(UiSheet);
  private readonly sheet = viewChild.required<TemplateRef<unknown>>('sheet');
  private opened: DialogRef<unknown, ModalSurface> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.opened?.close());
  }

  protected show(): void {
    this.opened?.close();
    const ref = this.sheets.open(this.sheet(), {
      title: $localize`How these statuses work`,
      closeLabel: $localize`Close`,
    });
    this.opened = ref;
    ref.closed.subscribe(() => {
      if (this.opened === ref) this.opened = null;
    });
  }
}
