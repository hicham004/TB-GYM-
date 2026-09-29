import { EnvironmentProviders, inject, provideAppInitializer } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { brandPreset } from '../core/theme/brand-theme';
import { isThemeMode, ThemeStore } from '../core/theme/theme.store';

/**
 * Development-only providers, swapped in for dev-providers.ts by the development build
 * configuration.
 *
 * Theme preview: `?brand=forest|navy|charcoal|plum` and `?mode=light|dark|system` on any URL draw
 * the app in that brand and mode, so the UI lab and the browser checks can show every theme before
 * the settings that choose them exist (personal mode in R2.1, coach brand in R3.5). A URL without
 * them leaves the current theme alone, so it survives navigating around the app.
 */
export const devProviders: EnvironmentProviders[] = [
  provideAppInitializer(() => {
    const router = inject(Router);
    const theme = inject(ThemeStore);
    router.events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe(() => {
      const query = router.routerState.snapshot.root.queryParamMap;
      const preset = brandPreset(query.get('brand'));
      if (preset) theme.setBrand(preset);
      const mode = query.get('mode');
      if (isThemeMode(mode)) theme.setMode(mode);
    });
  }),
];
