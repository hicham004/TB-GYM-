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

/** Light, dark, or whatever the device asks for. */
export type ThemeMode = 'light' | 'dark' | 'system';

const MODES: readonly ThemeMode[] = ['light', 'dark', 'system'];

export function isThemeMode(value: string | null | undefined): value is ThemeMode {
  return MODES.some((mode) => mode === value);
}

/**
 * The brand and the light or dark mode the app is drawn in (plan §3.1), written onto <html>:
 * `data-mode` picks the mode tokens in _tokens.scss, and the brand's derived tokens are set as
 * inline custom properties over the stylesheet's TB Gym defaults.
 *
 * Nothing sets either one yet, so everyone sees TB Gym's brand in light mode. The personal mode
 * setting arrives with the client app (R2.1) and the coach's brand with the coach core (R3.5);
 * development builds can already preview both (dev/dev-providers.development.ts).
 */
@Injectable({ providedIn: 'root' })
export class ThemeStore {
  private readonly root = inject(DOCUMENT).documentElement;
  private readonly brandState = signal<BrandColors>(TB_GYM_BRAND);
  private readonly modeState = signal<ThemeMode>('light');

  readonly brand = this.brandState.asReadonly();
  readonly mode = this.modeState.asReadonly();
  readonly tokens = computed(() => brandTokens(this.brandState()));

  constructor() {
    effect(() => applyTheme(this.root, this.tokens(), this.modeState()));
  }

  /** A brand that is not two `#rrggbb` colours falls back to TB Gym's. */
  setBrand(colors: BrandColors | null): void {
    this.brandState.set(safeBrand(colors));
  }

  setMode(mode: ThemeMode): void {
    this.modeState.set(mode);
  }
}

/** Draws `element` and everything inside it in one brand and mode. */
export function applyTheme(element: HTMLElement, tokens: BrandTokens, mode: ThemeMode): void {
  for (const name of BRAND_TOKEN_NAMES) element.style.setProperty(name, tokens[name]);
  element.dataset['mode'] = mode;
}
