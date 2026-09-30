import { Component, computed, ElementRef, inject, signal, viewChildren } from '@angular/core';
import { AuthStore } from '../../core/auth/auth.store';
import { type ThemeMode } from '../../core/theme/personal-mode.store';

const modes: readonly { value: ThemeMode; label: string; description: string }[] = [
  {
    value: 'system',
    label: $localize`Use device setting`,
    description: $localize`Switches with your device.`,
  },
  { value: 'light', label: $localize`Light`, description: $localize`A bright, warm view.` },
  { value: 'dark', label: $localize`Dark`, description: $localize`A quieter view for low light.` },
];

@Component({
  selector: 'app-account-appearance',
  templateUrl: './account-appearance.html',
  styleUrl: './account-appearance.scss',
  host: { class: 'tb-theme' },
})
export class AccountAppearance {
  private readonly auth = inject(AuthStore);
  protected readonly modes = modes;
  private readonly modeInputs = viewChildren<ElementRef<HTMLInputElement>>('modeInput');
  protected readonly selected = computed(() => this.auth.user()?.preferredThemeMode ?? 'system');
  protected readonly saving = signal(false);
  protected readonly error = signal(false);

  protected async choose(mode: ThemeMode): Promise<void> {
    if (this.saving() || mode === this.selected()) return;
    this.saving.set(true);
    this.error.set(false);
    try {
      await this.auth.updateThemeMode(mode);
    } catch {
      this.error.set(true);
      for (const input of this.modeInputs()) {
        input.nativeElement.checked = input.nativeElement.value === this.selected();
      }
    } finally {
      this.saving.set(false);
    }
  }
}
