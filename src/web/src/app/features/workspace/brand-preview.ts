import { Component, effect, ElementRef, inject, input } from '@angular/core';
import { type BrandColors, brandTokens } from '../../core/theme/brand-theme';
import { applyTheme } from '../../core/theme/theme.store';
import { Icon } from '../../ui/icon';

/**
 * A picture of the coach's sidebar and a client's Today in a brand that is not saved yet (R3.5a).
 * It wears its own brand and mode, derived exactly as the app derives them, while the page around it
 * keeps the saved brand. Decorative: the page says in words what it shows.
 */
@Component({
  selector: 'app-brand-preview',
  imports: [Icon],
  templateUrl: './brand-preview.html',
  styleUrl: './brand-preview.scss',
  host: { 'aria-hidden': 'true' },
})
export class BrandPreview {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly colors = input.required<BrandColors>();
  readonly mode = input<'light' | 'dark'>('light');
  readonly name = input.required<string>();
  readonly initials = input.required<string>();
  readonly logoUrl = input<string | null>(null);

  constructor() {
    effect(() => applyTheme(this.host.nativeElement, brandTokens(this.colors()), this.mode()));
  }
}
