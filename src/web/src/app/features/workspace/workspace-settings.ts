import type { DialogRef } from '@angular/cdk/dialog';
import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  LOCALE_ID,
  signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import type { DayOfWeek, WorkspaceDetails } from '../../core/api/api.models';
import { FormAttempt } from '../../core/forms/form-attempt';
import type { HoldsUnsavedWork } from '../../core/forms/leave-guard';
import { UnsavedWork } from '../../core/forms/unsaved-work';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button } from '../../ui/button';
import { UiConfirm } from '../../ui/confirm';
import { UiDialog } from '../../ui/dialog';
import { Control, Field } from '../../ui/field';
import { Icon } from '../../ui/icon';
import type { ModalSurface } from '../../ui/modal-surface';
import { type SegmentOption, SegmentedControl } from '../../ui/segmented-control';
import { UiSheet } from '../../ui/sheet';
import { Skeleton } from '../../ui/skeleton';
import { UiToast } from '../../ui/toast';
import { SettingsFrame } from '../settings/settings-frame';
import {
  type CurrencyChoice,
  currencyName,
  draftChanged,
  draftCurrency,
  draftErrors,
  draftFrom,
  searchTimeZones,
  type SpaceDraft,
  type SpaceField,
  timeZoneIds,
  timeZoneOption,
  type TimeZoneOption,
} from './workspace-settings.models';

/**
 * Settings › Name and region (C9, R5.2a): the coaching space's name, the time zone every date rule
 * follows, the first day of its week and the currency new plans start in. The owner's page, as the
 * API is. Leaving with changes asks first (plan §9), as does switching workspace or signing out.
 */
@Component({
  selector: 'app-workspace-settings',
  imports: [Button, Control, Field, Icon, SegmentedControl, SettingsFrame, Skeleton, UiConfirm],
  templateUrl: './workspace-settings.html',
  styleUrl: './workspace-settings.scss',
  host: { '(window:beforeunload)': 'onBeforeUnload($event)' },
})
export class WorkspaceSettings implements HoldsUnsavedWork {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly sheets = inject(UiSheet);
  private readonly dialogs = inject(UiDialog);
  private readonly toast = inject(UiToast);
  private readonly locale = inject(LOCALE_ID);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly zoneSheet = viewChild.required<TemplateRef<unknown>>('zoneSheet');
  private readonly leaveDialog = viewChild.required<TemplateRef<unknown>>('leaveDialog');
  private loadedTenantId: string | null = null;
  private openZones: DialogRef<unknown, ModalSurface> | null = null;

  protected readonly loadingLabel = $localize`Loading your coaching space…`;
  protected readonly closeLabel = $localize`Close`;
  protected readonly leaveMessage = $localize`Your changes to these settings aren’t saved. If you leave now, they are lost.`;
  protected readonly leaveConfirm = $localize`Leave without saving`;
  protected readonly leaveCancel = $localize`Stay`;

  protected readonly workspace = signal<WorkspaceDetails | null>(null);
  protected readonly draft = signal<SpaceDraft | null>(null);
  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);
  protected readonly attempt = new FormAttempt();

  protected readonly weekOptions: readonly SegmentOption[] = [
    { value: 'Monday', label: $localize`Monday` },
    { value: 'Sunday', label: $localize`Sunday` },
    { value: 'Saturday', label: $localize`Saturday` },
  ];
  protected readonly currencyOptions: readonly SegmentOption[] = [
    { value: 'USD', label: $localize`US dollar` },
    { value: 'LBP', label: $localize`Lebanese pound` },
    { value: 'other', label: $localize`Another` },
  ];

  protected readonly dirty = computed(() => {
    const draft = this.draft();
    const workspace = this.workspace();
    return draft !== null && workspace !== null && draftChanged(draft, workspace);
  });
  protected readonly errors = computed(() => {
    const draft = this.draft();
    return draft ? draftErrors(draft) : { name: [], currency: [] };
  });
  protected readonly zone = computed(() => {
    const id = this.draft()?.timeZoneId;
    return id ? timeZoneOption(id, new Date(), this.locale) : null;
  });
  protected readonly currencyLine = computed(() => {
    const draft = this.draft();
    if (!draft) return '';
    const code = draftCurrency(draft);
    if (draft.currencyChoice === 'other' && this.errors().currency.length > 0) return '';
    return $localize`New plans are priced in ${currencyName(code, this.locale)}:currency: (${code}:code:). Plans you already sell keep their own currency, and so do your clients’ plans and payments.`;
  });

  /** The time zone sheet's search and its list, built once per opening. */
  protected readonly zoneQuery = signal('');
  private readonly zoneOptions = signal<readonly TimeZoneOption[]>([]);
  /** With nothing typed, the saved zone leads and every other follows west to east. */
  protected readonly zoneResults = computed(() => {
    const options = this.zoneOptions();
    const query = this.zoneQuery();
    if (query.trim() !== '') return searchTimeZones(options, query).slice(0, 60);
    const saved = this.draft()?.timeZoneId;
    const all = searchTimeZones(options, '');
    return [
      ...all.filter((option) => option.id === saved),
      ...all.filter((option) => option.id !== saved),
    ];
  });
  /** The zone this device is set to, offered first when it differs from the saved one. */
  protected readonly deviceZone = computed(() => {
    let id: string;
    try {
      id = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return null;
    }
    return this.zoneOptions().find((option) => option.id === id) ?? null;
  });

  constructor() {
    const unregister = inject(UnsavedWork).register(this);
    inject(DestroyRef).onDestroy(() => {
      unregister();
      this.openZones?.close();
    });
    this.scope.onReset(() => {
      this.loadedTenantId = null;
      this.openZones?.close();
      this.workspace.set(null);
      this.draft.set(null);
      this.state.set('loading');
      this.saving.set(false);
      this.saveError.set(null);
      this.attempt.reset();
    });
    afterNextRender(() => this.heading()?.nativeElement.focus({ preventScroll: true }));
    effect(() => {
      this.scope.epoch();
      const tenantId = this.tenants.selectedTenantId();
      if (tenantId && tenantId !== this.loadedTenantId) {
        this.loadedTenantId = tenantId;
        void this.load();
      }
    });
  }

  /** Asks before the router, a workspace switch or a sign-out drops changes (plan §9). */
  async canLeave(): Promise<boolean> {
    if (!this.dirty() || this.saving()) return true;
    const dialog = this.dialogs.open<boolean>(this.leaveDialog(), {
      title: $localize`Leave without saving?`,
      closeLabel: this.closeLabel,
      closeOnNavigation: false,
    });
    return (await firstValueFrom(dialog.closed)) === true;
  }

  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.dirty()) {
      event.preventDefault();
      event.returnValue = '';
    }
  }

  protected async load(): Promise<void> {
    return this.scope.run('load', async (owner) => {
      this.state.set('loading');
      try {
        const workspace = await owner.wait(firstValueFrom(this.api.getWorkspace()));
        this.workspace.set(workspace);
        this.draft.set(draftFrom(workspace));
        this.attempt.reset();
        this.state.set('ready');
      } catch {
        if (!owner.current) return;
        this.state.set('error');
      }
    });
  }

  protected set(change: Partial<SpaceDraft>): void {
    this.draft.update((draft) => (draft ? { ...draft, ...change } : draft));
    this.saveError.set(null);
  }

  protected setWeek(value: string): void {
    this.set({ weekStartsOn: value as DayOfWeek });
  }

  protected setCurrency(value: string): void {
    this.set({ currencyChoice: value as CurrencyChoice });
  }

  protected shows(field: SpaceField): boolean {
    return this.attempt.shows(field, this.errors()[field]);
  }

  protected shownErrors(field: SpaceField): readonly string[] | null {
    return this.shows(field) ? this.errors()[field] : null;
  }

  protected discard(): void {
    const workspace = this.workspace();
    if (!workspace) return;
    this.draft.set(draftFrom(workspace));
    this.attempt.reset();
    this.saveError.set(null);
  }

  protected async save(): Promise<void> {
    const draft = this.draft();
    const workspace = this.workspace();
    if (!draft || !workspace || this.saving()) return;
    const errors = this.errors();
    const invalid = (Object.keys(errors) as SpaceField[]).find((key) => errors[key].length > 0);
    if (invalid) {
      this.attempt.attempt();
      // The first field at fault takes focus once its message is on screen (plan §9).
      setTimeout(() => document.getElementById(`space-${invalid}`)?.focus());
      return;
    }
    if (!draftChanged(draft, workspace)) return;

    return this.scope.run('save', async (owner) => {
      this.saving.set(true);
      this.saveError.set(null);
      try {
        await owner.wait(this.csrf.refresh());
        const saved = await owner.wait(
          firstValueFrom(
            this.api.updateWorkspace({
              name: draft.name.trim(),
              timeZoneId: draft.timeZoneId,
              // Kept as it was: emails and invitations exist in English only (see the page's note).
              defaultCulture: workspace.defaultCulture,
              defaultCurrencyCode: draftCurrency(draft),
              weekStartsOn: draft.weekStartsOn,
              version: workspace.version,
            }),
          ),
        );
        this.workspace.set(saved);
        this.draft.set(draftFrom(saved));
        this.attempt.reset();
        // The shell shows the space's name; read the membership list again so it follows.
        await owner.wait(this.tenants.load(saved.id));
        this.toast.show($localize`Settings saved.`, { tone: 'success' });
      } catch (error) {
        if (!owner.current) return;
        this.saveError.set(apiErrorMessage(error, $localize`Your settings couldn’t be saved.`));
      } finally {
        if (owner.current) this.saving.set(false);
      }
    });
  }

  // ---------- the time zone sheet ----------

  protected openTimeZones(): void {
    const draft = this.draft();
    if (!draft) return;
    const now = new Date();
    this.zoneOptions.set(
      timeZoneIds(draft.timeZoneId).map((id) => timeZoneOption(id, now, this.locale)),
    );
    this.zoneQuery.set('');
    this.openZones?.close();
    const sheet = this.sheets.open(this.zoneSheet(), {
      title: $localize`Time zone`,
      closeLabel: this.closeLabel,
      initialFocus: '#zone-search',
    });
    this.openZones = sheet;
    sheet.closed.subscribe(() => {
      if (this.openZones === sheet) this.openZones = null;
    });
  }

  protected chooseZone(id: string): void {
    this.set({ timeZoneId: id });
    this.openZones?.close();
  }

  protected zoneLabel(option: TimeZoneOption): string {
    return option.area ? `${option.city}, ${option.area}` : option.city;
  }
}
