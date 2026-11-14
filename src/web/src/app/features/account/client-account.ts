import { NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
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
import { tenantRoleLabel } from '../../core/i18n/role-labels';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { isThemeMode, type ThemeMode } from '../../core/theme/personal-mode.store';
import { initialsOf } from '../../shell/initials';
import { Avatar } from '../../ui/avatar';
import { Button } from '../../ui/button';
import { Icon } from '../../ui/icon';
import { SegmentedControl, type SegmentOption } from '../../ui/segmented-control';
import { StatusPill } from '../../ui/status-pill';
import { FOUNDING_COACH, FOUNDING_COACH_LINE } from '../billing/founding.models';
import { InstallCard } from '../install/install-card';
import { CloseAccount } from './close-account';

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
 *
 * The coach's card carries the Founding coach badge with its one line when the server says so
 * (notes plan N3b): only while the client's coach is a founding space's owner whose badge is earned
 * and shown. Under the name come the certificate lines the server sends (notes plan N4b), each as
 * its sentence in quiet text: the server decides every line, and the page shows what it carries.
 * Otherwise the card is exactly as it was.
 */
@Component({
  selector: 'app-client-account',
  imports: [
    Avatar,
    Button,
    CloseAccount,
    Icon,
    InstallCard,
    NgTemplateOutlet,
    RouterLink,
    SegmentedControl,
    StatusPill,
  ],
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
  /**
   * A trainee of TB Gym's own space, who coaches themselves (CLI-026): the card names the space, never
   * a member of its staff, and offers no Message (notes plan N9a2). A trainee Max coaches (N9c5a) is
   * not: their card reads their coach as a coach's client's does.
   */
  protected readonly selfDirected = signal(false);
  /**
   * Whether the intake's Health step is open to them (N9c5a): closed for a trainee of the house who is not
   * on Max, so My profile's row names no health details. Open until the profile says otherwise.
   */
  protected readonly healthStepOpen = signal(true);
  /** The space's name as the person's own membership carries it. */
  protected readonly spaceName = computed(
    () =>
      this.tenants
        .memberships()
        .find((membership) => membership.tenantId === this.tenants.selectedTenantId())
        ?.tenantName ?? '',
  );
  /** Whether the server shows the coach's Founding coach badge to this client (N3b). */
  protected readonly coachFounding = signal(false);
  protected readonly foundingCoach = FOUNDING_COACH;
  protected readonly foundingLine = FOUNDING_COACH_LINE;
  /** The sentences TB Gym shows the client about their coach, in the server's order (N4b). */
  protected readonly coachLines = signal<readonly string[]>([]);
  /** The coach's name is on its way: their card's place is kept, so the groups below do not move (audit UIQ-5). */
  protected readonly coachLoading = signal(false);
  /**
   * A coached client with no coach for now (N9d1b): their profile read and the coach's read answered
   * 404. The card says they wait, with nothing to write to.
   */
  protected readonly waitingForCoach = signal(false);
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
      this.selfDirected.set(false);
      this.healthStepOpen.set(true);
      this.coachFounding.set(false);
      this.coachLines.set([]);
      this.coachLoading.set(false);
      this.waitingForCoach.set(false);
    });
    effect(() => {
      this.scope.epoch();
      const tenantId = this.tenants.selectedTenantId();
      if (tenantId === this.loadedTenantId) return;
      this.loadedTenantId = tenantId;
      untracked(() => {
        this.coachName.set(null);
        this.selfDirected.set(false);
        this.healthStepOpen.set(true);
        this.coachFounding.set(false);
        this.coachLines.set([]);
        this.waitingForCoach.set(false);
        this.coachLoading.set(tenantId !== null);
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
    void this.session.switchWorkspace(tenantId);
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

  /**
   * A coach who cannot be read (a 403, a failure) leaves the coach line out, never an error; a 404 after
   * the profile read means the client waits for a coach (N9d1b), and the card says so. The client's own
   * profile is read first, so a self-directed trainee's never asks for the coach; a trainee Max coaches
   * (N9c5a) does, as a coach's client, and waits for a new coach on a 404 in the same words.
   */
  private async loadCoach(): Promise<void> {
    return this.scope.run('coach', async (owner) => {
      try {
        const self = await owner.wait(firstValueFrom(this.api.getSelfProfile()));
        if (owner.current) this.healthStepOpen.set(self.healthStepOpen !== false);
        if (self.selfDirected === true && self.coachedByTheHouse !== true) {
          if (owner.current) this.selfDirected.set(true);
          return;
        }
        const coach = await owner
          .wait(firstValueFrom(this.api.getOwnCoach()))
          .catch((error: unknown) => {
            if (owner.current && error instanceof HttpErrorResponse && error.status === 404) {
              this.waitingForCoach.set(true);
            }
            throw error;
          });
        if (owner.current) {
          this.coachName.set(coach.name);
          this.coachFounding.set(coach.foundingCoach === true);
          this.coachLines.set((coach.lines ?? []).map((line) => line.text));
        }
      } catch {
        if (owner.current) {
          this.coachName.set(null);
          this.coachFounding.set(false);
          this.coachLines.set([]);
        }
      } finally {
        if (owner.current) this.coachLoading.set(false);
      }
    });
  }
}
