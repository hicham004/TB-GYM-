import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  computed,
  ElementRef,
  inject,
  LOCALE_ID,
  signal,
  viewChild,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import { RegistrationResponse } from '../../core/api/api.models';
import { FormAttempt } from '../../core/forms/form-attempt';
import {
  chosenCurrency,
  type CurrencyChoice,
  currencyName,
  currencyReasons,
} from '../../core/i18n/currencies';
import { deviceTimeZoneId } from '../../core/i18n/time-zones';
import { CsrfService } from '../../core/security/csrf.service';
import { Button, ButtonLink } from '../../ui/button';
import { Control, Field } from '../../ui/field';
import { PasswordReveal } from '../../ui/password-reveal';
import { type SegmentOption, SegmentedControl } from '../../ui/segmented-control';
import { TimeZoneField } from '../../ui/time-zone-field';
import { LegalAcceptance } from '../legal/legal-acceptance';
import { LegalApi } from '../legal/legal-api';
import { LEGAL_ACCEPTANCE_REQUIRED, LegalChoices } from '../legal/legal.models';
import { AuthFrame } from './auth-frame';
import { emailReasons, newPasswordReasons, requiredReason } from './auth-reasons';

/** The zone a new coaching space starts in when the device cannot say its own. */
const FALLBACK_TIME_ZONE = 'Asia/Beirut';

@Component({
  selector: 'app-register-coach',
  imports: [
    AuthFrame,
    Button,
    ButtonLink,
    Control,
    Field,
    LegalAcceptance,
    PasswordReveal,
    ReactiveFormsModule,
    RouterLink,
    SegmentedControl,
    TimeZoneField,
  ],
  templateUrl: './register-coach.html',
  styleUrl: './auth.scss',
})
export class RegisterCoach {
  private readonly api = inject(ApiClient);
  private readonly legalApi = inject(LegalApi);
  private readonly csrf = inject(CsrfService);
  private readonly formBuilder = inject(FormBuilder);
  private readonly locale = inject(LOCALE_ID);
  private readonly summary = viewChild<ElementRef<HTMLElement>>('summary');

  protected readonly attempt = new FormAttempt();

  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);
  /** The email already has an account (audit AUTH-9): the answer offers signing in or a reset. */
  protected readonly emailTaken = signal(false);
  protected readonly registration = signal<RegistrationResponse | null>(null);
  /** The legal documents in force for a new owner (audit INV-3), none while none is published. */
  protected readonly legal = new LegalChoices(() => this.legalApi.toAccept('Owner'));
  protected readonly form = this.formBuilder.nonNullable.group({
    displayName: ['', [Validators.required, Validators.maxLength(200)]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(12)]],
    confirmPassword: ['', Validators.required],
    workspaceName: ['', [Validators.required, Validators.maxLength(200)]],
  });

  /**
   * The region is chosen as Settings › Name and region chooses it (audit AUTH-5): the time zone by
   * city in a sheet, starting from this device's, and the currency in one tap or by its code.
   */
  protected readonly timeZoneId = signal(deviceTimeZoneId() ?? FALLBACK_TIME_ZONE);
  protected readonly currencyChoice = signal<CurrencyChoice>('USD');
  protected readonly otherCurrency = signal('');
  protected readonly currencyOptions: readonly SegmentOption[] = [
    { value: 'USD', label: $localize`US dollar` },
    { value: 'LBP', label: $localize`Lebanese pound` },
    { value: 'other', label: $localize`Another` },
  ];
  protected readonly currencyLine = computed(() => {
    if (currencyReasons(this.currencyChoice(), this.otherCurrency()).length > 0) return '';
    const code = chosenCurrency(this.currencyChoice(), this.otherCurrency());
    return $localize`New plans are priced in ${currencyName(code, this.locale)}:currency: (${code}:code:). You can change it later in Settings.`;
  });

  protected displayNameReasons(): string[] {
    const control = this.form.controls.displayName;
    if (control.hasError('required')) return [$localize`Enter your name.`];
    return control.hasError('maxlength') ? [$localize`Use 200 characters or fewer.`] : [];
  }

  protected workspaceNameReasons(): string[] {
    const control = this.form.controls.workspaceName;
    if (control.hasError('required')) return [$localize`Enter a name for your coaching space.`];
    return control.hasError('maxlength') ? [$localize`Use 200 characters or fewer.`] : [];
  }

  protected emailReasons(): string[] {
    return emailReasons(this.form.controls.email);
  }

  protected passwordReasons(): string[] {
    return newPasswordReasons(this.form.controls.password);
  }

  protected confirmPasswordReasons(): string[] {
    return requiredReason(
      this.form.controls.confirmPassword,
      $localize`Enter the same password again.`,
    );
  }

  protected currencyReasons(): readonly string[] {
    return currencyReasons(this.currencyChoice(), this.otherCurrency());
  }

  constructor() {
    void this.legal.load();
  }

  protected formReasons(): string[] {
    return [
      ...this.displayNameReasons(),
      ...this.workspaceNameReasons(),
      ...this.emailReasons(),
      ...this.passwordReasons(),
      ...this.confirmPasswordReasons(),
      ...this.currencyReasons(),
      ...this.legal.missing(),
    ];
  }

  protected setCurrency(value: string): void {
    this.currencyChoice.set(value as CurrencyChoice);
  }

  protected async submit(): Promise<void> {
    if (this.form.invalid || this.currencyReasons().length > 0 || this.legal.missing().length > 0) {
      this.form.markAllAsTouched();
      this.attempt.attempt();
      this.summary()?.nativeElement.focus();
      return;
    }

    const value = this.form.getRawValue();
    if (value.password !== value.confirmPassword) {
      this.error.set($localize`Passwords do not match.`);
      this.emailTaken.set(false);
      this.summary()?.nativeElement.focus();
      return;
    }

    this.attempt.reset();
    this.submitting.set(true);
    this.error.set(null);
    this.emailTaken.set(false);
    try {
      await this.csrf.refresh();
      this.registration.set(
        await firstValueFrom(
          this.api.registerCoach({
            displayName: value.displayName,
            email: value.email,
            password: value.password,
            workspaceName: value.workspaceName,
            timeZoneId: this.timeZoneId(),
            // Emails and invitations exist in English only for now, as the page says.
            defaultCulture: 'en-LB',
            defaultCurrencyCode: chosenCurrency(this.currencyChoice(), this.otherCurrency()),
            weekStartsOn: 'Monday',
            legalDocumentIds: this.legal.ids(),
          }),
        ),
      );
    } catch (error) {
      const code = error instanceof HttpErrorResponse ? error.error?.code : null;
      this.emailTaken.set(code === 'email_already_registered');
      if (code === LEGAL_ACCEPTANCE_REQUIRED) {
        // A document was published or replaced while the page was open: show the ones in force now.
        this.error.set(await this.legal.refused());
        this.summary()?.nativeElement.focus();
      } else {
        this.error.set(apiErrorMessage(error, $localize`Your coach account could not be created.`));
      }
    } finally {
      this.submitting.set(false);
    }
  }
}
