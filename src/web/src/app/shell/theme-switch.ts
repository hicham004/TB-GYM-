import { DOCUMENT } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  contentChild,
  DestroyRef,
  Directive,
  ElementRef,
  EnvironmentInjector,
  inject,
  input,
  signal,
  type Injector,
  type Signal,
} from '@angular/core';
import { AuthStore } from '../core/auth/auth.store';
import { isThemeMode, PersonalModeStore, type ThemeMode } from '../core/theme/personal-mode.store';

/** The kit's toast stays out of the first download, as `NavigationFailure` keeps it (about 90 kB). */
const loadToast = () => import('../ui/toast').then((module) => module.UiToast);

/** The class `styles.scss` reads on <html> while a new mode spreads over the page. */
const REVEAL_CLASS = 'tb-theme-reveal';
const REVEAL_PROPERTIES = ['--tb-reveal-x', '--tb-reveal-y', '--tb-reveal-radius'] as const;
/** Only the newest reveal tidies up, so one cut short by a second press leaves the next its class. */
let newestReveal = 0;

/**
 * The picture inside the Dark mode switch: a sun in a warm sky, eclipsed into a crescent moon among
 * stars as the knob crosses. Decorative only; the button around it carries the name and the state.
 */
@Component({
  selector: 'app-theme-switch-art',
  templateUrl: './theme-switch.html',
  styleUrl: './theme-switch.scss',
  host: { 'aria-hidden': 'true', '[class.night]': 'night()' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ThemeSwitchArt {
  readonly night = input.required<boolean>();
}

/**
 * The account menu's Dark mode switch: light or dark straight from the menu. Settings › Appearance
 * still offers following the device, which a switch cannot say.
 *
 * It shows the mode the app is drawn in, so someone following a dark device sees it on. A press draws
 * the other mode at once, spreading it over the page from the switch, and saves it on the account as
 * the Appearance page does, so it follows the person to every device. Presses made while a save is on
 * its way are not lost: the newest is saved next, and an earlier reply never draws its older mode. If
 * the newest is refused, the page goes back to the account's mode and a toast says so.
 */
@Directive({
  selector: 'button[appThemeSwitch]',
  exportAs: 'appThemeSwitch',
  host: {
    role: 'switch',
    '[attr.aria-checked]': 'dark()',
    '(click)': 'toggle()',
  },
})
export class ThemeSwitch {
  private readonly auth = inject(AuthStore);
  private readonly personalMode = inject(PersonalModeStore);
  private readonly document = inject(DOCUMENT);
  // The app's injector rather than this button's: a reveal must finish even if the menu closes.
  private readonly injector = inject(EnvironmentInjector);
  private readonly art = contentChild(ThemeSwitchArt, { read: ElementRef });
  private readonly deviceDark = deviceDark(this.document, inject(DestroyRef));
  /** The mode pressed last and not saved yet; null once the account has it. */
  private wanted: ThemeMode | null = null;
  private saving = false;

  /** Whether the app is drawn dark: the person's mode, or their device's while they follow it. */
  readonly dark = computed(() => {
    const mode = this.personalMode.mode();
    return mode === 'dark' || (mode === 'system' && this.deviceDark());
  });

  protected toggle(): void {
    const mode: ThemeMode = this.dark() ? 'light' : 'dark';
    this.reveal(() => this.personalMode.setMode(mode));
    this.wanted = mode;
    if (!this.saving) void this.saveWanted();
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

  /**
   * Draws the change spreading from the switch over the page (a view transition, `styles.scss`), or
   * at once where the browser has none or the person asked for less motion.
   */
  private reveal(draw: () => void): void {
    const document = this.document;
    const view = document.defaultView;
    const art = this.art()?.nativeElement;
    if (
      typeof document.startViewTransition !== 'function' ||
      view === null ||
      art === undefined ||
      view.matchMedia?.('(prefers-reduced-motion: no-preference)')?.matches !== true
    ) {
      draw();
      return;
    }

    const box = art.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const radius = Math.hypot(Math.max(x, view.innerWidth - x), Math.max(y, view.innerHeight - y));
    const root = document.documentElement;
    root.style.setProperty('--tb-reveal-x', `${x}px`);
    root.style.setProperty('--tb-reveal-y', `${y}px`);
    root.style.setProperty('--tb-reveal-radius', `${radius}px`);
    root.classList.add(REVEAL_CLASS);
    const reveal = ++newestReveal;
    const tidy = () => {
      if (reveal !== newestReveal) return;
      root.classList.remove(REVEAL_CLASS);
      for (const property of REVEAL_PROPERTIES) root.style.removeProperty(property);
    };
    const transition = document.startViewTransition(() => {
      draw();
      return drawn(this.injector);
    });
    // A second press cuts this one short, which rejects `ready`; the second one draws the rest.
    transition.ready.catch(() => undefined);
    void transition.finished.then(tidy, tidy);
  }
}

function accountMode(value: string | undefined): ThemeMode {
  return isThemeMode(value) ? value : 'system';
}

/** Whether the device asks for dark, kept current while the switch is on screen. */
function deviceDark(document: Document, destroyRef: DestroyRef): Signal<boolean> {
  const query = document.defaultView?.matchMedia?.('(prefers-color-scheme: dark)');
  const dark = signal(query?.matches ?? false);
  if (query) {
    const follow = (event: MediaQueryListEvent) => dark.set(event.matches);
    query.addEventListener('change', follow);
    destroyRef.onDestroy(() => query.removeEventListener('change', follow));
  }
  return dark.asReadonly();
}

/**
 * Resolves once Angular has drawn the new mode, so the transition captures it. A moment later at the
 * latest: the browser holds the old picture on screen until this resolves.
 */
function drawn(injector: Injector): Promise<void> {
  return new Promise((resolve) => {
    afterNextRender({ read: () => resolve() }, { injector });
    setTimeout(resolve, 100);
  });
}
