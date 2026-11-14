import {
  afterNextRender,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  LOCALE_ID,
  model,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
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
import { UiDisclosure, UiDisclosureContent } from '../../ui/disclosure';
import { Control, Field } from '../../ui/field';
import { FormSummary } from '../../ui/form-summary';
import { UiSelect, type SelectOption } from '../../ui/select';
import {
  coachChangeSentence,
  coachHistoryRows,
  type CoachHistoryRow,
  type CurrentCoach,
} from './client-coach.models';
import { ClientWorkspaceContext } from './client-workspace.context';

/**
 * The client's coach, and the owner's action to give the client one or move them to another (ADR 0026: at
 * most one; C8: a client may wait with none).
 *
 * Owner-only. Silent in a workspace with nobody else to move a client to, so a solo coach sees no change,
 * unless the client waits for a coach: then even a solo owner can take them. Nothing is chosen for a waiting
 * client, the owner included (C8: the owner never gets a client automatically). The dialog shows the coach
 * history its note is kept in (audit COACH-16), read when it opens. The API is the authority: it refuses a
 * change from anyone but the owner, to anyone who is not active staff, or against a stale client version.
 */
@Component({
  selector: 'app-client-coach',
  imports: [
    ReactiveFormsModule,
    Button,
    Control,
    Field,
    FormSummary,
    UiDisclosure,
    UiDisclosureContent,
    UiSelect,
  ],
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
  private readonly injector = inject(Injector);
  private readonly record = inject(ClientWorkspaceContext, { optional: true });
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('reassignDialog');
  private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('reassignTrigger');
  private readonly noticeLine = viewChild<ElementRef<HTMLElement>>('coachNotice');
  private readonly summary = viewChild(FormSummary);
  private readonly coachSelect = viewChild(UiSelect);
  private loadedTenant: string | null = null;

  readonly client = input.required<CoachClientDetails>();
  /**
   * Set by the page that arrived with `?action=coach` (Today's and the Overview's Choose a coach): the
   * dialog opens once the team is read, if a change is possible, and this is set back to false either way.
   */
  readonly openRequested = model(false);
  readonly profileChanged = output<CoachClientDetails>();

  protected readonly members = signal<TeamMember[]>([]);
  /** The team's read has answered, or failed: an asked-for dialog may open. */
  private readonly teamRead = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  /** A Choose pressed with nothing chosen: the select then says so. */
  private readonly tried = signal(false);
  /** The coach history, read each time the dialog opens; null while it is read or if it failed. */
  protected readonly history = signal<readonly CoachHistoryRow[] | null>(null);
  protected readonly historyFailed = signal(false);

  private readonly me = computed(() => this.auth.user()?.id ?? null);
  /** Nobody coaches the client (N9d1b): their coach left, or they arrived with none. */
  protected readonly waiting = computed(() => this.client().assignedCoachUserId === null);
  /** A team of one has nobody to move a client to, but a waiting client still needs a coach. */
  protected readonly canChange = computed(() => this.members().length > 1 || this.waiting());
  /**
   * The panel, while a change is possible or after one made here: a solo owner who takes a waiting
   * client keeps the coach line and its notice, with no way left to change it.
   */
  protected readonly shown = computed(() => this.canChange() || this.notice() !== null);
  /** Who the client has now, for the dialog's sentence. */
  private readonly current = computed<CurrentCoach>(() => {
    const coach = this.client().assignedCoachUserId;
    if (coach === null) return { kind: 'waiting' };
    return coach === this.me()
      ? { kind: 'you' }
      : { kind: 'other', name: this.client().assignedCoachName };
  });
  /**
   * Everyone the client could go to: the rest of the team, the caller as You and last, so a choice made
   * in haste is not the owner's own (C8). With the team unread, a waiting client can still go to the
   * caller, who is staff.
   */
  protected readonly candidates = computed<SelectOption[]>(() => {
    const me = this.auth.user();
    const coach = this.client().assignedCoachUserId;
    const team =
      this.members().length > 0 || !me
        ? this.members()
        : [{ userId: me.id, displayName: me.displayName }];
    const others = team
      .filter((member) => member.userId !== coach && member.userId !== me?.id)
      .map((member) => ({ value: member.userId, label: member.displayName }))
      .sort((a, b) => a.label.localeCompare(b.label, this.locale));
    const you =
      me && coach !== me.id && team.some((member) => member.userId === me.id)
        ? [{ value: me.id, label: $localize`You` }]
        : [];
    return [...others, ...you];
  });
  protected readonly form = this.formBuilder.nonNullable.group({
    coachUserId: ['', Validators.required],
    note: ['', Validators.maxLength(500)],
  });
  private readonly chosenId = toSignal(this.form.controls.coachUserId.valueChanges, {
    initialValue: this.form.controls.coachUserId.value,
  });
  /** What the change does, following the choice. */
  protected readonly sentence = computed(() => {
    const chosen = this.chosenId();
    const option = this.candidates().find((candidate) => candidate.value === chosen);
    return coachChangeSentence(
      this.client().firstName,
      this.current(),
      !option
        ? null
        : option.value === this.me()
          ? { kind: 'you' }
          : { kind: 'other', name: option.label },
    );
  });
  protected readonly coachErrors = computed(() =>
    this.tried() && !this.chosenId() ? [$localize`Choose a coach.`] : null,
  );

  constructor() {
    this.scope.onReset(() => {
      this.loadedTenant = null;
      this.members.set([]);
      this.teamRead.set(false);
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
    // An arrival that asks for the dialog: opened once the panel it belongs to is drawn.
    effect(() => {
      if (!this.openRequested() || !this.teamRead()) return;
      untracked(() => {
        this.openRequested.set(false);
        if (this.canChange()) afterNextRender(() => this.open(), { injector: this.injector });
      });
    });
  }

  protected open(): void {
    // A client with a coach keeps the quick path: the first other coach is chosen already. A waiting
    // client starts with nobody chosen.
    const first = this.waiting() ? undefined : this.candidates()[0];
    this.form.reset({ coachUserId: first?.value ?? '', note: '' });
    this.tried.set(false);
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
    if (this.saving()) return;
    if (this.form.invalid) {
      this.tried.set(true);
      this.form.markAllAsTouched();
      // The select says what is missing; focus goes there so it is heard.
      if (!this.chosenId()) this.coachSelect()?.focus();
      return;
    }

    const waiting = this.waiting();
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
          updated.assignedCoachUserId !== null && updated.assignedCoachUserId === this.me()
            ? $localize`You now coach ${updated.firstName}:name:.`
            : $localize`${updated.firstName}:name: now has ${updated.assignedCoachName}:coach: as their coach.`,
        );
        this.closeDialog();
        // Once the new profile is drawn: the trigger, or the notice where no change is left to make.
        afterNextRender(() => (this.trigger() ?? this.noticeLine())?.nativeElement.focus(), {
          injector: this.injector,
        });
        await owner.wait(this.loadTeam());
      } catch (error) {
        if (!owner.current) return;
        this.error.set(
          apiErrorMessage(
            error,
            waiting
              ? $localize`The coach could not be saved. Reload the page and try again.`
              : $localize`The client could not be reassigned. Reload the page and try again.`,
          ),
        );
        this.summary()?.focus();
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
      } finally {
        if (owner.current) this.teamRead.set(true);
      }
    });
  }

  private closeDialog(): void {
    const dialog = this.dialog()?.nativeElement;
    if (dialog?.open) dialog.close();
  }
}
