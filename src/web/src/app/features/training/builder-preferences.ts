/**
 * What the program builder and Edit weeks keep in this browser only: whether the exercise library
 * sits open beside the grid, and which weeks of a program are folded. Conveniences, so nothing
 * breaks when storage is missing or refused.
 */
const LIBRARY_KEY = 'tb.program-library';
const FOLDS_KEY = 'tb.program-folds:';

/** The library starts closed as a rail until the coach opens it. */
export function readLibraryOpen(): boolean {
  try {
    return localStorage.getItem(LIBRARY_KEY) === 'open';
  } catch {
    return false;
  }
}

export function writeLibraryOpen(open: boolean): void {
  try {
    localStorage.setItem(LIBRARY_KEY, open ? 'open' : 'closed');
  } catch {
    // Private windows and blocked storage: the choice lasts for this page only.
  }
}

/**
 * The folded weeks of one program, by position (week keys are made afresh on every load). A new
 * program has no id yet, so its folds last for the visit only.
 */
export function readFolds(templateId: string | null): ReadonlySet<number> {
  if (!templateId) return new Set();
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(FOLDS_KEY + templateId) ?? '[]');
    return new Set(
      Array.isArray(stored) ? stored.filter((item): item is number => Number.isInteger(item)) : [],
    );
  } catch {
    return new Set();
  }
}

export function writeFolds(templateId: string | null, positions: Iterable<number>): void {
  if (!templateId) return;
  try {
    const list = [...positions].sort((a, b) => a - b);
    if (list.length === 0) localStorage.removeItem(FOLDS_KEY + templateId);
    else localStorage.setItem(FOLDS_KEY + templateId, JSON.stringify(list));
  } catch {
    // As above.
  }
}
