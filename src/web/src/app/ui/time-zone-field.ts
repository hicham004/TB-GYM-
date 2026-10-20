import type { DialogRef } from '@angular/cdk/dialog';
import {
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  LOCALE_ID,
  model,
  signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import {
  deviceTimeZoneId,
  searchTimeZones,
  timeZoneIds,
  timeZoneOption,
  type TimeZoneOption,
  zoneLabel,
} from '../core/i18n/time-zones';
import { Button } from './button';
import { Control, Field } from './field';
import { Icon } from './icon';
import type { ModalSurface } from './modal-surface';
import { UiSheet } from './sheet';

let nextZoneFieldId = 0;

/**
 * A coaching space's time zone, chosen by city (R5.2a's Settings › Name and region, and registration
 * since audit AUTH-5): the zone in words with its offset and the time there now, and a Change button
 * whose sheet searches every zone by city, area or offset, offering this device's zone first. The page
 * projects the line that says what the zone governs.
 */
@Component({
  selector: 'app-time-zone-field',
  imports: [Button, Control, Field, Icon],
  template: `
    <div class="zone-row">
      <div class="zone-text">
        <p class="row-label" [id]="labelId" i18n>Time zone</p>
        @if (zone(); as tz) {
          <p class="zone-value" data-zone>
            <strong>{{ label(tz) }}</strong
            >&ngsp;
            <span class="zone-meta">{{ tz.offset }} · {{ tz.now }}</span>
          </p>
        }
        <ng-content />
      </div>
      <button
        appButton
        type="button"
        variant="outlined"
        [attr.aria-describedby]="labelId"
        (click)="openSheet()"
        i18n
      >
        Change
      </button>
    </div>

    <ng-template #sheet>
      <div class="zones">
        <app-field label="Search by city" i18n-label>
          <input
            appControl
            id="zone-search"
            name="zone-search"
            type="search"
            autocomplete="off"
            spellcheck="false"
            [value]="query()"
            (input)="query.set($any($event.target).value)"
          />
        </app-field>
        @if (deviceZone(); as device) {
          @if (device.id !== zoneId() && query() === '') {
            <button class="device" type="button" (click)="choose(device.id)" data-device-zone>
              <span i18n>Use this device’s time zone: {{ label(device) }}</span>
            </button>
          }
        }
        <p class="tb-visually-hidden" role="status">
          @if (query() !== '') {
            <ng-container i18n>{results().length, plural,
              =0 {No time zone matches}
              =1 {1 time zone matches}
              other {{{ results().length }} time zones match}
            }</ng-container>
          }
        </p>
        @if (results().length === 0) {
          <p class="none" i18n>No time zone matches “{{ query() }}”. Try the nearest big city.</p>
        }
        <ul class="zone-list" role="list" tabindex="-1">
          @for (option of results(); track option.id) {
            <li>
              <button
                type="button"
                class="zone-option"
                [class.chosen]="option.id === zoneId()"
                [attr.aria-current]="option.id === zoneId() ? 'true' : null"
                (click)="choose(option.id)"
              >
                <span class="zone-name">
                  <strong>{{ option.city }}</strong>
                  @if (option.area) {
                    &ngsp;<span class="zone-area">{{ option.area }}</span>
                  }
                </span>
                &ngsp;<span class="zone-offset">{{ option.offset }} · {{ option.now }}</span>
                @if (option.id === zoneId()) {
                  <app-icon name="check-circle" class="zone-check" />
                }
              </button>
            </li>
          }
        </ul>
      </div>
    </ng-template>
  `,
  styles: `
    :host {
      display: block;
    }

    .row-label {
      color: var(--tb-muted);
      font-size: 0.8125rem;
      font-weight: 600;
      margin: 0;
    }

    .zone-row {
      align-items: flex-start;
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem 1rem;
      justify-content: space-between;
    }

    .zone-text {
      display: flex;
      flex: 1 1 18rem;
      flex-direction: column;
      gap: 0.25rem;
      min-inline-size: 0;
    }

    .zone-value {
      align-items: baseline;
      color: var(--tb-ink);
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem 0.625rem;
      margin: 0;

      strong {
        font-size: 1.0625rem;
        font-weight: 600;
      }
    }

    .zone-meta {
      color: var(--tb-muted);
      font-size: 0.875rem;
      font-variant-numeric: tabular-nums;
    }

    // ---------- the sheet ----------

    .zones {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .device {
      align-items: center;
      background: var(--tb-accent-soft);
      border: 1px solid var(--tb-line);
      border-radius: var(--tb-radius-control);
      color: var(--tb-ink);
      cursor: pointer;
      display: flex;
      font: inherit;
      font-weight: 600;
      gap: 0.5rem;
      min-block-size: 2.75rem;
      padding: 0.5rem 0.75rem;
      text-align: start;

      &:focus-visible {
        outline: 3px solid var(--tb-focus);
        outline-offset: 2px;
      }
    }

    .none {
      color: var(--tb-muted);
      font-size: 0.875rem;
      margin: 0;
      padding-block: 0.5rem;
    }

    .zone-list {
      display: flex;
      flex-direction: column;
      list-style: none;
      margin: 0;
      padding: 0;

      // Up to every zone (about 420) with nothing typed: rows off screen are not laid out.
      li {
        contain-intrinsic-size: auto 3rem;
        content-visibility: auto;
      }
    }

    .zone-option {
      align-items: center;
      background: none;
      border: 0;
      border-block-end: 1px solid var(--tb-line);
      color: var(--tb-ink);
      cursor: pointer;
      display: grid;
      font: inherit;
      gap: 0.125rem 0.75rem;
      grid-template-columns: minmax(0, 1fr) auto 1.25rem;
      inline-size: 100%;
      min-block-size: 3rem;
      padding: 0.5rem 0.25rem;
      text-align: start;

      &:hover {
        background: var(--tb-surface-2);
      }

      &:focus-visible {
        outline: 3px solid var(--tb-focus);
        outline-offset: -3px;
      }

      &.chosen {
        font-weight: 600;
      }
    }

    .zone-name {
      align-items: baseline;
      display: flex;
      flex-wrap: wrap;
      gap: 0 0.5rem;
      min-inline-size: 0;

      strong {
        font-weight: 600;
      }
    }

    .zone-area {
      color: var(--tb-muted);
      font-size: 0.8125rem;
    }

    .zone-offset {
      color: var(--tb-muted);
      font-size: 0.8125rem;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    .zone-check {
      color: var(--tb-accent-ink);
      grid-column: 3;
    }
  `,
})
export class TimeZoneField {
  /** The IANA id chosen, "Asia/Beirut". */
  readonly zoneId = model.required<string>();
  /** The sheet's mode, for a page that is always one mode (the signed-out pages are light). */
  readonly sheetMode = input<'light' | 'dark' | undefined>(undefined);

  private readonly sheets = inject(UiSheet);
  private readonly locale = inject(LOCALE_ID);
  private readonly sheet = viewChild.required<TemplateRef<unknown>>('sheet');
  private openSheetRef: DialogRef<unknown, ModalSurface> | null = null;

  protected readonly labelId = `tb-zone-label-${++nextZoneFieldId}`;
  protected readonly label = zoneLabel;
  protected readonly zone = computed(() => {
    const id = this.zoneId();
    return id ? timeZoneOption(id, new Date(), this.locale) : null;
  });

  /** The sheet's search and its list, built once per opening. */
  protected readonly query = signal('');
  private readonly options = signal<readonly TimeZoneOption[]>([]);
  /** With nothing typed, the chosen zone leads and every other follows west to east. */
  protected readonly results = computed(() => {
    const options = this.options();
    const query = this.query();
    if (query.trim() !== '') return searchTimeZones(options, query).slice(0, 60);
    const chosen = this.zoneId();
    const all = searchTimeZones(options, '');
    return [
      ...all.filter((option) => option.id === chosen),
      ...all.filter((option) => option.id !== chosen),
    ];
  });
  /** The zone this device is set to, offered first when it differs from the chosen one. */
  protected readonly deviceZone = computed(() => {
    const id = deviceTimeZoneId();
    return id ? (this.options().find((option) => option.id === id) ?? null) : null;
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.openSheetRef?.close());
  }

  protected openSheet(): void {
    const now = new Date();
    this.options.set(timeZoneIds(this.zoneId()).map((id) => timeZoneOption(id, now, this.locale)));
    this.query.set('');
    this.openSheetRef?.close();
    const sheet = this.sheets.open(this.sheet(), {
      title: $localize`Time zone`,
      closeLabel: $localize`Close`,
      initialFocus: '#zone-search',
      mode: this.sheetMode(),
    });
    this.openSheetRef = sheet;
    sheet.closed.subscribe(() => {
      if (this.openSheetRef === sheet) this.openSheetRef = null;
    });
  }

  protected choose(id: string): void {
    this.zoneId.set(id);
    this.openSheetRef?.close();
  }
}
