import {
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { TeamApi } from '../team/team-api';
import { apiErrorMessage } from '../../core/api/api-error';
import { CoachClientDetails, TeamMember } from '../../core/api/api.models';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button } from '../../ui/button';
import { Control, Field } from '../../ui/field';

/**
 * The client's coach, and the owner's action to move the client to another one (ADR 0026).
 *
 * Owner-only, and silent in a workspace with nobody else to move a client to, so a solo coach sees
 * no change. The API is the authority: it refuses a reassignment from anyone but the owner, to
 * anyone who is not active staff, or against a stale client version.
 */
@Component({
  selector: 'app-client-coach',
  imports: [ReactiveFormsModule, Button, Control, Field],
  templateUrl: './client-coach.html',
  styleUrl: './client-coach.scss',
})
export class ClientCoach {
  private readonly api = inject(TeamApi);
  private readonly csrf = inject(CsrfService);
  private readonly formBuilder = inject(FormBuilder);
  private readonly tenants = inject(TenantStore);
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
