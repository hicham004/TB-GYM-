import type { ClientWeightNoteView } from '../../core/api/generated';
import { amount, onDay, reasonWords, unitWord, weight, type StandingPart } from './standing-words';

/** The client's line under a lift whose weight the coach applied, its lead strong. */
export interface WeightNoteLine {
  readonly parts: readonly StandingPart[];
  /** The whole line as one sentence, for tests and anything that reads it at once. */
  readonly text: string;
}

/**
 * Why a lift's weight is what it is in this workout, as the client reads it in the player (notes plan N6c,
 * STR-020): the coach applied a step, "Up 2 kg · all 3 × 10 done on Tue", or kept last time's weight, "Same
 * weight as last time · set 1 reached 11 of 12 on Tue 3 Nov". The days are judged from the server's today
 * (`today`), never the device's clock, and the line never says who applied it.
 */
export function weightNoteLine(
  note: ClientWeightNoteView,
  today: string,
  locale: string,
): WeightNoteLine {
  const parts: StandingPart[] = [];
  const on = onDay(note.lastTimeDay, today, locale);
  if (note.move === 'StepUp') {
    const rises = note.increases.map(Number);
    const low = Math.min(...rises);
    const high = Math.max(...rises);
    const rise =
      low === high
        ? weight(low, note.unit, locale)
        : `${amount(low, locale)}–${amount(high, locale)} ${unitWord(note.unit)}`;
    parts.push({ text: $localize`Up ${rise}:weight:`, strong: true });
    const sets = Number(note.workingSets);
    const reps = note.repetitionsAsked === null ? null : Number(note.repetitionsAsked);
    if (sets > 1) {
      parts.push({
        text:
          reps === null
            ? $localize`all ${sets}:sets: sets done ${on}:day:`
            : $localize`all ${sets}:sets: × ${reps}:reps: done ${on}:day:`,
        strong: false,
      });
    } else if (sets === 1) {
      parts.push({
        text:
          reps === null
            ? $localize`the set done ${on}:day:`
            : $localize`1 × ${reps}:reps: done ${on}:day:`,
        strong: false,
      });
    }
  } else {
    parts.push({ text: $localize`Same weight as last time`, strong: true });
    const reason = note.reason
      ? reasonWords(note.reason, today, note.exertionDisplay, note.unit, locale)
      : null;
    if (reason) parts.push({ text: reason, strong: false });
  }
  return { parts, text: parts.map((part) => part.text).join(' · ') };
}
