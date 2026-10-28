import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  contentChild,
  Directive,
  inject,
  input,
  model,
  signal,
  TemplateRef,
} from '@angular/core';
import { Icon } from './icon';

/** What a fold holds: made the first time the fold opens, then kept while it closes and opens again. */
@Directive({ selector: 'ng-template[appDisclosureContent]' })
export class UiDisclosureContent {
  readonly template = inject<TemplateRef<unknown>>(TemplateRef);
}

/**
 * The kit's fold (critique B2b), one look for every fold: a native `<details>`, so the keyboard and
 * screen readers get the browser's own disclosure. Its row names it (the label, an optional hint and
 * count) and ends with the kit's chevron, turned over while open; the browser's own triangle is
 * hidden in every engine, since a row with none reads as static text. The content is written as
 * `<ng-template appDisclosureContent>` and made on first open, so a closed fold draws and loads
 * nothing. `variant="panel"` draws it as a card whose body opens under a hairline.
 */
@Component({
  selector: 'app-disclosure',
  imports: [Icon, NgTemplateOutlet],
  template: `
    <details [open]="open()" (toggle)="toggled($event)">
      <!-- The spaces keep the row's words apart where it is read as one line ("Earlier maxes 3"). -->
      <summary>
        <!-- A label or hint can carry a coach's own words (a session's name), in either script. -->
        <span class="text">
          <span class="label" dir="auto">{{ label() }}</span>
          @if (hint()) {
            &ngsp;<span class="hint" dir="auto">{{ hint() }}</span>
          }
        </span>
        @if (count() !== null) {
          &ngsp;<span class="count">{{ count() }}</span>
        }
        <app-icon class="chevron" name="chevron-down" />
      </summary>
      @if (made()) {
        <div class="body">
          <ng-container [ngTemplateOutlet]="content()?.template ?? null" />
        </div>
      }
    </details>
  `,
  styles: `
    :host {
      display: block;
      min-inline-size: 0;
    }

    // The row bleeds into the space around it, so its label lines up with the text above and below
    // while the hover fill still has room.
    summary {
      align-items: center;
      border-radius: var(--tb-radius-control);
      box-sizing: border-box;
      color: var(--tb-ink);
      cursor: pointer;
      display: flex;
      gap: var(--space-12);
      // The browser's triangle is a list item's marker in Chromium and Firefox, its own box in Safari.
      list-style: none;
      margin-inline: calc(var(--space-8) * -1);
      min-block-size: 44px;
      padding: var(--space-8);
      -webkit-tap-highlight-color: transparent;
    }

    summary::-webkit-details-marker {
      display: none;
    }

    // Inside the row, so no scrolling box or card around the fold can clip it.
    summary:focus-visible {
      outline: var(--focus-ring-width) solid var(--tb-focus);
      outline-offset: calc(var(--focus-ring-width) * -1);
    }

    @media (hover: hover) {
      summary:hover {
        background-color: var(--tb-surface-2);
      }
    }

    .text {
      display: flex;
      flex: 1 1 auto;
      flex-direction: column;
      gap: 2px;
      min-inline-size: 0;
    }

    .label {
      font-weight: var(--font-weight-strong);
      overflow-wrap: anywhere;
    }

    .hint {
      color: var(--tb-muted);
      font-size: var(--text-compact-size);
      line-height: var(--text-compact-line-height);
      overflow-wrap: anywhere;
    }

    .count {
      background-color: var(--tb-surface-2);
      border-radius: var(--radius-full);
      box-sizing: border-box;
      color: var(--tb-muted);
      flex: none;
      font-size: var(--text-metadata-size);
      font-variant-numeric: tabular-nums;
      font-weight: var(--font-weight-strong);
      line-height: var(--text-metadata-line-height);
      min-inline-size: 24px;
      padding: 2px var(--space-8);
      text-align: center;
    }

    summary:hover .count {
      background-color: var(--tb-surface);
    }

    .chevron {
      color: var(--tb-muted);
      flex: none;
    }

    details[open] > summary .chevron {
      rotate: 180deg;
    }

    @media (prefers-reduced-motion: no-preference) {
      .chevron {
        transition: rotate var(--tb-duration) var(--tb-ease);
      }
    }

    .body {
      min-inline-size: 0;
      padding-block-start: var(--space-8);
    }

    :host(.panel) details {
      background-color: var(--tb-surface);
      border: 1px solid var(--tb-line);
      border-radius: var(--tb-radius-card);
      box-shadow: var(--tb-shadow-card);
      overflow: hidden;
    }

    :host(.panel) summary {
      border-radius: 0;
      margin-inline: 0;
      // The kit card's inner padding (ui/card.ts).
      padding: var(--space-12) var(--space-20, 20px);
    }

    :host(.panel) .body {
      border-block-start: 1px solid var(--tb-line);
      padding: var(--space-16) var(--space-20, 20px) var(--space-20, 20px);
    }

    // Fills are dropped in forced colours; a border keeps the row's edge where the hover fill was.
    @media (forced-colors: active) {
      summary:hover {
        outline: 1px solid CanvasText;
      }
    }
  `,
  host: { '[class.panel]': "variant() === 'panel'" },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UiDisclosure {
  readonly label = input.required<string>();
  /** A second, quieter line under the label: what is inside, or the setting chosen now. */
  readonly hint = input<string | null>(null);
  readonly count = input<number | null>(null);
  readonly variant = input<'plain' | 'panel'>('plain');
  /** Two-way, so a screen can open the fold (a refused field inside it) and hear when a person does. */
  readonly open = model(false);

  protected readonly content = contentChild(UiDisclosureContent);
  private readonly opened = signal(false);
  protected readonly made = computed(() => this.opened() || this.open());

  protected toggled(event: Event): void {
    const open = (event.target as HTMLDetailsElement).open;
    if (open) this.opened.set(true);
    this.open.set(open);
  }
}
