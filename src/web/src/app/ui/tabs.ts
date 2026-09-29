import { NgTemplateOutlet } from '@angular/common';
import { Tab, TabContent, TabList, TabPanel, Tabs } from '@angular/aria/tabs';
import {
  ChangeDetectionStrategy,
  Component,
  Directive,
  TemplateRef,
  contentChildren,
  inject,
  input,
  model,
} from '@angular/core';

/** Content owned by one tab. Labels stay visible even when a panel has not rendered yet. */
@Directive({ selector: 'ng-template[appTabPane]' })
export class UiTabPane {
  readonly value = input.required<string>();
  readonly label = input.required<string>();
  readonly disabled = input(false);
  readonly template = inject<TemplateRef<unknown>>(TemplateRef);
}

/** Local panels, not route navigation. Angular Aria owns selection, focus and RTL key behavior. */
@Component({
  selector: 'app-tabs',
  imports: [NgTemplateOutlet, Tab, TabContent, TabList, TabPanel, Tabs],
  template: `
    <div ngTabs>
      <div class="tab-list" ngTabList [(selectedTab)]="selected" selectionMode="follow">
        @for (pane of panes(); track pane.value()) {
          <button type="button" ngTab [value]="pane.value()" [disabled]="pane.disabled()">
            {{ pane.label() }}
          </button>
        }
      </div>
      @for (pane of panes(); track pane.value()) {
        <div class="tab-panel" ngTabPanel [value]="pane.value()">
          <ng-template ngTabContent>
            <ng-container [ngTemplateOutlet]="pane.template" />
          </ng-template>
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-inline-size: 0;
    }

    .tab-list {
      border-block-end: 1px solid var(--tb-line);
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-24);
      max-inline-size: 100%;
      padding-inline: var(--space-4);
    }

    [ngTab] {
      background: transparent;
      border: 0;
      border-block-end: 3px solid transparent;
      color: var(--tb-muted);
      cursor: pointer;
      flex: 1 1 auto;
      font: inherit;
      font-weight: 600;
      min-block-size: 44px;
      padding: var(--space-8) var(--space-4);
    }

    [ngTab][aria-selected='true'] {
      border-block-end-color: var(--tb-accent-ink);
      color: var(--tb-ink);
    }

    [ngTab]:focus-visible {
      border-radius: var(--tb-radius-control);
      outline: 3px solid var(--tb-focus);
      outline-offset: -3px;
    }

    [ngTab]:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }

    .tab-panel {
      min-inline-size: 0;
      padding-block: var(--space-16);
    }

    .tab-panel[inert] {
      display: none;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UiTabs {
  protected readonly panes = contentChildren(UiTabPane);
  readonly selected = model<string | undefined>(undefined);
}
