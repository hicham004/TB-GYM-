import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom, type Observable } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import type { ClientSelfProfile, WorkspaceDetails } from '../../core/api/api.models';
import { AuthStore } from '../../core/auth/auth.store';
import type { HoldsUnsavedWork } from '../../core/forms/leave-guard';
import { UnsavedWork } from '../../core/forms/unsaved-work';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button, ButtonLink } from '../../ui/button';
import { deviceToday, isoWeekdayOfName } from '../../ui/calendar';
import { UiConfirm } from '../../ui/confirm';
import { UiDialog } from '../../ui/dialog';
import { Icon } from '../../ui/icon';
import { Skeleton } from '../../ui/skeleton';
import { IntakeProfile } from '../intake/intake-profile';
import { IntakeSteps } from '../intake/intake-steps';
import type { IntakeOutcome, IntakeSaver } from '../intake/intake.models';

/**
 * My profile (R5.3b, M8). A new client answers a few short questions as steps, each saved as they go;
 * once those are done the page shows the answers as cards with an Edit on each. The page owns the
 * profile and every write, as its own workspace's, so a late answer never lands in another workspace.
 */
@Component({
  selector: 'app-client-profile-page',
  imports: [Button, ButtonLink, Icon, IntakeProfile, IntakeSteps, RouterLink, Skeleton, UiConfirm],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './client-profile.html',
  styleUrl: './client-profile.scss',
  host: { '(window:beforeunload)': 'onBeforeUnload($event)' },
})
export class ClientProfilePage implements HoldsUnsavedWork {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly auth = inject(AuthStore);
  private readonly dialogs = inject(UiDialog);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly leaveDialog = viewChild.required<TemplateRef<unknown>>('leaveDialog');
  private loadedTenantId: string | null = null;

  protected readonly closeLabel = $localize`Close`;
  protected readonly loadingLabel = $localize`Loading your profile…`;
  protected readonly leaveMessage = $localize`The answers on this step aren’t saved. If you leave now, they are lost.`;
  protected readonly leaveConfirm = $localize`Leave without saving`;
  protected readonly leaveCancel = $localize`Stay`;

  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly profile = signal<ClientSelfProfile | null>(null);
  private readonly workspace = signal<WorkspaceDetails | null>(null);
  /** Set when the last step has just finished setting up, to say so before the answers. */
  protected readonly justFinished = signal(false);
  private readonly stepsDirty = signal(false);

  /** Today in the coaching space, never the browser's: the adult rule is decided there. */
  protected readonly today = computed(() => this.workspace()?.currentDate ?? deviceToday());
  protected readonly firstDay = computed(() => isoWeekdayOfName(this.workspace()?.weekStartsOn));
  protected readonly weightUnit = this.auth.weightUnit;
  protected readonly spaceName = computed(
    () => this.tenants.selectedMembership()?.tenantName ?? '',
  );
  protected readonly firstName = computed(() => this.profile()?.firstName ?? '');
  protected readonly settingUp = computed(
    () => this.profile() !== null && this.profile()!.onboardingStatus !== 'Completed',
  );

  /** What the steps and the sheets save through: this page's own writes. */
  protected readonly saver: IntakeSaver = {
    save: (request) =>
      this.write(
        'save',
        () => this.api.updateSelfIntake(request),
        $localize`Your answers could not be saved. Try again.`,
      ),
    complete: (request) =>
      this.write(
        'complete',
        () => this.api.completeSelfOnboarding(request),
        $localize`Setting up could not be finished. Try again.`,
        true,
      ),
  };

  constructor() {
    const unregister = inject(UnsavedWork).register(this);
    inject(DestroyRef).onDestroy(unregister);
    this.scope.onReset(() => {
      this.loadedTenantId = null;
      this.profile.set(null);
      this.workspace.set(null);
      this.state.set('loading');
      this.justFinished.set(false);
      this.stepsDirty.set(false);
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

  protected setStepsDirty(dirty: boolean): void {
    this.stepsDirty.set(dirty);
  }

  /** Asks before the router, a workspace switch or a sign-out drops answers typed on a step (plan §9). */
  async canLeave(): Promise<boolean> {
    if (!this.stepsDirty()) return true;
    const dialog = this.dialogs.open<boolean>(this.leaveDialog(), {
      title: $localize`Leave without saving?`,
      closeLabel: this.closeLabel,
      closeOnNavigation: false,
    });
    return (await firstValueFrom(dialog.closed)) === true;
  }

  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.stepsDirty()) {
      event.preventDefault();
      event.returnValue = '';
    }
  }

  protected async load(): Promise<void> {
    return this.scope.run('load', async (owner) => {
      this.state.set('loading');
      try {
        const [profile, workspace] = await owner.wait(
          Promise.all([
            firstValueFrom(this.api.getSelfProfile()),
            // The workspace's own date and week; a client who cannot read it gets the device's.
            firstValueFrom(this.api.getWorkspace()).catch(() => null),
          ]),
        );
        this.profile.set(profile);
        this.workspace.set(workspace);
        this.state.set('ready');
      } catch {
        if (!owner.current) return;
        this.state.set('error');
      }
    });
  }

  protected showAnswers(): void {
    this.justFinished.set(false);
  }

  private async write(
    lane: string,
    request: () => Observable<ClientSelfProfile>,
    fallback: string,
    finishing = false,
  ): Promise<IntakeOutcome> {
    return this.scope.run<IntakeOutcome>(
      lane,
      async (owner) => {
        try {
          await owner.wait(this.csrf.refresh());
          const profile = await owner.wait(firstValueFrom(request()));
          this.profile.set(profile);
          if (finishing) {
            this.stepsDirty.set(false);
            this.justFinished.set(true);
          }
          return { ok: true };
        } catch (error) {
          if (!owner.current) return { ok: false, message: '' };
          return { ok: false, message: apiErrorMessage(error, fallback) };
        }
      },
      { ok: false, message: '' },
    );
  }
}
