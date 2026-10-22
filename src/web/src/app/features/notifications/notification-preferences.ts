import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom, map } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import { AuthStore } from '../../core/auth/auth.store';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { FormAttempt } from '../../core/forms/form-attempt';
import type { HoldsUnsavedWork } from '../../core/forms/leave-guard';
import { Button } from '../../ui/button';
import { Checkbox } from '../../ui/checkbox';
import { UiConfirm } from '../../ui/confirm';
import { SettingsFrame } from '../settings/settings-frame';
import { UiDialog } from '../../ui/dialog';
import { Control, Field } from '../../ui/field';
import { FormSummary } from '../../ui/form-summary';
import { Icon } from '../../ui/icon';
import { Skeleton } from '../../ui/skeleton';
import { TimeInput } from '../../ui/time-input';
import { mapNotificationPreferences, type NotificationPreferences } from './notification.models';

/** 24-hour `HH:mm`, which is the only shape the API accepts. */
const localTimePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

type QuietHoursField = 'quietHoursStartLocal' | 'quietHoursEndLocal';

/**
 * Why each quiet-hours time cannot be saved, said under its own box (audit WEB-12): the same rules the
 * server enforces, checked before a round trip. The server remains the authority.
 */
function quietHoursReasons(start: string, end: string): Partial<Record<QuietHoursField, string[]>> {
  const reasons: Partial<Record<QuietHoursField, string[]>> = {};
  if (!localTimePattern.test(start)) {
    reasons.quietHoursStartLocal = [$localize`Enter when quiet hours start, such as 22:00.`];
  }
  if (!localTimePattern.test(end)) {
    reasons.quietHoursEndLocal = [$localize`Enter when quiet hours end, such as 07:00.`];
  } else if (start === end) {
    reasons.quietHoursEndLocal = [$localize`Choose an end time that differs from the start.`];
  }
  return reasons;
}

/**
 * The signed-in member's own notification settings in one workspace.
 *
 * Everything on this screen belongs to one member in one workspace, so every piece of state is
 * discarded the moment that pair changes and every asynchronous result checks which pair it was
 * asked for before it writes anything. Without that, a slow reply for the workspace the user has
 * just left lands on top of the current one and somebody reads — or worse, saves — settings that
 * were never theirs.
 *
 * Two rules shape the rest of it:
 *
 * - **A failed save keeps the user's choices.** The form is never reset from the server after a
 *   refusal, so a conflict or a validation error costs a click rather than the whole edit. Only a
 *   successful save, or a context change, replaces what is on screen.
 * - **Nothing is written to browser storage.** Not the settings, not the workspace time zone, not
 *   the idempotency key. The server owns all of it and re-reads answer the question.
 */
@Component({
  selector: 'app-notification-preferences',
  imports: [
    Button,
    Checkbox,
    Control,
    Field,
    FormSummary,
    Icon,
    ReactiveFormsModule,
    RouterLink,
    Skeleton,
    SettingsFrame,
    TimeInput,
    UiConfirm,
  ],
  templateUrl: './notification-preferences.html',
  styleUrl: './notification-preferences.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:beforeunload)': 'onBeforeUnload($event)' },
})
export class NotificationPreferencesPage implements HoldsUnsavedWork {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly auth = inject(AuthStore);
  private readonly tenants = inject(TenantStore);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly formBuilder = inject(FormBuilder);
  private readonly dialogs = inject(UiDialog);
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly summary = viewChild.required(FormSummary);
  private readonly leaveDialog = viewChild.required<TemplateRef<unknown>>('leaveDialog');

  protected readonly loadingLabel = $localize`Loading your notification settings…`;
  protected readonly leaveMessage = $localize`Your changes to these settings are not saved. If you leave now, they are lost.`;
  protected readonly leaveConfirm = $localize`Leave without saving`;
  protected readonly leaveCancel = $localize`Stay`;

  /** Bumped whenever the member or the workspace changes; every reply is checked against it. */
  private contextGeneration = 0;
  private context: string | null = null;

  /**
   * The key this attempt is spending. Held for as long as the attempt is unchanged, so pressing Save
   * again after a lost response is the same command rather than a second decision, and replaced only
   * once the server has settled one.
   */
  private idempotencyKey = crypto.randomUUID();
  private submittedFingerprint: string | null = null;

  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly preferences = signal<NotificationPreferences | null>(null);

  protected readonly form = this.formBuilder.nonNullable.group({
    emailServiceEnabled: [false],
    quietHoursEnabled: [false],
    quietHoursStartLocal: ['22:00', [Validators.pattern(localTimePattern)]],
    quietHoursEndLocal: ['07:00', [Validators.pattern(localTimePattern)]],
  });

  protected readonly timeZoneId = computed(() => this.preferences()?.tenantTimeZoneId ?? '');
  protected readonly emailChannelAvailable = computed(
    () => this.preferences()?.emailChannelAvailable ?? false,
  );
  protected readonly isReady = computed(() => this.preferences() !== null);
  protected readonly quietHoursEnabled = signal(false);

  /** When the quiet-hours reasons have earned a place under their boxes (ARCHITECTURE §8). */
  protected readonly attempt = new FormAttempt();
  /** The two times as typed: a signal, so the reasons under them follow every change. */
  private readonly times = toSignal(
    this.form.valueChanges.pipe(map(() => this.form.getRawValue())),
    { initialValue: this.form.getRawValue() },
  );
  private readonly timeReasons = computed(() => {
    if (!this.quietHoursEnabled()) return {};
    const { quietHoursStartLocal, quietHoursEndLocal } = this.times();
    return quietHoursReasons(quietHoursStartLocal, quietHoursEndLocal);
  });
  protected readonly timeProblems = computed(() => Object.keys(this.timeReasons()).length);

  /**
   * Whether this member's mailbox has stopped receiving email, and why in their own words.
   *
   * Rendered as a statement rather than a control. There is nothing on this screen that clears it,
   * deliberately: a button that resumes mail to an address that complained is a decision about
   * somebody else's mailbox. What the member can do — correct the address on their account — is what
   * the wording points at, and doing that clears the state by itself because the server compares the
   * address they use now.
   */
  protected readonly emailSuppressed = computed(() => this.preferences()?.emailSuppressed ?? false);

  protected readonly emailSuppressionReason = computed(() => {
    switch (this.preferences()?.emailSuppressionReason ?? null) {
      case 'PermanentBounce':
        return $localize`Your email provider rejected our last message to this address permanently.`;
      case 'Complaint':
        return $localize`A message to this address was reported as spam.`;
      case 'ProviderSuppressed':
        return $localize`Our email provider is refusing to send to this address.`;
      default:
        return '';
    }
  });

  private readonly contextKey = computed(() => {
    const userId = this.auth.user()?.id ?? null;
    const membership = this.tenants.selectedMembership();
    return userId === null || membership === undefined ? null : `${userId}|${membership.tenantId}`;
  });

  constructor() {
    this.scope.onReset(() => this.resetTenantState());
    // The two time controls follow the switch above them. Disabled through the forms API rather
    // than a template `[disabled]` binding, which reactive forms refuses: a control that is disabled
    // in the DOM but enabled in the model still validates and still submits.
    this.form.controls.quietHoursEnabled.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((enabled) => this.applyQuietHoursEnabled(enabled));

    afterNextRender(() => this.heading()?.nativeElement.focus({ preventScroll: true }));
    effect(() => {
      this.scope.epoch();
      const key = this.contextKey();
      if (key === this.context) {
        return;
      }

      this.context = key;
      const generation = ++this.contextGeneration;
      // Cleared before anything is requested. Settings from the workspace the user has just left
      // must not stay on screen for the length of a request, and must never be what a Save sends.
      this.reset();
      if (key !== null) {
        void this.load(generation);
      }
    });
  }

  /** Asks before the router takes the person away from changes they have not saved (plan §9). */
  async canLeave(): Promise<boolean> {
    if (!this.form.dirty || this.saving()) {
      return true;
    }

    const dialog = this.dialogs.open<boolean>(this.leaveDialog(), {
      title: $localize`Leave without saving?`,
      closeLabel: $localize`Close`,
      closeOnNavigation: false,
    });
    return (await firstValueFrom(dialog.closed)) === true;
  }

  /** A time's reasons once its box was left or Save was pressed; null while it shows none. */
  protected shownTime(field: QuietHoursField): string[] | null {
    const reasons = this.timeReasons()[field] ?? [];
    return this.attempt.shows(field, reasons) ? reasons : null;
  }

  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.form.dirty) {
      event.preventDefault();
      event.returnValue = '';
    }
  }

  protected async reload(): Promise<void> {
    return this.scope.run('reload', async (owner) => {
      if (this.contextKey() === null) {
        return;
      }

      await owner.wait(this.load(this.contextGeneration));
    });
  }

  protected async save(): Promise<void> {
    return this.scope.run('save', async (owner) => {
      const generation = this.contextGeneration;
      const current = this.preferences();
      if (current === null || this.saving()) {
        return;
      }

      const value = this.form.getRawValue();
      if (value.quietHoursEnabled && this.timeProblems() > 0) {
        // Said under the boxes and never as the server's word: the summary points at them, and the
        // first wrong box takes focus.
        this.error.set(null);
        this.notice.set(null);
        this.attempt.attempt();
        afterNextRender(
          () =>
            this.host.nativeElement.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
          { injector: this.injector },
        );
        return;
      }

      const submittedFingerprint = [
        value.emailServiceEnabled,
        value.quietHoursEnabled,
        value.quietHoursEnabled ? value.quietHoursStartLocal : '',
        value.quietHoursEnabled ? value.quietHoursEndLocal : '',
      ].join('|');
      if (
        this.submittedFingerprint !== null &&
        this.submittedFingerprint !== submittedFingerprint
      ) {
        // The previous request may be retried with its key only while it is still the same normalized
        // command. Once the member edits a choice, reusing that key would correctly conflict server-side.
        this.idempotencyKey = crypto.randomUUID();
      }
      this.submittedFingerprint = submittedFingerprint;

      this.saving.set(true);
      this.error.set(null);
      this.notice.set(null);
      try {
        await owner.wait(this.csrf.refresh());
        if (this.contextGeneration !== generation) {
          return;
        }

        const saved = await owner.wait(
          firstValueFrom(
            this.api
              .updateNotificationPreferences({
                emailServiceEnabled: value.emailServiceEnabled,
                quietHoursEnabled: value.quietHoursEnabled,
                // Leftover times are not part of a disabled window. Sending them would make two requests
                // that both mean "off" into two different commands.
                quietHoursStartLocal: value.quietHoursEnabled ? value.quietHoursStartLocal : null,
                quietHoursEndLocal: value.quietHoursEnabled ? value.quietHoursEndLocal : null,
                idempotencyKey: this.idempotencyKey,
                version: current.version,
              })
              .pipe(map(mapNotificationPreferences)),
          ),
        );
        if (this.contextGeneration !== generation) {
          return;
        }

        // Settled, so the next edit is a new command.
        this.idempotencyKey = crypto.randomUUID();
        this.submittedFingerprint = null;
        this.apply(saved);
        this.notice.set($localize`Your notification settings were saved.`);
      } catch (error) {
        if (!owner.current) return;
        if (this.contextGeneration === generation) {
          // The form deliberately keeps what the user typed. The server refused the change, so
          // discarding their edit would cost them the work as well as the save.
          this.error.set(
            apiErrorMessage(error, $localize`Your notification settings could not be saved.`),
          );
          this.summary().focus();
        }
      } finally {
        if (owner.current) {
          if (this.contextGeneration === generation) {
            this.saving.set(false);
          }
        }
      }
    });
  }

  private async load(generation: number): Promise<void> {
    return this.scope.run('load', async (owner) => {
      this.loading.set(true);
      this.error.set(null);
      try {
        const loaded = await owner.wait(
          firstValueFrom(
            this.api.getNotificationPreferences().pipe(map(mapNotificationPreferences)),
          ),
        );
        if (this.contextGeneration !== generation) {
          return;
        }

        this.apply(loaded);
      } catch (error) {
        if (!owner.current) return;
        if (this.contextGeneration === generation) {
          this.preferences.set(null);
          this.error.set(
            apiErrorMessage(error, $localize`Your notification settings could not be loaded.`),
          );
        }
      } finally {
        if (owner.current) {
          if (this.contextGeneration === generation) {
            this.loading.set(false);
          }
        }
      }
    });
  }

  private apply(preferences: NotificationPreferences): void {
    this.preferences.set(preferences);
    this.attempt.reset();
    this.form.reset({
      emailServiceEnabled: preferences.emailServiceEnabled,
      quietHoursEnabled: preferences.quietHoursEnabled,
      // A disabled window keeps sensible defaults in the inputs so switching it back on does not
      // mean retyping. They are not sent while it is off.
      quietHoursStartLocal: preferences.quietHoursStartLocal ?? '22:00',
      quietHoursEndLocal: preferences.quietHoursEndLocal ?? '07:00',
    });
    this.applyQuietHoursEnabled(preferences.quietHoursEnabled);
  }

  private applyQuietHoursEnabled(enabled: boolean): void {
    this.quietHoursEnabled.set(enabled);
    for (const control of [
      this.form.controls.quietHoursStartLocal,
      this.form.controls.quietHoursEndLocal,
    ]) {
      // `emitEvent: false` so toggling the switch does not look like the user editing the times.
      if (enabled) {
        control.enable({ emitEvent: false });
      } else {
        control.disable({ emitEvent: false });
      }
    }
  }

  private reset(): void {
    this.attempt.reset();
    this.preferences.set(null);
    this.loading.set(false);
    this.saving.set(false);
    this.error.set(null);
    this.notice.set(null);
    this.idempotencyKey = crypto.randomUUID();
    this.submittedFingerprint = null;
  }

  private resetTenantState(): void {
    ++this.contextGeneration;
    this.attempt.reset();
    this.context = null;
    this.idempotencyKey = crypto.randomUUID();
    this.submittedFingerprint = null;
    this.loading.set(false);
    this.saving.set(false);
    this.error.set(null);
    this.notice.set(null);
    this.preferences.set(null);
    this.form.reset();
    this.quietHoursEnabled.set(false);
  }
}
