import type { DayOfWeek, WorkspaceDetails } from '../../core/api/api.models';
import {
  chosenCurrency,
  currencyChoiceOf,
  currencyReasons,
  type CurrencyChoice,
} from '../../core/i18n/currencies';

/**
 * Settings › Name and region (R5.2a): the coaching space's name, the language of its notices and emails,
 * its time zone, the first day of its week and the currency new plans start in. Pure helpers, so the
 * page and its tests share them; the time zone and currency pieces registration shares too are in
 * `core/i18n`.
 */

export interface SpaceDraft {
  name: string;
  /** The language TB Gym writes the space's notices and emails in, as the server keeps it. */
  language: string;
  timeZoneId: string;
  weekStartsOn: DayOfWeek;
  currencyChoice: CurrencyChoice;
  /** The code typed under Another currency; ignored for USD and LBP. */
  otherCurrency: string;
}

export type SpaceField = 'name' | 'currency';

export function draftFrom(workspace: WorkspaceDetails): SpaceDraft {
  const currency = currencyChoiceOf(workspace.defaultCurrencyCode);
  return {
    name: workspace.name,
    language: workspace.defaultCulture,
    timeZoneId: workspace.timeZoneId,
    weekStartsOn: workspace.weekStartsOn,
    currencyChoice: currency.choice,
    otherCurrency: currency.other,
  };
}

/** The currency the draft means, as the API takes it. */
export function draftCurrency(draft: SpaceDraft): string {
  return chosenCurrency(draft.currencyChoice, draft.otherCurrency);
}

/** Whether saving the draft would change anything the server holds. */
export function draftChanged(draft: SpaceDraft, workspace: WorkspaceDetails): boolean {
  return (
    draft.name.trim() !== workspace.name ||
    draft.language !== workspace.defaultCulture ||
    draft.timeZoneId !== workspace.timeZoneId ||
    draft.weekStartsOn !== workspace.weekStartsOn ||
    draftCurrency(draft) !== workspace.defaultCurrencyCode.toUpperCase()
  );
}

/**
 * What the language means today (audit INV-8): only English wording exists, so a space that chose
 * Arabic still gets every notice and email, in English, until the Arabic ones are written.
 */
export function languageLine(language: string): string {
  return language === 'ar-LB'
    ? $localize`Notices and emails aren’t written in Arabic yet, so they go out in English until they are.`
    : $localize`Notices and emails go out in English.`;
}

/** What is wrong with each field, in words; an empty list when it is fine. */
export function draftErrors(draft: SpaceDraft): Record<SpaceField, readonly string[]> {
  const name = draft.name.trim();
  return {
    name:
      name.length === 0
        ? [$localize`Give your coaching space a name.`]
        : name.length > 200
          ? [$localize`Keep the name to 200 characters.`]
          : [],
    currency: currencyReasons(draft.currencyChoice, draft.otherCurrency),
  };
}
