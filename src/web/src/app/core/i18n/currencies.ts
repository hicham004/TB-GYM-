/**
 * The currency a coaching space prices new plans in, as a person chooses it (R5.2a, and registration
 * since audit AUTH-5): US dollar or Lebanese pound in one tap, any other ISO 4217 code typed under
 * Another. Pure helpers, so the pages and their tests share them.
 */

/** The two currencies Lebanese coaches price in, offered first; any other ISO code is one tap away. */
export const OFFERED_CURRENCIES = ['USD', 'LBP'] as const;

export type CurrencyChoice = (typeof OFFERED_CURRENCIES)[number] | 'other';

/** The choice that shows a stored code: USD or LBP as itself, anything else under Another. */
export function currencyChoiceOf(code: string): { choice: CurrencyChoice; other: string } {
  const upper = code.toUpperCase();
  return (OFFERED_CURRENCIES as readonly string[]).includes(upper)
    ? { choice: upper as CurrencyChoice, other: '' }
    : { choice: 'other', other: upper };
}

/** The code the choice means, as the API takes it. */
export function chosenCurrency(choice: CurrencyChoice, other: string): string {
  return choice === 'other' ? other.trim().toUpperCase() : choice;
}

/** What is wrong with the choice, in words; empty when it is fine. */
export function currencyReasons(choice: CurrencyChoice, other: string): readonly string[] {
  if (choice !== 'other') return [];
  const code = chosenCurrency(choice, other);
  if (code.length === 0) return [$localize`Type the currency’s three-letter code, like EUR.`];
  return isKnownCurrency(code)
    ? []
    : [$localize`${code}:code: isn’t a currency code. Try one like EUR or AED.`];
}

/** True when the ISO 4217 code is one the browser knows, or looks like one where it cannot say. */
export function isKnownCurrency(code: string): boolean {
  if (!/^[A-Z]{3}$/.test(code)) return false;
  try {
    return Intl.supportedValuesOf('currency').includes(code);
  } catch {
    return true;
  }
}

/** "US dollar" for USD in English; the code itself where the browser has no name. */
export function currencyName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'currency' }).of(code) ?? code;
  } catch {
    return code;
  }
}
