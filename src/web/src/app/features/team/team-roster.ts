import {
  afterNextRender,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  LOCALE_ID,
  signal,
  viewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { WorkspaceCalendar } from '../../core/tenancy/workspace-calendar';
import { Avatar } from '../../ui/avatar';
import { Button } from '../../ui/button';
import { Skeleton } from '../../ui/skeleton';
import { StatusPill } from '../../ui/status-pill';
import { SettingsFrame } from '../settings/settings-frame';
import { TeamApi } from './team-api';
import { type RosterMember, rosterRows } from './team.models';

/**
 * A coach's Team (critique B3a), opened from their Settings: who coaches in this coaching space, in
 * which role and since when. Read-only, and it reads the roster alone: emails, invitations, client
 * counts and every change to the team stay the owner's (ADR 0026).
 */
@Component({
  selector: 'app-team-roster',
  imports: [Avatar, Button, SettingsFrame, Skeleton, StatusPill],
  templateUrl: './team-roster.html',
  styleUrl: './team-roster.scss',
})
export class TeamRoster {
  private readonly api = inject(TeamApi);
  private readonly tenants = inject(TenantStore);
  private readonly calendar = inject(WorkspaceCalendar);
  private readonly locale = inject(LOCALE_ID);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private loadedTenant: string | null = null;

  protected readonly loadingLabel = $localize`Loading your team…`;
  protected readonly members = signal<readonly RosterMember[]>([]);
  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly rows = computed(() =>
    rosterRows(this.members(), this.locale, this.calendar.timeZone()),
  );

  constructor() {
    this.scope.onReset(() => {
      this.loadedTenant = null;
      this.members.set([]);
      this.state.set('loading');
    });
    afterNextRender(() => this.heading()?.nativeElement.focus({ preventScroll: true }));
    effect(() => {
      this.scope.epoch();
      const tenantId = this.tenants.selectedTenantId();
      if (tenantId && tenantId !== this.loadedTenant) {
        this.loadedTenant = tenantId;
        void this.load();
      }
    });
  }

  protected async load(): Promise<void> {
    return this.scope.run('load', async (owner) => {
      this.state.set('loading');
      try {
        // The workspace's clock dates each row; it is read once per workspace and shared.
        const [members] = await owner.wait(
          Promise.all([firstValueFrom(this.api.getRoster()), this.calendar.resolveToday()]),
        );
        this.members.set(members);
        this.state.set('ready');
      } catch {
        if (owner.current) this.state.set('error');
      }
    });
  }
}
