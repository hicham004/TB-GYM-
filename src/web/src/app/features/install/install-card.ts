import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { InstallPrompt } from '../../core/pwa/install-prompt';
import { Button } from '../../ui/button';
import { Icon } from '../../ui/icon';

let nextId = 0;

/**
 * The offer to put TB Gym on the home screen (R2.5c), drawn only where the browser can do it: an
 * Install button where it installs on request, and the Share-menu steps on an iPhone or iPad.
 * Nothing is drawn in an installed app or a browser that cannot install.
 *
 * `card` (the Me page) is always open to the offer. `banner` (Today) can be dismissed with "Not now"
 * and then stays away for a month, so it never nags.
 */
@Component({
  selector: 'app-install-card',
  imports: [Button, Icon],
  templateUrl: './install-card.html',
  styleUrl: './install-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InstallCard {
  readonly variant = input<'card' | 'banner'>('card');

  private readonly prompt = inject(InstallPrompt);
  protected readonly titleId = `install-title-${++nextId}`;
  protected readonly installing = signal(false);
  protected readonly offer = computed(() =>
    this.variant() === 'banner' ? this.prompt.bannerOffer() : this.prompt.offer(),
  );

  protected async install(): Promise<void> {
    this.installing.set(true);
    try {
      await this.prompt.install();
    } finally {
      this.installing.set(false);
    }
  }

  protected dismiss(): void {
    this.prompt.dismissBanner();
  }
}
