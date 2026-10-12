import { ChangeDetectionStrategy, Component, inject, TemplateRef, viewChild } from '@angular/core';
import { Button } from '../../ui/button';
import { Icon } from '../../ui/icon';
import { UiSheet } from '../../ui/sheet';
import { BeforeAfterSheet } from './before-after-sheet';

/**
 * Where a client starts a before-and-after (R6.1b): on Progress's photos and on the Photos of Your
 * entries, once a pose has photos on two days. The sheet it opens reads every photo afresh.
 */
@Component({
  selector: 'app-before-after-button',
  imports: [BeforeAfterSheet, Button, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button appButton type="button" variant="outlined" (click)="open()" data-before-after>
      <app-icon name="share" /><ng-container i18n>Share a before and after</ng-container>
    </button>

    <ng-template #sheet>
      <app-before-after-sheet />
    </ng-template>
  `,
  styles: `
    :host {
      display: contents;
    }
  `,
})
export class BeforeAfterButton {
  private readonly sheets = inject(UiSheet);
  private readonly sheet = viewChild.required<TemplateRef<unknown>>('sheet');

  protected open(): void {
    this.sheets.open(this.sheet(), {
      title: $localize`Before and after`,
      closeLabel: $localize`Close`,
    });
  }
}
