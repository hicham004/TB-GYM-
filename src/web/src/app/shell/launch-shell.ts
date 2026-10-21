import { isPlatformBrowser } from '@angular/common';
import { inject, Injectable, PLATFORM_ID } from '@angular/core';

/** A shell the launch screen can draw the frame of. */
export type LaunchShell = 'coach' | 'client';

const storageKey = 'tb-gym.launch-shell';

/**
 * Which shell this device last drew for a signed-in person, so that while the session is checked
 * the launch screen draws that shell's empty frame and the page arrives in its place (audit UIQ-5).
 * A hint for the picture only, never a credential: it grants and withholds nothing, the session's
 * answer decides which shell is drawn, and it is forgotten when the person signs out or the session
 * is found ended.
 */
@Injectable({ providedIn: 'root' })
export class LaunchShellHint {
  /** Only a browser remembers it; the build-time render of the homepage has no storage. */
  private readonly storage = isPlatformBrowser(inject(PLATFORM_ID)) ? localStorage : null;

  /** What this device remembered when the app started; it does not change while the app runs. */
  readonly remembered: LaunchShell | null = this.read();

  /** Keeps the shell drawn now for the next start, or forgets it when there is none. */
  remember(shell: LaunchShell | null): void {
    try {
      if (shell === null) {
        this.storage?.removeItem(storageKey);
      } else {
        this.storage?.setItem(storageKey, shell);
      }
    } catch {
      // Storage that is full or switched off only costs the frame on the next start.
    }
  }

  private read(): LaunchShell | null {
    try {
      const value = this.storage?.getItem(storageKey) ?? null;
      return value === 'coach' || value === 'client' ? value : null;
    } catch {
      return null;
    }
  }
}
