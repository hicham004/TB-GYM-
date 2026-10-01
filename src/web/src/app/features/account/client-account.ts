import { NgTemplateOutlet } from '@angular/common';
import {
  afterNextRender,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  linkedSignal,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ClientAccessStore } from '../../core/access/client-access.store';
import { ApiClient } from '../../core/api/api-client';
import type { BodyweightUnit } from '../../core/api/api.models';
import { AuthStore } from '../../core/auth/auth.store';
import { SessionActions } from '../../core/auth/session-actions';
import { tenantRoleLabel } from '../../core/i18n/display-labels';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { isThemeMode, type ThemeMode } from '../../core/theme/personal-mode.store';
import { initialsOf } from '../../shell/initials';
import { Avatar } from '../../ui/avatar';
import { Button } from '../../ui/button';
import { Icon } from '../../ui/icon';
import { SegmentedControl, type SegmentOption } from '../../ui/segmented-control';
import { InstallCard } from '../install/install-card';

/** What a control follows: the account's value, and whether a save is still on its way. */
interface Behind<T> {
  readonly account: T;
  readonly saving: boolean;
}

/**
 * The client's Me page (M8): who they are and who coaches them, the settings that are theirs (light
 * or dark, the unit their weight is shown in), the way to every account screen, switching coach and
 * signing out. Reached from the avatar in Today's header.
 *
 * Both preferences belong to the person, not to a coach: they live on the account, so they follow
 * the client to a new phone, an installed app and another coach. They save as they are chosen, one
 * at a time, and a refusal puts the control back where the account still has it.
 */
@Component({
  selector: 'app-client-account',
  imports: [Avatar, Button, Icon, InstallCard, NgTemplateOutlet, RouterLink, SegmentedControl],
  templateUrl: './client-account.html',
  styleUrls: ['./client-account.scss', './client-account-rows.scss'],
})
export class ClientAccount {
  private readonly api = inject(ApiClient);
  private readonly access = inject(ClientAccessStore);
  private readonly session = inject(SessionActions);
  protected readonly auth = inject(AuthStore);
  protected readonly tenants = inject(TenantStore);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private loadedTenantId: string | null = null;
  protected readonly roleLabel = tenantRoleLabel;
  protected readonly initialsOf = initialsOf;
  protected readonly signingOut = signal(false);
  protected readonly coachName = signal<string | null>(null);
  protected readonly preferenceError = signal<string | null>(null);

  protected readonly displayName = computed(() => this.auth.user()?.displayName ?? '');
  protected readonly email = computed(() => this.auth.user()?.email ?? '');
  protected readonly initials = computed(() => initialsOf(this.displayName(), this.email()));
  protected readonly isPlatformAdmin = computed(
    () => this.auth.user()?.roles?.includes('PlatformAdmin') ?? false,
  );
  protected readonly canMessage = computed(
    () => this.access.decision('Messaging')?.isAllowed ?? false,
  );

  protected readonly themeOptions: readonly SegmentOption[] = [
    { value: 'system', label: $localize`Device` },
    { value: 'light', label: $localize`Light` },
    { value: 'dark', label: $localize`Dark` },
  ];
  protected readonly unitOptions: readonly SegmentOption[] = [
    { value: 'Kilogram', label: $localize`kg` },
    { value: 'Pound', label: $localize`lb` },
  ];

  // Each control shows what was just chosen at once and follows the account again once every save
  // has answered. While one is still on its way the account is behind the screen, so a reply to an
  // earlier choice (or to the other setting) must not pull the control back. They read the account
  // through computeds, which only notify when the value itself changes.
  private readonly pending = signal(0);
  private readonly accountTheme = computed<ThemeMode>(
    () => this.auth.user()?.preferredThemeMode ?? 'system',
  );
  protected readonly theme = linkedSignal<Behind<ThemeMode>, ThemeMode>({
    source: () => ({ account: this.accountTheme(), saving: this.pending() > 0 }),
    computation: ({ account, saving }, previous) => (saving && previous ? previous.value : account),
  });
  protected readonly unit = linkedSignal<Behind<BodyweightUnit>, BodyweightUnit>({
    source: () => ({ account: this.auth.weightUnit(), saving: this.pending() > 0 }),
    computation: ({ account, saving }, previous) => (saving && previous ? previous.value : account),
  });

  constructor() {
    this.scope.onReset(() => {
      this.loadedTenantId = null;
      this.coachName.set(null);
    });
    effect(() => {
      this.scope.epoch();
      const tenantId = this.tenants.selectedTenantId();
      if (tenantId === this.loadedTenantId) return;
      this.loadedTenantId = tenantId;
      untracked(() => {
        this.coachName.set(null);
        if (tenantId !== null) void this.loadCoach();
      });
    });
    afterNextRender(() => this.heading()?.nativeElement.focus({ preventScroll: true }));
  }

  protected chooseTheme(value: string): void {
    if (!isThemeMode(value) || value === this.theme()) return;
    this.theme.set(value);
    void this.save(
      () => this.auth.updateThemeMode(value),
      () => this.theme.set(this.accountTheme()),
    );
  }

  protected chooseUnit(value: string): void {
    if ((value !== 'Kilogram' && value !== 'Pound') || value === this.unit()) return;
    this.unit.set(value);
    void this.save(
      () => this.auth.updateWeightUnit(value),
      () => this.unit.set(this.auth.weightUnit()),
    );
  }

  protected chooseWorkspace(tenantId: string): void {
    this.session.switchWorkspace(tenantId);
  }

  protected async signOut(): Promise<void> {
    this.signingOut.set(true);
    try {
      await this.session.signOut();
    } finally {
      this.signingOut.set(false);
    }
  }

  /** A refusal puts the control back only when it was the last save, so it never undoes a later choice. */
  private async save(send: () => Promise<void>, putBack: () => void): Promise<void> {
    this.preferenceError.set(null);
    this.pending.update((count) => count + 1);
    try {
      await send();
    } catch {
      if (this.pending() === 1) putBack();
      this.preferenceError.set($localize`Couldn’t save your choice. Try again.`);
    } finally {
      this.pending.update((count) => count - 1);
    }
  }

  /** A coach who cannot be read (a released client has none) leaves the coach line out, never an error. */
  private async loadCoach(): Promise<void> {
    return this.scope.run('coach', async (owner) => {
      try {
        const coach = await owner.wait(firstValueFrom(this.api.getOwnCoach()));
        if (owner.current) this.coachName.set(coach.name);
      } catch {
        if (owner.current) this.coachName.set(null);
      }
    });
  }
}
