import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Checkbox } from '../../ui/checkbox';
import { Control } from '../../ui/field';
import type { LegalToAccept } from './legal.models';

/**
 * The legal documents a person ticks to join (audit INV-3): one box per document in force for them, its
 * sentence the published version's own words, and a link that opens the text in a new tab so nothing
 * typed in the form is lost. Shown only when a document is published. It decides nothing: the page sends
 * what was ticked and the server refuses a submit that leaves a document out.
 */
@Component({
  selector: 'app-legal-acceptance',
  imports: [Checkbox, Control],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <fieldset class="legal" data-legal>
      <legend i18n>Legal documents</legend>
      <p class="hint" i18n>Read each one before you tick its box. Each opens in a new tab.</p>
      @for (document of documents(); track document.id) {
        <div class="item" [attr.data-legal-document]="document.kind">
          <app-checkbox [label]="document.statement">
            <input
              type="checkbox"
              appControl
              [id]="'legal-' + document.id"
              [checked]="accepted().has(document.id)"
              [markInvalid]="shows(document)"
              [aria-describedby]="describedBy(document)"
              (change)="toggled.emit({ id: document.id, checked: $any($event.target).checked })"
            />
          </app-checkbox>
          <a
            class="read"
            [id]="'legal-read-' + document.id"
            [href]="document.link"
            target="_blank"
            rel="noopener"
            ><ng-container i18n
              >Read the {{ document.name }} (version {{ document.version }})</ng-container
            ><span class="tb-visually-hidden" i18n>, opens in a new tab</span></a
          >
          @if (shows(document)) {
            <p class="reason" [id]="'legal-reason-' + document.id" i18n>
              Tick this box to continue.
            </p>
          }
        </div>
      }
    </fieldset>
  `,
  styles: `
    :host {
      display: block;
    }

    .legal {
      border: 0;
      border-block-start: 1px solid var(--home-line);
      display: grid;
      gap: var(--space-16);
      margin: 0;
      min-inline-size: 0;
      padding: var(--space-24) 0 0;
    }

    legend {
      float: inline-start;
      font-size: var(--text-compact-size);
      font-weight: var(--font-weight-strong);
      inline-size: 100%;
      line-height: var(--text-compact-line-height);
      padding: 0;
    }

    .hint,
    .reason {
      font-size: var(--text-compact-size);
      line-height: var(--text-compact-line-height);
      margin: 0;
    }

    .hint {
      color: var(--home-muted);
    }

    .reason {
      color: var(--color-danger);
      font-weight: var(--font-weight-strong);
    }

    .item {
      display: grid;
      gap: var(--space-4);
    }

    .read {
      border-radius: var(--radius-4);
      color: var(--home-forest);
      font-size: var(--text-compact-size);
      font-weight: var(--font-weight-strong);
      justify-self: start;
      line-height: var(--text-compact-line-height);
      margin-inline-start: calc(16px + var(--space-8));
      // A target of its own beside the box: at least 24px tall.
      min-block-size: 1.5rem;
      overflow-wrap: anywhere;
      padding-block: 0.125rem;
      text-decoration-thickness: 1px;
      text-underline-offset: 3px;
    }

    .read:hover {
      text-decoration-thickness: 2px;
    }

    .read:focus-visible {
      outline: var(--focus-ring-width) solid var(--color-accent);
      outline-offset: var(--focus-separation-gap);
    }

    .reason {
      margin-inline-start: calc(16px + var(--space-8));
    }
  `,
})
export class LegalAcceptance {
  readonly documents = input.required<readonly LegalToAccept[]>();
  readonly accepted = input.required<ReadonlySet<string>>();
  /** A submit was refused: each box still to tick says so under it. */
  readonly showReasons = input(false);
  readonly toggled = output<{ id: string; checked: boolean }>();

  protected shows(document: LegalToAccept): boolean {
    return this.showReasons() && !this.accepted().has(document.id);
  }

  protected describedBy(document: LegalToAccept): string {
    const read = `legal-read-${document.id}`;
    return this.shows(document) ? `legal-reason-${document.id} ${read}` : read;
  }
}
