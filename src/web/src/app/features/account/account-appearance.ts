import { Component, computed, ElementRef, inject, signal, viewChildren } from '@angular/core';
import { AuthStore } from '../../core/auth/auth.store';
import { type ThemeMode } from '../../core/theme/personal-mode.store';
import { ThemeModeSaver } from '../../shell/theme-mode-saver';
import { SettingsFrame } from '../settings/settings-frame';

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
  imports: [SettingsFrame],
  templateUrl: './account-appearance.html',
  styleUrl: './account-appearance.scss',
})
export class AccountAppearance {
  private readonly auth = inject(AuthStore);
  // The Dark mode switch's saver, so a press still waiting there is never saved after this choice.
  private readonly saver = inject(ThemeModeSaver);
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
      await this.saver.save(mode);
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
