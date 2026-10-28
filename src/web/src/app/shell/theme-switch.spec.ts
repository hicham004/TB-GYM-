import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthStore } from '../core/auth/auth.store';
import { PersonalModeStore, type ThemeMode } from '../core/theme/personal-mode.store';
import { UiToast } from '../ui/toast';
import { button, settle } from '../../testing/dom';
import { ThemeSwitch, ThemeSwitchArt } from './theme-switch';

@Component({
  imports: [ThemeSwitch, ThemeSwitchArt],
  template: `
    <button #theme="appThemeSwitch" appThemeSwitch type="button">
      <span>Dark mode</span>
      <app-theme-switch-art [night]="theme.dark()" />
    </button>
  `,
})
class Host {}

type Listener = (event: MediaQueryListEvent) => void;

/** A device answering the colour-scheme and motion questions; jsdom has no `matchMedia`. */
function stubDevice(dark: boolean, reducedMotion: boolean) {
  const view = document.defaultView as Window & { matchMedia?: Window['matchMedia'] };
  const original = view.matchMedia;
  const listeners = new Set<Listener>();
  view.matchMedia = ((media: string) =>
    ({
      matches:
        media === '(prefers-color-scheme: dark)'
          ? dark
          : media === '(prefers-reduced-motion: no-preference)' && !reducedMotion,
      media,
      addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
      removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
    }) as unknown as MediaQueryList) as Window['matchMedia'];
  return {
    turnDark(next: boolean) {
      dark = next;
      for (const listener of listeners) listener({ matches: next } as MediaQueryListEvent);
    },
    restore() {
      if (original) view.matchMedia = original;
      else Reflect.deleteProperty(view, 'matchMedia');
    },
  };
}

let restoreDevice = () => undefined as void;

async function render(options: { mode?: ThemeMode; dark?: boolean; reducedMotion?: boolean } = {}) {
  const device = stubDevice(options.dark ?? false, options.reducedMotion ?? false);
  restoreDevice = device.restore;
  const user = signal({ id: 'member', preferredThemeMode: options.mode ?? 'system' });
  // Saves wait for the test to answer them. A saved reply becomes the account and its mode is drawn,
  // as AuthStore does.
  const answers: ((saved: boolean) => void)[] = [];
  const auth = {
    user,
    updateThemeMode: vi.fn(
      (mode: ThemeMode) =>
        new Promise<void>((resolve, reject) =>
          answers.push((saved) => {
            if (!saved) return reject(new Error('refused'));
            user.set({ id: 'member', preferredThemeMode: mode });
            TestBed.inject(PersonalModeStore).setMode(mode);
            resolve();
          }),
        ),
    ),
  };
  const toast = { show: vi.fn() };
  await TestBed.configureTestingModule({
    imports: [Host],
    providers: [
      { provide: AuthStore, useValue: auth },
      { provide: UiToast, useValue: toast },
    ],
  }).compileComponents();
  const personalMode = TestBed.inject(PersonalModeStore);
  personalMode.setMode(options.mode ?? 'system');
  const fixture = TestBed.createComponent(Host);
  await settle(fixture);
  const host = fixture.nativeElement as HTMLElement;
  return {
    fixture,
    auth,
    toast,
    answers,
    device,
    personalMode,
    toggle: button(host, 'Dark mode'),
    art: host.querySelector('app-theme-switch-art')!,
  };
}

describe('ThemeSwitch', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    restoreDevice();
    Reflect.deleteProperty(document, 'startViewTransition');
    document.documentElement.removeAttribute('data-mode');
  });

  it('is a switch showing the mode the app is drawn in, the device’s while the person follows it', async () => {
    const { fixture, toggle, art, device } = await render({ mode: 'system', dark: true });

    expect(toggle.getAttribute('role')).toBe('switch');
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(art.classList.contains('night')).toBe(true);
    expect(art.getAttribute('aria-hidden')).toBe('true');

    device.turnDark(false);
    await settle(fixture);

    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(art.classList.contains('night')).toBe(false);
  });

  it('draws the other mode at once and saves it on the account', async () => {
    const { fixture, toggle, auth, answers, personalMode } = await render({ mode: 'light' });

    toggle.click();
    await settle(fixture);

    // Drawn before the account answers.
    expect(personalMode.mode()).toBe('dark');
    expect(document.documentElement.getAttribute('data-mode')).toBe('dark');
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(auth.updateThemeMode).toHaveBeenCalledWith('dark');

    answers[0](true);
    await settle(fixture);

    expect(auth.user().preferredThemeMode).toBe('dark');
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('puts the account’s mode back and says so when the save is refused', async () => {
    const { fixture, toggle, toast, answers, personalMode } = await render({ mode: 'system' });

    toggle.click();
    await settle(fixture);
    expect(personalMode.mode()).toBe('dark');

    answers[0](false);
    await settle(fixture);

    expect(personalMode.mode()).toBe('system');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    // The toast's file is fetched only now, kept out of the first download.
    await vi.waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith('Couldn’t save your choice. Try again.', {
        tone: 'error',
      }),
    );
  });

  it('saves the newest of quick presses, and an earlier reply never draws its older mode', async () => {
    const { fixture, toggle, auth, toast, answers, personalMode } = await render({ mode: 'light' });

    toggle.click();
    await settle(fixture);
    toggle.click();
    await settle(fixture);

    expect(personalMode.mode()).toBe('light');
    expect(auth.updateThemeMode).toHaveBeenCalledTimes(1);

    // The first reply says dark; the newer press is drawn again and saved next.
    answers[0](true);
    await settle(fixture);

    expect(personalMode.mode()).toBe('light');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(auth.updateThemeMode.mock.calls.map(([mode]) => mode)).toEqual(['dark', 'light']);

    answers[1](true);
    await settle(fixture);

    expect(personalMode.mode()).toBe('light');
    expect(auth.user().preferredThemeMode).toBe('light');
    expect(toast.show).not.toHaveBeenCalled();
  });

  it('spreads the new mode from the switch in a view transition, then tidies up', async () => {
    const { fixture, toggle, personalMode } = await render({ mode: 'light' });
    const root = document.documentElement;
    let during: { revealing: boolean; x: string; radius: string } | undefined;
    let finish = () => undefined as void;
    const startViewTransition = vi.fn((update: () => Promise<void>) => {
      during = {
        revealing: root.classList.contains('tb-theme-reveal'),
        x: root.style.getPropertyValue('--tb-reveal-x'),
        radius: root.style.getPropertyValue('--tb-reveal-radius'),
      };
      const updated = update();
      return {
        ready: updated,
        updateCallbackDone: updated,
        finished: new Promise<void>((resolve) => (finish = resolve)),
      };
    });
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: startViewTransition,
    });

    toggle.click();
    await settle(fixture);

    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(during).toEqual({
      revealing: true,
      x: expect.stringMatching(/px$/),
      radius: expect.stringMatching(/px$/),
    });
    expect(personalMode.mode()).toBe('dark');

    finish();
    await settle(fixture);

    expect(root.classList.contains('tb-theme-reveal')).toBe(false);
    expect(root.style.getPropertyValue('--tb-reveal-x')).toBe('');
  });

  it('changes at once, with no transition, for someone who asked for less motion', async () => {
    const { fixture, toggle, personalMode } = await render({ mode: 'light', reducedMotion: true });
    const startViewTransition = vi.fn();
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: startViewTransition,
    });

    toggle.click();
    await settle(fixture);

    expect(startViewTransition).not.toHaveBeenCalled();
    expect(personalMode.mode()).toBe('dark');
  });
});
