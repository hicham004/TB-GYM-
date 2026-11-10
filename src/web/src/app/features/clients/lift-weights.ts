import { HttpErrorResponse } from '@angular/common/http';
import { inject, Injector } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  ApplyLiftWeightsRequest,
  LiftStandingView,
  LiftWeightsAppliedView,
  SetStanding,
} from '../../core/api/generated';
import { houseDay } from '../../core/i18n/house-dates';
import { CsrfService } from '../../core/security/csrf.service';
import { IntentIdempotencyKey } from '../training/training-assignment-state';
import { amount, daysBetween, unitWord } from '../training/standing-words';
import { ClientProgramApi } from './client-program-api';
import { programWriteError } from './client-program-forms.models';

/**
 * Applying a weight (notes plan N6c, STR-020; decision 21: the coach applies, never the app or the client). The
 * server works nothing out here: it judges the lift again and writes only what its answer still says, so the
 * request names, per lift, the sets the answer moves with the weights the coach read.
 */

type Quantity = number | string | null | undefined;

const number = (value: Quantity): number | null =>
  value === null || value === undefined || value === '' ? null : Number(value);

/**
 * The sets applying an answer writes, as the server picks them: each set it moves to a weight the set does not
 * have yet, last time's weight plus its step or last time's weight kept (line d). None for a hold that keeps
 * every set's own weight, or once applied.
 */
export function setsToApply(view: LiftStandingView): SetStanding[] {
  return view.standing.sets
    .filter(
      (set) =>
        (set.move === 'StepUp' || set.move === 'SameAsLastTime') &&
        (number(set.weight) ?? 0) > 0 &&
        number(set.weight) !== number(set.currentWeight),
    )
    .sort((a, b) => Number(a.setNumber) - Number(b.setNumber));
}

export function canApply(view: LiftStandingView): boolean {
  return setsToApply(view).length > 0;
}

/** One request for the given lifts, each with the sets it moves and the weights the coach's read gave them. */
export function applyRequest(
  views: readonly LiftStandingView[],
  idempotencyKey: string,
): ApplyLiftWeightsRequest {
  return {
    idempotencyKey,
    lifts: views.map((view) => ({
      exercisePrescriptionId: view.exercisePrescriptionId,
      sets: setsToApply(view).map((set) => ({
        setPrescriptionId: set.setPrescriptionId,
        currentWeight: set.currentWeight,
        weight: set.weight as number | string,
      })),
    })),
  };
}

/** "17 kg" when every set goes to it, else the lightest and heaviest: "22.5–25 kg". */
function newWeights(view: LiftStandingView, locale: string): string {
  const sets = setsToApply(view);
  const unit = unitWord(sets[0]?.unit);
  const values = sets.map((set) => number(set.weight) ?? 0);
  const low = Math.min(...values);
  const high = Math.max(...values);
  return low === high
    ? `${amount(low, locale)} ${unit}`
    : `${amount(low, locale)}–${amount(high, locale)} ${unit}`;
}

/** The workout the weight goes to: "today", "tomorrow", "Mon 17 Nov". */
export function sessionDay(view: LiftStandingView, locale: string): string {
  const ahead = daysBetween(view.standing.judgedOn, view.sessionDate);
  if (ahead === 0) return $localize`today`;
  if (ahead === 1) return $localize`tomorrow`;
  return houseDay(view.sessionDate, locale, view.standing.judgedOn);
}

/** The button: "Apply 17 kg", "Apply 22.5–25 kg". */
export function applyLabel(view: LiftStandingView, locale: string): string {
  return $localize`Apply ${newWeights(view, locale)}:weight:`;
}

/** The button's whole name, as a screen reader says it: "Apply 17 kg to Seated Leg Curl, Lower A on Mon 17 Nov". */
export function applyName(view: LiftStandingView, locale: string): string {
  return $localize`Apply ${newWeights(view, locale)}:weight: to ${view.exerciseName}:lift:, ${view.sessionName}:session: ${onSession(view, locale)}:day:`;
}

function onSession(view: LiftStandingView, locale: string): string {
  const day = sessionDay(view, locale);
  const ahead = daysBetween(view.standing.judgedOn, view.sessionDate);
  return ahead === 0 || ahead === 1 ? day : $localize`on ${day}:day:`;
}

/** Where the lift's next workout is: "Lower A · Mon 17 Nov". */
export function sessionWhere(view: LiftStandingView, locale: string): string {
  return `${view.sessionName} · ${sessionDay(view, locale)}`;
}

/** What an apply did, for the page or the sheet to say: one lift by name, several by count. */
export function appliedNotice(
  applied: LiftWeightsAppliedView,
  views: readonly LiftStandingView[],
  firstName: string,
  locale: string,
): string {
  if (applied.lifts.length === 1) {
    const lift = applied.lifts[0];
    const view = views.find((item) => item.exercisePrescriptionId === lift.exercisePrescriptionId);
    if (view) {
      return $localize`${lift.exerciseName}:lift: is now ${newWeights(view, locale)}:weight: ${onSession(view, locale)}:day:. ${firstName}:name: sees it on that workout.`;
    }
  }
  return $localize`${applied.lifts.length}:count: weights applied. ${firstName}:name: sees each on its workout.`;
}

/**
 * What the Training tab says when Review weights (notes plan N6d) brings the coach to a panel that has gone:
 * everything was applied, started or held meanwhile.
 */
export function nothingToApplyNotice(firstName: string): string {
  return $localize`Nothing is left to apply for ${firstName}:name: now.`;
}

/**
 * An apply's refusal in a coach's words. The page reads the lifts again on a conflict, so the words say so; a
 * closed training read (TRN-023) answers 403 without a code.
 */
export function applyError(error: unknown, firstName: string): string {
  const code =
    error instanceof HttpErrorResponse
      ? ((error.error as { code?: string } | null | undefined)?.code ?? null)
      : null;
  if (code === 'lift_standing_changed' || code === 'concurrency_conflict') {
    return $localize`Where a lift stands changed since this was read. It has been read again: check it, then apply.`;
  }
  if (code === 'idempotency_conflict') {
    return $localize`That apply clashed with another one. It has been read again: check it, then apply.`;
  }
  if (error instanceof HttpErrorResponse && error.status === 403 && !code) {
    return $localize`${firstName}:name:’s training isn’t open now, so the weights stay as they are.`;
  }
  return programWriteError(error, $localize`The weight could not be applied.`, firstName);
}

/**
 * One client's applies from a component: the idempotency key is bound to the request, so a retry after a lost
 * answer is the same request and the server answers with the first result (AGENTS.md); a new request gets a new
 * key. Made in a component's field, where `inject` works; the API is reached only on the first apply, so a
 * screen that never applies never loads it.
 */
export class LiftWeightApplier {
  private readonly injector = inject(Injector);
  private readonly intent = new IntentIdempotencyKey();

  async apply(
    clientId: string,
    views: readonly LiftStandingView[],
  ): Promise<LiftWeightsAppliedView> {
    const key = this.intent.forPayload({ clientId, lifts: applyRequest(views, '').lifts });
    await this.injector.get(CsrfService).refresh();
    const applied = await firstValueFrom(
      this.injector.get(ClientProgramApi).applyLiftWeights(clientId, applyRequest(views, key)),
    );
    this.intent.complete();
    return applied;
  }
}
