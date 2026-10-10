import { DOCUMENT } from '@angular/common';
import {
  afterNextRender,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import type { WorkspaceDetails } from '../../core/api/api.models';
import { FormAttempt } from '../../core/forms/form-attempt';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { BRAND_PRESETS, type BrandColors, TB_GYM_BRAND } from '../../core/theme/brand-theme';
import { PersonalModeStore } from '../../core/theme/personal-mode.store';
import { initialsOf } from '../../shell/initials';
import { Button } from '../../ui/button';
import { Control, Field } from '../../ui/field';
import { SegmentedControl } from '../../ui/segmented-control';
import { Skeleton } from '../../ui/skeleton';
import { UiToast } from '../../ui/toast';
import { BrandPreview } from './brand-preview';
import { SettingsFrame } from '../settings/settings-frame';
import { WorkspaceBrandApi } from './workspace-brand-api';
import {
  type BrandChoice,
  brandChanged,
  brandSaveError,
  choiceFor,
  contrastNotes,
  LOGO_TYPES,
  logoFileProblem,
  logoUploadError,
  normalizeHex,
} from './workspace-brand.models';

interface DraftLogo {
  readonly assetId: string;
  readonly url: string | null;
}

/**
 * The coach's brand (R3.5a, plan §3.1): a look from the four presets or their own two colours, and
 * a logo, with a preview of both the coach's and the client's screens before saving. The colours
 * are stored as picked; the app derives readable tones from them wherever they are drawn, and says
 * here when it had to adjust one.
 */
@Component({
  selector: 'app-workspace-brand',
  imports: [BrandPreview, Button, Control, Field, SettingsFrame, SegmentedControl, Skeleton],
  templateUrl: './workspace-brand.html',
  styleUrl: './workspace-brand.scss',
  host: {
    class: 'tb-theme',
    '(window:beforeunload)': 'warnBeforeLeaving($event)',
  },
})
export class WorkspaceBrand {
  private readonly api = inject(ApiClient);
  private readonly brandApi = inject(WorkspaceBrandApi);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly toast = inject(UiToast);
  private readonly document = inject(DOCUMENT);
  private readonly personalMode = inject(PersonalModeStore);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private loadedTenantId: string | null = null;

  protected readonly presets = BRAND_PRESETS;
  protected readonly logoTypes = LOGO_TYPES.join(',');
  protected readonly modeOptions = [
    { value: 'light', label: $localize`Light` },
    { value: 'dark', label: $localize`Dark` },
  ];
  protected readonly brandLabel = $localize`Brand colour`;
  protected readonly brandHelp = $localize`The sidebar, workout cards and dark screens.`;
  protected readonly accentLabel = $localize`Accent colour`;
  protected readonly accentHelp = $localize`Buttons on your colour, progress rings and achievements.`;

  protected readonly workspace = signal<WorkspaceDetails | null>(null);
  protected readonly loadFailed = signal(false);
  protected readonly choice = signal<BrandChoice>('forest');
  protected readonly brandText = signal(TB_GYM_BRAND.brand);
  protected readonly accentText = signal(TB_GYM_BRAND.accent);
  protected readonly logo = signal<DraftLogo | null>(null);
  /** The preview starts in the mode the owner is looking at the page in. */
  protected readonly previewMode = signal<string>(this.startingMode());
  protected readonly uploading = signal(false);
  protected readonly logoError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);
  /** Said politely once a new logo is ready, since the page itself barely moves. */
  protected readonly logoStatus = signal('');
  protected readonly attempt = new FormAttempt();

  protected readonly brandColor = computed(() => normalizeHex(this.brandText()));
  protected readonly accentColor = computed(() => normalizeHex(this.accentText()));

  /** The colours as they would be saved; an unfinished custom colour keeps the last good one. */
  protected readonly colors = computed<BrandColors>(() => {
    const choice = this.choice();
    if (choice !== 'custom') {
      const preset = BRAND_PRESETS.find((item) => item.id === choice) ?? BRAND_PRESETS[0];
      return { brand: preset.brand, accent: preset.accent };
    }
    return {
      brand: this.brandColor() ?? this.lastGood.brand,
      accent: this.accentColor() ?? this.lastGood.accent,
    };
  });

  protected readonly notes = computed(() => contrastNotes(this.colors()));
  protected readonly name = computed(() => this.workspace()?.name ?? '');
  protected readonly initials = computed(() => initialsOf(this.name() || 'TB Gym'));

  protected readonly brandErrors = computed(() =>
    this.choice() === 'custom' && this.brandColor() === null
      ? [$localize`Enter a colour as six digits, such as #15233f.`]
      : null,
  );
  protected readonly accentErrors = computed(() =>
    this.choice() === 'custom' && this.accentColor() === null
      ? [$localize`Enter a colour as six digits, such as #ffb48c.`]
      : null,
  );

  protected readonly dirty = computed(() => {
    const workspace = this.workspace();
    if (workspace === null) return false;
    return brandChanged(
      { colors: savedColors(workspace), logoAssetId: workspace.logoAssetId },
      { colors: this.colors(), logoAssetId: this.logo()?.assetId ?? null },
    );
  });

  /** A colour still to fix; saving is refused out loud rather than disabled (ARCHITECTURE §8). */
  protected readonly hasProblems = computed(
    () => this.brandErrors() !== null || this.accentErrors() !== null,
  );

  protected shows(field: 'brand' | 'accent'): readonly string[] | null {
    const errors = field === 'brand' ? this.brandErrors() : this.accentErrors();
    return errors && this.attempt.shows(field, errors) ? errors : null;
  }

  /** The last valid custom colours, so a half-typed one never blanks the preview. */
  private lastGood: BrandColors = TB_GYM_BRAND;

  constructor() {
    this.scope.onReset(() => this.resetTenantState());
    effect(() => {
      this.scope.epoch();
      const tenantId = this.tenants.selectedTenantId();
      if (tenantId && tenantId !== this.loadedTenantId) {
        this.loadedTenantId = tenantId;
        untracked(() => void this.load());
      }
    });
    effect(() => {
      const colors = this.colors();
      if (this.choice() === 'custom') this.lastGood = colors;
    });
  }

  protected choose(choice: BrandChoice): void {
    if (choice === 'custom' && this.choice() !== 'custom') {
      // Own colours start from the look on screen, so there is something to adjust.
      const current = this.colors();
      this.brandText.set(current.brand);
      this.accentText.set(current.accent);
    }
    this.choice.set(choice);
  }

  protected typeBrand(value: string): void {
    this.brandText.set(value);
  }

  protected typeAccent(value: string): void {
    this.accentText.set(value);
  }

  /** On leaving a field, a colour typed in a short form is written out in full. */
  protected tidy(which: 'brand' | 'accent'): void {
    this.attempt.touch(which);
    const text = which === 'brand' ? this.brandText : this.accentText;
    const value = normalizeHex(text());
    if (value) text.set(value);
  }

  protected pickLogo(): void {
    this.fileInput()?.nativeElement.click();
  }

  protected async upload(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const problem = logoFileProblem(file);
    if (problem) {
      this.logoError.set(problem);
      return;
    }
    return this.scope.run('logo', async (owner) => {
      this.uploading.set(true);
      this.logoError.set(null);
      this.logoStatus.set('');
      try {
        await owner.wait(this.csrf.refresh());
        const asset = await owner.wait(firstValueFrom(this.brandApi.uploadLogo(file)));
        this.logo.set({ assetId: asset.id, url: null });
        await owner.wait(this.showLogo(asset.id));
        this.logoStatus.set($localize`Logo ready. Save the brand to use it.`);
      } catch (error) {
        if (!owner.current) return;
        this.logoError.set(logoUploadError(error));
      } finally {
        if (owner.current) this.uploading.set(false);
      }
    });
  }

  protected removeLogo(): void {
    this.logo.set(null);
    this.logoError.set(null);
    this.logoStatus.set('');
  }

  protected discard(): void {
    const workspace = this.workspace();
    if (workspace) void this.startFrom(workspace);
  }

  protected async save(): Promise<void> {
    const workspace = this.workspace();
    if (workspace === null || !this.dirty() || this.saving() || this.uploading()) return;
    if (this.hasProblems()) {
      this.attempt.attempt();
      afterNextRender(
        () => this.host.nativeElement.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
        { injector: this.injector },
      );
      return;
    }
    return this.scope.run('save', async (owner) => {
      this.saving.set(true);
      this.saveError.set(null);
      try {
        const colors = this.colors();
        await owner.wait(this.csrf.refresh());
        const saved = await owner.wait(
          firstValueFrom(
            this.brandApi.saveBrand({
              brandColor: colors.brand,
              accentColor: colors.accent,
              logoAssetId: this.logo()?.assetId ?? null,
              version: workspace.version,
            }),
          ),
        );
        this.workspace.set(saved);
        this.attempt.reset();
        this.logoStatus.set('');
        // The brand travels with the list of workspaces, so reading it again repaints the app.
        await owner.wait(this.tenants.load(saved.id));
        this.toast.show(
          $localize`Brand saved. Your clients see it the next time they open the app.`,
          {
            tone: 'success',
          },
        );
      } catch (error) {
        if (!owner.current) return;
        this.saveError.set(brandSaveError(error));
      } finally {
        if (owner.current) this.saving.set(false);
      }
    });
  }

  /** The draft logo's image could not be shown: its grant ran out, so it is asked for again. */
  protected logoBroken(): void {
    const logo = this.logo();
    if (logo?.url) void this.showLogo(logo.assetId, true);
  }

  protected warnBeforeLeaving(event: BeforeUnloadEvent): void {
    if (this.dirty()) event.preventDefault();
  }

  private async load(): Promise<void> {
    return this.scope.run('load', async (owner) => {
      this.loadFailed.set(false);
      try {
        const workspace = await owner.wait(firstValueFrom(this.api.getWorkspace()));
        await this.startFrom(workspace);
      } catch {
        if (!owner.current) return;
        this.loadFailed.set(true);
      }
    });
  }

  protected retry(): void {
    void this.load();
  }

  private async startFrom(workspace: WorkspaceDetails): Promise<void> {
    const colors = savedColors(workspace);
    this.workspace.set(workspace);
    this.choice.set(choiceFor(colors));
    this.brandText.set((colors ?? TB_GYM_BRAND).brand);
    this.accentText.set((colors ?? TB_GYM_BRAND).accent);
    this.lastGood = colors ?? TB_GYM_BRAND;
    this.saveError.set(null);
    this.logoError.set(null);
    this.logoStatus.set('');
    this.attempt.reset();
    this.logo.set(workspace.logoAssetId ? { assetId: workspace.logoAssetId, url: null } : null);
    if (workspace.logoAssetId) await this.showLogo(workspace.logoAssetId);
  }

  private async showLogo(assetId: string, retry = false): Promise<void> {
    try {
      await this.csrf.refresh();
      const access = await firstValueFrom(this.api.createMediaAccess(assetId));
      if (this.logo()?.assetId === assetId) this.logo.set({ assetId, url: access.url });
    } catch {
      // The initials stand in until the next try; the logo itself is still saved.
      if (!retry && this.logo()?.assetId === assetId) this.logo.set({ assetId, url: null });
    }
  }

  private startingMode(): 'light' | 'dark' {
    const mode = this.personalMode.mode();
    if (mode !== 'system') return mode;
    return this.document.defaultView?.matchMedia?.('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }

  private resetTenantState(): void {
    this.loadedTenantId = null;
    this.workspace.set(null);
    this.loadFailed.set(false);
    this.logo.set(null);
    this.uploading.set(false);
    this.saving.set(false);
    this.saveError.set(null);
    this.logoError.set(null);
  }
}

function savedColors(workspace: WorkspaceDetails): BrandColors | null {
  return workspace.brandColor && workspace.accentColor
    ? { brand: workspace.brandColor, accent: workspace.accentColor }
    : null;
}
