import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Loading placeholder announced once, with decorative bars hidden from assistive technology. */
@Component({
  selector: 'app-skeleton',
  template: `
    <span class="sr-only">{{ label() }}</span>
    <span class="layout" aria-hidden="true">
      @if (avatar()) {
        <span class="avatar"></span>
      }
      <span class="lines">
        @for (line of lineItems(); track line) {
          <span class="line" [class.last]="$last"></span>
        }
      </span>
    </span>
  `,
  styles: `
    :host {
      display: block;
      min-inline-size: 0;
    }
    .layout {
      align-items: center;
      display: flex;
      gap: var(--space-12);
    }
    .avatar,
    .line {
      animation: shimmer 1.4s ease-in-out infinite alternate;
      background: var(--tb-surface-2);
      display: block;
    }
    .avatar {
      block-size: 40px;
      border-radius: 50%;
      flex: none;
      inline-size: 40px;
    }
    .lines {
      display: grid;
      flex: 1;
      gap: var(--space-8);
      min-inline-size: 0;
    }
    .line {
      block-size: 12px;
      border-radius: 6px;
      inline-size: 100%;
    }
    .line.last {
      inline-size: 64%;
    }
    .sr-only {
      block-size: 1px;
      clip-path: inset(50%);
      inline-size: 1px;
      overflow: hidden;
      position: absolute;
      white-space: nowrap;
    }
    @keyframes shimmer {
      to {
        opacity: 0.45;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .avatar,
      .line {
        animation: none;
      }
    }
    @media (forced-colors: active) {
      .avatar,
      .line {
        border: 1px solid CanvasText;
      }
    }
  `,
  host: { role: 'status' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Skeleton {
  readonly label = input.required<string>();
  readonly lines = input(2);
  readonly avatar = input(false);
  protected readonly lineItems = computed(() =>
    Array.from({ length: Math.max(1, Math.min(6, Math.floor(this.lines()))) }, (_, index) => index),
  );
}
