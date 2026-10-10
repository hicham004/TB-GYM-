import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import {
  formulaName,
  inputsLine,
  macroShares,
  signedKcal,
  warningWords,
  type WorkedOut,
} from './client-nutrition.models';

/**
 * One set of worked-out targets, told the way a coach thinks about them (R5.3d): the calories, the
 * three macros as grams and as a share of the calories, and the steps between what the body burns and
 * the target, so the number can be defended to the client. The server worked every figure out; this
 * only shows them, rounded to whole numbers, and says what it was worked out from.
 */
@Component({
  selector: 'app-targets-result',
  imports: [DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './targets-result.html',
  styleUrl: './targets-result.scss',
})
export class TargetsResult {
  readonly record = input.required<WorkedOut>();

  protected readonly shares = computed(() => macroShares(this.record()));
  protected readonly adjustment = computed(() => signedKcal(this.record().goalAdjustment));
  protected readonly formula = computed(() => formulaName(this.record().formula));
  protected readonly flags = computed(() => this.record().warnings.map(warningWords));
  protected readonly from = computed(() => {
    const inputs = this.record().inputs;
    return inputs ? inputsLine(inputs) : null;
  });
}
