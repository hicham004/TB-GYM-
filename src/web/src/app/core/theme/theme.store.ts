import { DOCUMENT } from '@angular/common';
import { computed, effect, inject, Injectable, signal } from '@angular/core';
import {
  BRAND_TOKEN_NAMES,
  BrandColors,
  brandTokens,
  BrandTokens,
  safeBrand,
  TB_GYM_BRAND,
} from './brand-theme';
import { PersonalModeStore, type ThemeMode } from './personal-mode.store';

/** Light, dark, or whatever the device asks for. */
export { isThemeMode, type ThemeMode } from './personal-mode.store';

/**
 * The brand and the light or dark mode the app is drawn in (plan §3.1), written onto <html>:
 * `data-mode` picks the mode tokens in _tokens.scss, and the brand's derived tokens are set as
 * inline custom properties over the stylesheet's TB Gym defaults.
 *
 * The account session supplies personal mode; the coach's brand arrives in R3.5.
 */
@Injectable({ providedIn: 'root' })
export class ThemeStore {
  private readonly root = inject(DOCUMENT).documentElement;
  private readonly personalMode = inject(PersonalModeStore);
  private readonly brandState = signal<BrandColors>(TB_GYM_BRAND);

  readonly brand = this.brandState.asReadonly();
  readonly mode = this.personalMode.mode;
  readonly tokens = computed(() => brandTokens(this.brandState()));

  constructor() {
    effect(() => applyTheme(this.root, this.tokens(), this.mode()));
  }

  /** A brand that is not two `#rrggbb` colours falls back to TB Gym's. */
  setBrand(colors: BrandColors | null): void {
    this.brandState.set(safeBrand(colors));
  }

  setMode(mode: ThemeMode): void {
    this.personalMode.setMode(mode);
  }
}

/** Draws `element` and everything inside it in one brand and mode. */
export function applyTheme(element: HTMLElement, tokens: BrandTokens, mode: ThemeMode): void {
  for (const name of BRAND_TOKEN_NAMES) element.style.setProperty(name, tokens[name]);
  element.dataset['mode'] = mode;
}
