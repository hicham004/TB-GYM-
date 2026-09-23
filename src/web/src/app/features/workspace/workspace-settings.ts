import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { Component, effect, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import { DayOfWeek, WorkspaceDetails } from '../../core/api/api.models';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { SectionNav } from '../../ui/section-nav';
import { SETTINGS_SECTIONS } from './settings-sections';

@Component({
  selector: 'app-workspace-settings',
  imports: [ReactiveFormsModule, SectionNav],
  templateUrl: './workspace-settings.html',
  styleUrl: './workspace-settings.scss',
})
export class WorkspaceSettings {
  protected readonly sections = SETTINGS_SECTIONS;
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly formBuilder = inject(FormBuilder);
  private readonly tenants = inject(TenantStore);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private loadedTenantId: string | null = null;
  private workspace: WorkspaceDetails | null = null;

  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly form = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(200)]],
    slug: [{ value: '', disabled: true }],
    timeZoneId: ['Asia/Beirut', Validators.required],
    defaultCulture: ['en-LB', Validators.required],
    defaultCurrencyCode: ['USD', [Validators.required, Validators.pattern(/^[A-Za-z]{3}$/)]],
    weekStartsOn: this.formBuilder.nonNullable.control<DayOfWeek>('Monday'),
  });

  constructor() {
    this.scope.onReset(() => this.resetTenantState());
    effect(() => {
      this.scope.epoch();
      const tenantId = this.tenants.selectedTenantId();
      if (tenantId && tenantId !== this.loadedTenantId) {
        this.loadedTenantId = tenantId;
        void this.load();
      }
    });
  }

  protected async save(): Promise<void> {
    return this.scope.run('save', async (owner) => {
      if (!this.workspace || this.form.invalid) {
        this.form.markAllAsTouched();
        return;
      }

      this.saving.set(true);
      this.error.set(null);
      this.notice.set(null);
      try {
        await owner.wait(this.csrf.refresh());
        const value = this.form.getRawValue();
        this.workspace = await owner.wait(
          firstValueFrom(
            this.api.updateWorkspace({
              ...this.workspace,
              name: value.name,
              timeZoneId: value.timeZoneId,
              defaultCulture: value.defaultCulture,
              defaultCurrencyCode: value.defaultCurrencyCode.toUpperCase(),
              weekStartsOn: value.weekStartsOn,
            }),
          ),
        );
        this.patch(this.workspace);
        await owner.wait(this.tenants.load(this.workspace.id));
        this.notice.set($localize`Workspace settings saved.`);
      } catch (error) {
        if (!owner.current) return;
        this.error.set(apiErrorMessage(error, $localize`Workspace settings could not be saved.`));
      } finally {
        if (owner.current) {
          this.saving.set(false);
        }
      }
    });
  }

  private async load(): Promise<void> {
    return this.scope.run('load', async (owner) => {
      this.loading.set(true);
      this.error.set(null);
      try {
        this.workspace = await owner.wait(firstValueFrom(this.api.getWorkspace()));
        this.patch(this.workspace);
      } catch (error) {
        if (!owner.current) return;
        this.error.set(apiErrorMessage(error, $localize`Workspace settings could not be loaded.`));
      } finally {
        if (owner.current) {
          this.loading.set(false);
        }
      }
    });
  }

  private patch(workspace: WorkspaceDetails): void {
    this.form.reset({
      name: workspace.name,
      slug: workspace.slug,
      timeZoneId: workspace.timeZoneId,
      defaultCulture: workspace.defaultCulture,
      defaultCurrencyCode: workspace.defaultCurrencyCode,
      weekStartsOn: workspace.weekStartsOn,
    });
  }

  private resetTenantState(): void {
    this.loadedTenantId = null;
    this.workspace = null;
    this.loading.set(false);
    this.saving.set(false);
    this.error.set(null);
    this.notice.set(null);
    this.form.reset();
  }
}
