import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  LOCALE_ID,
  output,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthStore } from '../../core/auth/auth.store';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { WorkspaceCalendar } from '../../core/tenancy/workspace-calendar';
import { Avatar } from '../../ui/avatar';
import { Button } from '../../ui/button';
import { Control, Field } from '../../ui/field';
import { Icon } from '../../ui/icon';
import { ModalFooter } from '../../ui/modal-footer';
import { Skeleton } from '../../ui/skeleton';
import {
  type ClientTargetsPick,
  type ClientTargetsRow,
  clientTargetsRow,
  matchesClient,
} from './daily-target.models';
import { MealPlanApi } from './meal-plan-api';

/** Past this many clients the list has a search box. */
const SEARCH_FROM = 6;

/**
 * "Start from a client's targets" (critique B5c2): the coach's own clients whose plan includes
 * Nutrition, the owner's every client (ADR 0026), each with their latest targets. Choosing one puts
 * them in the daily target; nothing changes for the client.
 */
@Component({
  selector: 'app-meal-plan-client-targets',
  imports: [Avatar, Button, Control, Field, Icon, ModalFooter, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="body">
      <p class="muted" i18n>
        Their latest targets go in the daily target. Nothing changes for them.
      </p>
      @switch (state()) {
        @case ('loading') {
          <app-skeleton [label]="loadingLabel" [lines]="4" />
        }
        @case ('error') {
          <div class="failed">
            <p role="alert" i18n>Your clients’ targets could not be loaded.</p>
            <button appButton type="button" variant="outlined" (click)="load()" i18n>
              Try again
            </button>
          </div>
        }
        @default {
          @if (rows().length === 0) {
            <p class="empty" data-empty i18n>
              None of your clients with Nutrition in their plan has targets yet. Work them out on a
              client’s Nutrition tab.
            </p>
          } @else {
            @if (rows().length > searchFrom) {
              <div class="find" role="search" aria-label="Find a client" i18n-aria-label>
                <app-field [label]="searchLabel" hideLabel>
                  <input
                    appControl
                    type="search"
                    name="client-targets-search"
                    autocomplete="off"
                    enterkeyhint="search"
                    [placeholder]="searchPlaceholder"
                    [value]="search()"
                    (input)="search.set($any($event.target).value)"
                  />
                </app-field>
              </div>
            }
            @if (shown().length > 0) {
              <ul class="rows" role="list">
                @for (row of shown(); track row.id) {
                  <li>
                    <button type="button" class="row" (click)="picked.emit(row.pick)">
                      <app-avatar [initials]="row.initials" presentation="client" />
                      <span class="copy">
                        <span class="name" dir="auto">{{ row.name }}</span>
                        <span class="tb-visually-hidden">, {{ row.spoken }}</span>
                        <span class="line" aria-hidden="true">{{ row.macros }}</span>
                        <span class="line when" aria-hidden="true"
                          >{{ row.when }}
                          @if (row.coach; as coach) {
                            · {{ coach }}
                          }
                        </span>
                      </span>
                      <app-icon class="chevron" name="chevron-right" />
                    </button>
                  </li>
                }
              </ul>
            } @else {
              <p class="empty" role="status" i18n>No client called “{{ search().trim() }}”.</p>
            }
            @if (total() > rows().length) {
              <p class="muted" i18n>
                The first {{ rows().length }} of {{ total() }} clients, by name.
              </p>
            }
          }
        }
      }
    </div>
    <ng-template appModalFooter>
      <button appButton type="button" variant="outlined" (click)="cancelled.emit()" i18n>
        Cancel
      </button>
    </ng-template>
  `,
  styles: `
    :host {
      display: block;
    }

    .body {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    p {
      margin: 0;
    }

    .muted,
    .empty {
      color: var(--tb-muted);
      font-size: 0.875rem;
    }

    .failed {
      align-items: flex-start;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .rows {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .row {
      align-items: center;
      background: var(--tb-surface);
      border: 1px solid var(--tb-line-strong);
      border-radius: var(--tb-radius-control);
      color: var(--tb-ink);
      cursor: pointer;
      display: flex;
      font: inherit;
      gap: 0.75rem;
      inline-size: 100%;
      min-block-size: 2.75rem;
      padding: 0.625rem 0.75rem;
      text-align: start;
      touch-action: manipulation;
    }

    .row:hover {
      border-color: var(--tb-ink);
    }

    .row:focus-visible {
      outline: 3px solid var(--tb-focus);
      outline-offset: 2px;
    }

    .copy {
      display: flex;
      flex: 1 1 auto;
      flex-direction: column;
      gap: 0.125rem;
      min-inline-size: 0;
    }

    .name {
      font-weight: 600;
      overflow-wrap: anywhere;
    }

    .line {
      color: var(--tb-muted);
      font-size: 0.875rem;
      font-variant-numeric: tabular-nums;
      overflow-wrap: anywhere;
    }

    .chevron {
      color: var(--tb-muted);
      flex: none;
    }

    :host-context([dir='rtl']) .chevron {
      transform: scaleX(-1);
    }
  `,
})
export class MealPlanClientTargets {
  private readonly api = inject(MealPlanApi);
  private readonly auth = inject(AuthStore);
  private readonly calendar = inject(WorkspaceCalendar);
  private readonly tenants = inject(TenantStore);
  private readonly locale = inject(LOCALE_ID);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());

  /** The client chosen, whose targets go in the daily target. */
  readonly picked = output<ClientTargetsPick>();
  readonly cancelled = output<void>();

  protected readonly loadingLabel = $localize`Loading your clients’ targets…`;
  protected readonly searchLabel = $localize`Find a client`;
  protected readonly searchPlaceholder = $localize`Find a client by name`;
  protected readonly searchFrom = SEARCH_FROM;

  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly rows = signal<readonly ClientTargetsRow[]>([]);
  protected readonly total = signal(0);
  protected readonly search = signal('');
  protected readonly shown = computed(() => {
    const text = this.search().trim();
    return text ? this.rows().filter((row) => matchesClient(row, text)) : this.rows();
  });

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    await this.scope.run('load', async (owner) => {
      this.state.set('loading');
      try {
        const [list, today] = await owner.wait(
          Promise.all([firstValueFrom(this.api.listClientTargets()), this.calendar.resolveToday()]),
        );
        const context = {
          today,
          timeZone: this.calendar.timeZone() ?? 'UTC',
          locale: this.locale,
          userId: this.auth.user()?.id ?? null,
        };
        this.rows.set(list.items.map((item) => clientTargetsRow(item, context)));
        this.total.set(Number(list.total));
        this.state.set('ready');
      } catch {
        if (owner.current) this.state.set('error');
      }
    });
  }
}
