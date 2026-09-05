import { Component, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import { AuthStore } from '../../core/auth/auth.store';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import type { NotificationPreferences } from './notification.models';

/** 24-hour `HH:mm`, which is the only shape the API accepts. */
const localTimePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

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
  imports: [ReactiveFormsModule],
  templateUrl: './notification-preferences.html',
  styleUrl: './notification-preferences.scss',
})
export class NotificationPreferencesPage {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly auth = inject(AuthStore);
  private readonly tenants = inject(TenantStore);
  private readonly formBuilder = inject(FormBuilder);

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

  private readonly contextKey = computed(() => {
    const userId = this.auth.user()?.id ?? null;
    const membership = this.tenants.selectedMembership();
    return userId === null || membership === undefined ? null : `${userId}|${membership.tenantId}`;
  });

  constructor() {
    // The two time controls follow the switch above them. Disabled through the forms API rather
    // than a template `[disabled]` binding, which reactive forms refuses: a control that is disabled
    // in the DOM but enabled in the model still validates and still submits.
    this.form.controls.quietHoursEnabled.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((enabled) => this.applyQuietHoursEnabled(enabled));

    effect(() => {
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

  protected async reload(): Promise<void> {
    if (this.contextKey() === null) {
      return;
    }

    await this.load(this.contextGeneration);
  }

  protected async save(): Promise<void> {
    const generation = this.contextGeneration;
    const current = this.preferences();
    if (current === null || this.saving()) {
      return;
    }

    const value = this.form.getRawValue();
    if (value.quietHoursEnabled && !this.validateQuietHours(value)) {
      return;
    }

    const submittedFingerprint = [
      value.emailServiceEnabled,
      value.quietHoursEnabled,
      value.quietHoursEnabled ? value.quietHoursStartLocal : '',
      value.quietHoursEnabled ? value.quietHoursEndLocal : '',
    ].join('|');
    if (this.submittedFingerprint !== null && this.submittedFingerprint !== submittedFingerprint) {
      // The previous request may be retried with its key only while it is still the same normalized
      // command. Once the member edits a choice, reusing that key would correctly conflict server-side.
      this.idempotencyKey = crypto.randomUUID();
    }
    this.submittedFingerprint = submittedFingerprint;

    this.saving.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      await this.csrf.refresh();
      if (this.contextGeneration !== generation) {
        return;
      }

      const saved = await firstValueFrom(
        this.api.updateNotificationPreferences({
          emailServiceEnabled: value.emailServiceEnabled,
          quietHoursEnabled: value.quietHoursEnabled,
          // Leftover times are not part of a disabled window. Sending them would make two requests
          // that both mean "off" into two different commands.
          quietHoursStartLocal: value.quietHoursEnabled ? value.quietHoursStartLocal : null,
          quietHoursEndLocal: value.quietHoursEnabled ? value.quietHoursEndLocal : null,
          idempotencyKey: this.idempotencyKey,
          version: current.version,
        }),
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
      if (this.contextGeneration === generation) {
        // The form deliberately keeps what the user typed. The server refused the change, so
        // discarding their edit would cost them the work as well as the save.
        this.error.set(
          apiErrorMessage(error, $localize`Your notification settings could not be saved.`),
        );
      }
    } finally {
      if (this.contextGeneration === generation) {
        this.saving.set(false);
      }
    }
  }

  /**
   * The same rules the server enforces, checked before a round trip so an obvious mistake is
   * reported next to the field rather than as a refusal. The server remains the authority.
   */
  private validateQuietHours(value: {
    quietHoursStartLocal: string;
    quietHoursEndLocal: string;
  }): boolean {
    this.notice.set(null);
    if (
      !localTimePattern.test(value.quietHoursStartLocal) ||
      !localTimePattern.test(value.quietHoursEndLocal)
    ) {
      this.form.markAllAsTouched();
      this.error.set(
        $localize`Quiet hours need a start and an end as 24-hour times, such as 22:00.`,
      );
      return false;
    }

    if (value.quietHoursStartLocal === value.quietHoursEndLocal) {
      this.error.set(
        $localize`Quiet hours must start and end at different times. Choose an end time that differs from the start.`,
      );
      return false;
    }

    return true;
  }

  private async load(generation: number): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const loaded = await firstValueFrom(this.api.getNotificationPreferences());
      if (this.contextGeneration !== generation) {
        return;
      }

      this.apply(loaded);
    } catch (error) {
      if (this.contextGeneration === generation) {
        this.preferences.set(null);
        this.error.set(
          apiErrorMessage(error, $localize`Your notification settings could not be loaded.`),
        );
      }
    } finally {
      if (this.contextGeneration === generation) {
        this.loading.set(false);
      }
    }
  }

  private apply(preferences: NotificationPreferences): void {
    this.preferences.set(preferences);
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
    this.preferences.set(null);
    this.loading.set(false);
    this.saving.set(false);
    this.error.set(null);
    this.notice.set(null);
    this.idempotencyKey = crypto.randomUUID();
    this.submittedFingerprint = null;
  }
}
