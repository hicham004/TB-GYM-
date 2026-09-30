import { DOCUMENT } from '@angular/common';
import { effect, inject, Injectable, signal } from '@angular/core';

export type ThemeMode = 'light' | 'dark' | 'system';

export function isThemeMode(value: string | null | undefined): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system';
}

@Injectable({ providedIn: 'root' })
export class PersonalModeStore {
  private readonly root = inject(DOCUMENT).documentElement;
  private readonly state = signal<ThemeMode>('system');
  readonly mode = this.state.asReadonly();

  constructor() {
    effect(() => {
      this.root.dataset['mode'] = this.state();
    });
  }

  setMode(mode: ThemeMode): void {
    this.state.set(mode);
  }
}
