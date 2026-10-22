import { Directive, ElementRef, inject } from '@angular/core';

/**
 * The digits and separators a phone's number pad may type in another script, as the ASCII the time is
 * read in: Arabic-Indic and Persian digits, full-width digits, the Arabic decimal separator (٫) and
 * comma (،) and the full-width colon.
 */
function asciiDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[０-９]/g, (digit) => String(digit.charCodeAt(0) - 0xff10))
    .replace(/[٫،：]/g, ':');
}

/**
 * A time as typed, read as the 24-hour `HH:MM` the API takes: "22:00", "22.00", "22h", "2200",
 * "730" and "7" are 22:00, 22:00, 22:00, 22:00, 07:30 and 07:00, and "10pm", "7.30 a.m." and "12am"
 * are 22:00, 07:30 and 00:00, in any script's digits ("٢٢٠٠" is 22:00). Null for anything else, an
 * hour past 23 or a minute past 59 among them.
 */
export function parseTime(text: string): string | null {
  const typed = asciiDigits(text)
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/([ap])\.m\.?$/, '$1m');
  const match = /^(\d{1,4})(?:[:.,h](\d{2}))?h?(am?|pm?)?$/.exec(typed);
  if (match === null) return null;
  const [, digits, minutesTyped, meridiem] = match;
  if (minutesTyped !== undefined && digits.length > 2) return null;
  // Three or four digits with no separator are the hour, then two digits of minutes ("730", "2200").
  const split = minutesTyped === undefined && digits.length > 2;
  let hours = Number(split ? digits.slice(0, -2) : digits);
  const minutes = Number(split ? digits.slice(-2) : (minutesTyped ?? '0'));
  if (meridiem !== undefined) {
    if (hours < 1 || hours > 12) return null;
    hours = (hours % 12) + (meridiem.startsWith('p') ? 12 : 0);
  }
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Form/Time (plan §2 rule 8, audit A14a: no browser-drawn picker). Put it on a text `<input appControl>`
 * bound with `formControlName`, `[formControl]` or `ngModel`: the box takes a time typed on the
 * 24-hour clock with a number pad, and rewrites what it can read as `HH:MM` (`parseTime`) for the
 * binding to take the moment the box commits it: on Enter, which submits a form before any blur, on
 * change and when the box is left. What it cannot read stays as typed, so the page's own reason
 * ("Enter when quiet hours start, such as 22:00.") can say what is wrong.
 */
@Directive({
  selector: 'input[appTimeInput]',
  host: {
    inputmode: 'decimal',
    autocomplete: 'off',
    spellcheck: 'false',
    maxlength: '10',
    '(keydown.enter)': 'tidy()',
    '(change)': 'tidy()',
    '(blur)': 'tidy()',
  },
})
export class TimeInput {
  private readonly element = inject<ElementRef<HTMLInputElement>>(ElementRef).nativeElement;

  protected tidy(): void {
    const time = parseTime(this.element.value);
    if (time === null || time === this.element.value) return;
    this.element.value = time;
    // The value binding reads what the box holds from its input event.
    this.element.dispatchEvent(new Event('input', { bubbles: true }));
  }
}
