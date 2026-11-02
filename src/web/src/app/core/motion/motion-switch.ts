/**
 * The motion switch (docs/MOTION-PLAN-2026-11.md, W1), on its own so the first download carries
 * these few lines and not the moves: `?motion=off` in the address writes `tb-motion = off` to local
 * storage (`?motion=on` clears it), `tb-motion-off = W3,W7` turns single rows off, and `<html>`
 * carries `data-tb-motion="off"` while the switch is on, so the stylesheet's everyday layer rests
 * too. `Motion` (motion.ts) reads the same keys per call.
 */

/** Local storage: the switch for everything. */
export const MOTION_KEY = 'tb-motion';
/** Local storage: the rows switched off on their own, comma-separated (`W3,W7`). */
export const ROWS_KEY = 'tb-motion-off';
/** On `<html>` while the switch is on. */
export const SWITCH_ATTRIBUTE = 'data-tb-motion';

/**
 * Reads `?motion=off` or `?motion=on` from the address into local storage and marks `<html>`. The
 * app initializer calls it with the first address; `Motion` calls it again when it is first made.
 */
export function readMotionSwitch(document: Document): void {
  const view = document.defaultView;
  if (view === null) return;
  const asked = new URLSearchParams(view.location.search).get('motion');
  if (asked === 'off') writeStored(view, MOTION_KEY, 'off');
  else if (asked === 'on') writeStored(view, MOTION_KEY, null);
  const root = document.documentElement;
  if (readStored(view, MOTION_KEY) === 'off') root.setAttribute(SWITCH_ATTRIBUTE, 'off');
  else root.removeAttribute(SWITCH_ATTRIBUTE);
}

/** Whether `tb-motion-off` names this row of the motion plan (W3, W7, ...), read now. */
export function rowSwitchedOff(view: Window | null, row: string): boolean {
  if (view === null) return false;
  const off = (readStored(view, ROWS_KEY) ?? '').split(',').map((name) => name.trim());
  return off.includes(row);
}

/** A stored value, or null where storage is refused. */
export function readStored(view: Window, key: string): string | null {
  try {
    return view.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(view: Window, key: string, value: string | null): void {
  try {
    if (value === null) view.localStorage.removeItem(key);
    else view.localStorage.setItem(key, value);
  } catch {
    // Storage refused (private mode, a full quota): the switch lasts for this page only.
  }
}
