import { NgTemplateOutlet } from '@angular/common';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  TemplateRef,
  ViewEncapsulation,
} from '@angular/core';
import { IconButton } from './button';

export type ModalDirection = 'ltr' | 'rtl';

export interface ModalOptions {
  /** Visible heading and accessible dialog name. */
  title: string;
  direction?: ModalDirection;
  closeLabel?: string;
}

export interface ModalData {
  content: TemplateRef<unknown>;
  title: string;
  titleId: string;
  closeLabel: string;
}

/** Content shell shared by the centred dialog and the mobile bottom sheet. */
@Component({
  selector: 'app-modal-surface',
  imports: [IconButton, NgTemplateOutlet],
  template: `
    <header class="tb-modal__header">
      <h2 class="tb-modal__title" [id]="data.titleId">{{ data.title }}</h2>
      <button appIconButton type="button" [label]="data.closeLabel" (click)="dialogRef.close()">
        <span aria-hidden="true">&times;</span>
      </button>
    </header>
    <div class="tb-modal__body">
      <ng-container
        [ngTemplateOutlet]="data.content"
        [ngTemplateOutletContext]="{ $implicit: dialogRef }"
      />
    </div>
  `,
  styleUrl: './overlay-base.scss',
  styles: `
    .tb-modal-backdrop {
      background: color-mix(in srgb, var(--tb-night) 56%, transparent);
      transition-duration: var(--tb-duration);
      transition-timing-function: var(--tb-ease);
    }

    .tb-modal-pane app-modal-surface {
      background: var(--tb-surface);
      border: 1px solid var(--tb-line);
      border-radius: var(--tb-radius-card);
      box-shadow: var(--tb-shadow-overlay);
      box-sizing: border-box;
      color: var(--tb-ink);
      display: flex;
      flex-direction: column;
      font-family: var(--font-sans);
      font-size: var(--text-body-size);
      inline-size: 100%;
      line-height: var(--text-body-line-height);
      max-block-size: calc(100dvh - 2rem);
      min-inline-size: 0;
      overflow: hidden;
      animation: tb-modal-enter var(--tb-duration) var(--tb-ease) both;
    }

    .tb-modal-pane--sheet app-modal-surface {
      border-block-end: 0;
      border-end-end-radius: 0;
      border-end-start-radius: 0;
      max-block-size: min(90dvh, 52rem);
      padding-block-end: env(safe-area-inset-bottom);
      animation-name: tb-sheet-enter;
    }

    .tb-modal__header {
      align-items: start;
      border-block-end: 1px solid var(--tb-line);
      display: flex;
      flex: none;
      gap: 1rem;
      justify-content: space-between;
      padding-block: 1rem;
      padding-inline: 1.5rem;
    }

    .tb-modal__title {
      font-size: var(--text-section-title-size);
      font-weight: var(--font-weight-strong);
      line-height: var(--text-section-title-line-height);
      margin: 0;
      min-inline-size: 0;
      overflow-wrap: anywhere;
      padding-block: 0.25rem;
    }

    .tb-modal__body {
      min-block-size: 0;
      overflow: auto;
      overscroll-behavior: contain;
      padding: 1.5rem;
    }

    .tb-modal-pane :is(button, a, input, select, textarea, [tabindex]):focus-visible {
      outline: var(--focus-ring-width) solid var(--tb-focus);
      outline-offset: var(--focus-separation-gap);
    }

    @keyframes tb-modal-enter {
      from {
        opacity: 0;
        transform: translateY(0.5rem) scale(0.98);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    @keyframes tb-sheet-enter {
      from {
        opacity: 0;
        transform: translateY(1rem);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .tb-modal-pane app-modal-surface {
        animation: none;
      }
      .tb-modal-backdrop {
        transition: none;
      }
    }

    @media (forced-colors: active) {
      .tb-modal-pane app-modal-surface {
        border-color: CanvasText;
      }
    }
  `,
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ModalSurface {
  protected readonly data = inject<ModalData>(DIALOG_DATA);
  protected readonly dialogRef = inject<DialogRef<unknown>>(DialogRef);
}

/** A lab-local `dir` also governs a surface portalled to the document body. */
export function modalDirection(document: Document, requested?: ModalDirection): ModalDirection {
  if (requested) return requested;
  const focused = document.activeElement?.closest('[dir]');
  return focused?.getAttribute('dir') === 'rtl' || document.documentElement.dir === 'rtl'
    ? 'rtl'
    : 'ltr';
}
