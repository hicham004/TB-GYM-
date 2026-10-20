import {
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  LOCALE_ID,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { TeamApi } from '../team/team-api';
import { apiErrorMessage } from '../../core/api/api-error';
import { CoachClientDetails, TeamMember } from '../../core/api/api.models';
import { AuthStore } from '../../core/auth/auth.store';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button } from '../../ui/button';
import { Control, Field } from '../../ui/field';
import { coachHistoryRows, type CoachHistoryRow } from './client-coach.models';
import { ClientWorkspaceContext } from './client-workspace.context';

/**
 * The client's coach, and the owner's action to move the client to another one (ADR 0026).
 *
 * Owner-only, and silent in a workspace with nobody else to move a client to, so a solo coach sees
 * no change. The dialog shows the coach history its note is kept in (audit COACH-16), read when it
 * opens. The API is the authority: it refuses a reassignment from anyone but the owner, to anyone
 * who is not active staff, or against a stale client version.
 */
@Component({
  selector: 'app-client-coach',
  imports: [ReactiveFormsModule, Button, Control, Field],
  templateUrl: './client-coach.html',
  styleUrl: './client-coach.scss',
})
export class ClientCoach {
  private readonly api = inject(TeamApi);
  private readonly auth = inject(AuthStore);
  private readonly csrf = inject(CsrfService);
  private readonly formBuilder = inject(FormBuilder);
  private readonly tenants = inject(TenantStore);
  private readonly locale = inject(LOCALE_ID);
  private readonly record = inject(ClientWorkspaceContext, { optional: true });
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('reassignDialog');
  private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('reassignTrigger');
  private loadedTenant: string | null = null;

  readonly client = input.required<CoachClientDetails>();
  readonly profileChanged = output<CoachClientDetails>();

  protected readonly members = signal<TeamMember[]>([]);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  /** The coach history, read each time the dialog opens; null while it is read or if it failed. */
  protected readonly history = signal<readonly CoachHistoryRow[] | null>(null);
  protected readonly historyFailed = signal(false);
  /**
   * The owner is this client's coach: they keep the record, as the owner sees every client, but their
   * chat closes like any coach's (ADR 0026, audit COACH-13).
   */
  protected readonly ownerIsCoach = computed(
    () => this.client().assignedCoachUserId === this.auth.user()?.id,
  );
  /** Everyone the client could be moved to: the rest of the team. */
  protected readonly candidates = computed(() =>
    this.members().filter((member) => member.userId !== this.client().assignedCoachUserId),
  );
  protected readonly form = this.formBuilder.nonNullable.group({
    coachUserId: ['', Validators.required],
    note: ['', Validators.maxLength(500)],
  });

  constructor() {
    this.scope.onReset(() => {
      this.loadedTenant = null;
      this.members.set([]);
      this.saving.set(false);
      this.error.set(null);
      this.notice.set(null);
      this.closeDialog();
    });
    effect(() => {
      this.scope.epoch();
      const tenantId = this.tenants.selectedTenantId();
      if (tenantId && tenantId !== this.loadedTenant) {
        this.loadedTenant = tenantId;
        void this.loadTeam();
      }
    });
  }

  protected open(): void {
    const first = this.candidates()[0];
    this.form.reset({ coachUserId: first?.userId ?? '', note: '' });
    this.error.set(null);
    this.notice.set(null);
    const dialog = this.dialog()?.nativeElement;
    if (dialog && !dialog.open) dialog.showModal();
    void this.loadHistory();
  }

  private async loadHistory(): Promise<void> {
    return this.scope.run('history', async (owner) => {
      this.history.set(null);
      this.historyFailed.set(false);
      try {
        const items = await owner.wait(
          firstValueFrom(this.api.getCoachAssignments(this.client().id)),
        );
        this.history.set(
          coachHistoryRows(items, this.locale, this.record?.workspace()?.timeZoneId ?? null),
        );
      } catch {
        // The dialog still works without it; it says the history could not be read.
        if (owner.current) this.historyFailed.set(true);
      }
    });
  }

  protected cancel(event?: Event): void {
    event?.preventDefault();
    if (this.saving()) return;
    this.closeDialog();
    this.trigger()?.nativeElement.focus();
  }

  protected async reassign(): Promise<void> {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }

    return this.scope.run('reassign', async (owner) => {
      this.saving.set(true);
      this.error.set(null);
      try {
        await owner.wait(this.csrf.refresh());
        const value = this.form.getRawValue();
        const updated = await owner.wait(
          firstValueFrom(
            this.api.reassignClientCoach(
              this.client().id,
              value.coachUserId,
              value.note.trim() || null,
              this.client().version,
            ),
          ),
        );
        this.profileChanged.emit(updated);
        this.notice.set(
          $localize`${updated.firstName}:name: now has ${updated.assignedCoachName}:coach: as their coach.`,
        );
        this.closeDialog();
        this.trigger()?.nativeElement.focus();
        await owner.wait(this.loadTeam());
      } catch (error) {
        if (!owner.current) return;
        this.error.set(
          apiErrorMessage(
            error,
            $localize`The client could not be reassigned. Reload the page and try again.`,
          ),
        );
      } finally {
        if (owner.current) this.saving.set(false);
      }
    });
  }

  private async loadTeam(): Promise<void> {
    return this.scope.run('team', async (owner) => {
      try {
        this.members.set(await owner.wait(firstValueFrom(this.api.getTeamMembers())));
      } catch {
        // The coach line is a convenience beside the profile; the page stays usable without it.
        if (owner.current) this.members.set([]);
      }
    });
  }

  private closeDialog(): void {
    const dialog = this.dialog()?.nativeElement;
    if (dialog?.open) dialog.close();
  }
}
