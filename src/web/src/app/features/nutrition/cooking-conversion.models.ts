import { formatNumber } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import type {
  CookingConversionView,
  CookingFactorView,
  CreateCookingConversionRequest,
} from '../../core/api/generated';
import { apiErrorMessage } from '../../core/api/api-error';
import { numeric } from '../training/training-builder.models';

/**
 * Raw to cooked (NUT-001, audit INV-6): a coach weighs a raw food cooked ("150 g cooked rice") through a
 * conversion of their own, which says how much 100 g raw weighs once cooked and how much of its protein,
 * carbs and fat it keeps. The server holds it as a yield and a retention factor under one name and source,
 * applies yield first, then retention, and never changes one once saved; TB Gym seeds no numbers (ADR 0008).
 * These are the sheet's words, checks and requests, kept out of the components so they are tested alone.
 */

/** A conversion as the recipe editor uses it. */
export interface Conversion {
  readonly yieldId: string;
  readonly retentionId: string;
  /** Grams cooked per gram raw (rice and burghul near 3, chicken near 0.75). */
  readonly yield: number;
  /** The share of protein, carbs and fat kept, above 0 and at most 1. */
  readonly retention: number;
  /** What it is for, "White rice, boiled": the factors' source key. */
  readonly name: string;
  /** Where its numbers come from, "USDA cooking yields, 2014": the factors' source version. */
  readonly source: string;
}

export const MAX_CONVERSION_NAME = 200;
export const MAX_CONVERSION_SOURCE = 100;
/** The server's ceiling: 5 times the raw weight, so 500 g cooked from 100 g raw. */
export const MAX_COOKED_GRAMS = 500;

export function conversionFromFactors(
  yieldFactor: CookingFactorView,
  retention: CookingFactorView,
): Conversion {
  return {
    yieldId: yieldFactor.id,
    retentionId: retention.id,
    yield: numeric(yieldFactor.factor),
    retention: numeric(retention.factor),
    name: yieldFactor.sourceKey,
    source: yieldFactor.sourceVersion,
  };
}

export function conversionFromView(view: CookingConversionView): Conversion {
  return conversionFromFactors(view.yield, view.retention);
}

function grams(value: number, locale: string): string {
  return formatNumber(value, locale, '1.0-1');
}

/** "100 g raw makes 290 g cooked", and what it loses when it keeps less than all of it. */
export function conversionWords(conversion: Conversion, locale: string): string {
  const made = $localize`100 g raw makes ${grams(conversion.yield * 100, locale)}:cooked: g cooked`;
  if (conversion.retention >= 1) return made;
  const kept = formatNumber(conversion.retention * 100, locale, '1.0-1');
  return $localize`${made}:made:, keeping ${kept}:percent:% of its protein, carbs and fat`;
}

// ---------- adding one ----------

export interface ConversionForm {
  readonly name: string;
  /** What 100 g raw weighs once cooked, in grams. */
  readonly cooked: number | null;
  /** How much of its protein, carbs and fat is kept, in percent. */
  readonly kept: number | null;
  readonly source: string;
}

export type ConversionField = keyof ConversionForm;

export function emptyConversionForm(): ConversionForm {
  return { name: '', cooked: null, kept: 100, source: '' };
}

/** Whether anything was typed that closing the sheet would lose. */
export function formTyped(form: ConversionForm): boolean {
  return (
    form.name.trim() !== '' ||
    form.cooked !== null ||
    form.kept !== 100 ||
    form.source.trim() !== ''
  );
}

const oneDecimal = (value: number) => Math.abs(value * 10 - Math.round(value * 10)) < 1e-9;

/** What is wrong with each box, in words, checked as the server would so it never refuses less. */
export function conversionErrors(form: ConversionForm): Record<ConversionField, string[]> {
  const name = form.name.trim();
  const source = form.source.trim();
  const errors: Record<ConversionField, string[]> = { name: [], cooked: [], kept: [], source: [] };
  if (!name) errors.name.push($localize`Say what it is, like White rice, boiled.`);
  else if (name.length > MAX_CONVERSION_NAME) {
    errors.name.push($localize`Keep it to ${MAX_CONVERSION_NAME}:max: characters.`);
  }
  const cooked = form.cooked;
  if (cooked === null || !Number.isFinite(cooked) || cooked <= 0 || cooked > MAX_COOKED_GRAMS) {
    errors.cooked.push($localize`Enter what 100 g raw weighs cooked, above 0 and up to 500 g.`);
  } else if (!oneDecimal(cooked)) {
    errors.cooked.push($localize`Use at most one decimal.`);
  }
  const kept = form.kept;
  if (kept === null || !Number.isFinite(kept) || kept <= 0 || kept > 100) {
    errors.kept.push($localize`Enter how much is kept, above 0% and up to 100%.`);
  } else if (!oneDecimal(kept)) {
    errors.kept.push($localize`Use at most one decimal.`);
  }
  if (!source) {
    errors.source.push(
      $localize`Say where these numbers come from, like USDA cooking yields or Weighed in my kitchen.`,
    );
  } else if (source.length > MAX_CONVERSION_SOURCE) {
    errors.source.push($localize`Keep it to ${MAX_CONVERSION_SOURCE}:max: characters.`);
  }
  return errors;
}

/** A share as the server keeps it: six decimals at most, so 33.3% goes as 0.333, never 0.33299999… */
function factor(value: number): number {
  return Number(value.toFixed(6));
}

/** The request for a form `conversionErrors` passed. */
export function conversionRequest(form: ConversionForm): CreateCookingConversionRequest {
  return {
    sourceKey: form.name.trim(),
    sourceVersion: form.source.trim(),
    yieldFactor: factor((form.cooked ?? 0) / 100),
    retentionFactor: factor((form.kept ?? 0) / 100),
  };
}

/** What the numbers typed mean, said while they are typed; empty until they are numbers. */
export function conversionPreview(form: ConversionForm, locale: string): string {
  const errors = conversionErrors(form);
  if (errors.cooked.length || errors.kept.length || form.cooked === null || form.kept === null) {
    return '';
  }
  const raw = grams((100 * 100) / form.cooked, locale);
  return form.kept >= 100
    ? $localize`So 100 g cooked counts as ${raw}:raw: g raw.`
    : $localize`So 100 g cooked counts as ${raw}:raw: g raw, keeping ${formatNumber(form.kept, locale, '1.0-1')}:kept:% of its protein, carbs and fat.`;
}

/** The server's refusal, in the sheet's words: which box it names, and the sentence for the summary. */
export function conversionRefusal(error: unknown): {
  readonly fields: Partial<Record<ConversionField, string[]>>;
  readonly message: string;
} {
  const fields: Partial<Record<ConversionField, string[]>> = {};
  if (error instanceof HttpErrorResponse && error.status === 400) {
    const errors = (error.error as { errors?: Record<string, string[]> } | null)?.errors ?? {};
    const boxes: Record<string, ConversionField> = {
      sourceKey: 'name',
      sourceVersion: 'source',
      yieldFactor: 'cooked',
      retentionFactor: 'kept',
    };
    for (const [key, messages] of Object.entries(errors)) {
      const box = boxes[key];
      if (box && messages.length) fields[box] = messages;
    }
    if (Object.keys(fields).length) {
      return { fields, message: $localize`Check the fields marked above.` };
    }
  }
  return {
    fields,
    message: apiErrorMessage(error, $localize`The conversion couldn’t be saved. Try again.`),
  };
}
