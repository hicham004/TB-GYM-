import { inject, Injectable, Injector } from '@angular/core';
import { AuthStore } from '../core/auth/auth.store';
import { isThemeMode, PersonalModeStore, type ThemeMode } from '../core/theme/personal-mode.store';

/** The kit's toast stays out of the first download, as `NavigationFailure` keeps it (about 90 kB). */
const loadToast = () => import('../ui/toast').then((module) => module.UiToast);

/**
 * Saves the light or dark mode chosen with the account menu's Dark mode switch on the account. One for
 * the app rather than one per switch: the menu, and the switch with it, closes and opens again while a
 * save is on its way, and a press on the new switch is still saved after the old one's.
 *
 * Presses made while a save is on its way are not lost: the newest is saved next, and an earlier reply
 * never draws its older mode. If the newest is refused, the page goes back to the account's mode and a
 * toast says so.
 */
@Injectable({ providedIn: 'root' })
export class ThemeModeSaver {
  private readonly auth = inject(AuthStore);
  private readonly personalMode = inject(PersonalModeStore);
  private readonly injector = inject(Injector);
  /** The mode pressed last and not saved yet; null once the account has it. */
  private wanted: ThemeMode | null = null;
  private saving = false;

  /** A press of the switch, which has drawn `mode` already. */
  want(mode: ThemeMode): void {
    this.wanted = mode;
    if (!this.saving) void this.saveWanted();
  }

  /**
   * A choice on Settings › Appearance, saved after any save on its way. It replaces a press not saved
   * yet, so that press is never saved after it; one made while it is on its way stays drawn over its
   * reply. Rejects when it is refused, for the page to say so.
   */
  async save(mode: ThemeMode): Promise<void> {
    this.wanted = null;
    try {
      await this.auth.updateThemeMode(mode);
    } finally {
      if (this.wanted !== null) this.personalMode.setMode(this.wanted);
    }
  }

  private async saveWanted(): Promise<void> {
    const account = this.auth.user()?.id;
    this.saving = true;
    try {
      while (this.wanted !== null) {
        const mode = this.wanted;
        let refused = false;
        try {
          await this.auth.updateThemeMode(mode);
        } catch {
          refused = true;
        }
        // Signed out, or another account signed in meanwhile: the new session's mode stands.
        if (account === undefined || this.auth.user()?.id !== account) {
          this.wanted = null;
          return;
        }
        if (this.wanted === null) {
          // A choice on Settings › Appearance replaced the press, and its own reply draws it.
          if (refused) this.personalMode.setMode(accountMode(this.auth.user()?.preferredThemeMode));
          return;
        }
        if (this.wanted !== mode) {
          // A newer press came while this one was on its way, and its reply drew the older mode.
          this.personalMode.setMode(this.wanted);
          continue;
        }
        this.wanted = null;
        if (refused) {
          this.personalMode.setMode(accountMode(this.auth.user()?.preferredThemeMode));
          void this.sayRefused();
        }
      }
    } finally {
      this.saving = false;
    }
  }

  private async sayRefused(): Promise<void> {
    // Null when the toast's own file could not be fetched either: the mode drawn back says it alone.
    const toasts = await loadToast()
      .then((type) => this.injector.get(type))
      .catch(() => null);
    toasts?.show($localize`Couldn’t save your choice. Try again.`, { tone: 'error' });
  }
}

function accountMode(value: string | undefined): ThemeMode {
  return isThemeMode(value) ? value : 'system';
}
