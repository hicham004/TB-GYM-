import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  LOCALE_ID,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Meta } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { apiErrorMessage } from '../../core/api/api-error';
import type { RegisterTraineeRequest, TraineeRegistrationResponse } from '../../core/api/generated';
import { AuthStore } from '../../core/auth/auth.store';
import { FormAttempt } from '../../core/forms/form-attempt';
import { dayInZone } from '../../core/i18n/house-dates';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button, ButtonLink } from '../../ui/button';
import { type DateInputStatus, DateInput } from '../../ui/date-input';
import { Control, Field } from '../../ui/field';
import { PasswordReveal } from '../../ui/password-reveal';
import { AuthFrame } from '../auth/auth-frame';
import { emailReasons, newPasswordReasons, requiredReason } from '../auth/auth-reasons';
import { LegalAcceptance } from '../legal/legal-acceptance';
import { LegalApi } from '../legal/legal-api';
import { LegalChoices } from '../legal/legal.models';
import { TrainApi } from './train-api';
import {
  ageSentence,
  birthDateReasons,
  CLOSED_SIGN_UP,
  fullSentence,
  houseMembership,
  refusalSentence,
  type TrainField,
  trainRefusal,
  type TrainSignUp,
} from './train.models';

/** The server refuses a form sent within three seconds of its stamp (WEB-002, CLI-024). */
const MINIMUM_FORM_MS = 3000;

/** Sign-up stopped being open while the form was on screen; the page has already changed state. */
class SignUpNoLongerOpen extends Error {}

/**
 * `/train/sign-up` (notes plan N9a2): the form on the model of the coach's registration. A visitor
 * creates an account, which waits for its emailed link; someone signed in signs up with the account
 * they have and joins at once (decision 34). Each refusal of N9a1's API is said in words, and one that
 * closes or fills sign-up turns the page into what `/train` says then.
 */
@Component({
  selector: 'app-train-sign-up',
  imports: [
    AuthFrame,
    Button,
    ButtonLink,
    Control,
    DateInput,
    Field,
    LegalAcceptance,
    PasswordReveal,
    ReactiveFormsModule,
    RouterLink,
  ],
  templateUrl: './train-sign-up.html',
  styleUrls: ['../auth/auth.scss', './train.scss'],
})
export class TrainSignUpPage {
  private readonly api = inject(TrainApi);
  private readonly legalApi = inject(LegalApi);
  private readonly auth = inject(AuthStore);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly router = inject(Router);
  private readonly formBuilder = inject(FormBuilder);
  private readonly locale = inject(LOCALE_ID);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly summary = viewChild<ElementRef<HTMLElement>>('summary');
  private readonly answer = viewChild<ElementRef<HTMLElement>>('answer');
  private stampedAt = 0;

  protected readonly attempt = new FormAttempt();
  protected readonly state = signal<'loading' | 'failed' | 'ready'>('loading');
  protected readonly reading = signal(false);
  protected readonly signUp = signal<TrainSignUp | null>(null);
  protected readonly submitting = signal(false);
  protected readonly signingOut = signal(false);
  protected readonly error = signal<string | null>(null);
  /** The next step a refusal names: signing in, signing out, or Today. */
  protected readonly next = signal<'sign-in' | 'sign-out' | 'today' | null>(null);
  protected readonly registration = signal<TraineeRegistrationResponse | null>(null);
  /** The server's own messages under a field, kept until that field changes. */
  protected readonly serverErrors = signal<Partial<Record<TrainField, readonly string[]>>>({});
  /** The honeypot's value, outside the form: a person never sees or reaches it. */
  protected readonly website = signal('');
  protected readonly birthDate = signal('');
  protected readonly birthStatus = signal<DateInputStatus>('empty');
  protected readonly birthLabel = $localize`Date of birth`;
  protected readonly birthHelp = $localize`For example, 27 3 1990.`;

  /** A session that ended by itself is a visitor's to the server, so the page treats it as one. */
  protected readonly signedIn = computed(() => this.auth.user() !== null && !this.auth.ended());
  protected readonly accountEmail = computed(() => this.auth.user()?.email ?? '');
  protected readonly full = computed(() =>
    fullSentence(this.signUp()?.opensAgainOn ?? null, this.locale),
  );
  /** The documents in force for a trainee (CLI-010), none while none is published. */
  protected readonly legal = new LegalChoices(() => this.legalApi.toAccept('Trainee'));
  protected readonly form = this.formBuilder.nonNullable.group({
    firstName: ['', [Validators.required, Validators.maxLength(100)]],
    lastName: ['', [Validators.required, Validators.maxLength(100)]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(12)]],
    confirmPassword: ['', Validators.required],
  });

  constructor() {
    // A form page is never listed by search engines, open or not.
    const meta = inject(Meta);
    if (meta.getTag('name="robots"') === null) {
      const robots = meta.addTag({ name: 'robots', content: 'noindex' });
      this.destroyRef.onDestroy(() => robots?.remove());
    }
    // Signed in, the account's own email is sent and no password is asked: those fields step aside.
    effect(() => {
      const signedIn = this.signedIn();
      untracked(() => {
        for (const name of ['email', 'password', 'confirmPassword'] as const) {
          const control = this.form.controls[name];
          if (signedIn) control.disable({ emitEvent: false });
          else control.enable({ emitEvent: false });
        }
      });
    });
    for (const name of ['firstName', 'lastName', 'email', 'password'] as const) {
      this.form.controls[name].valueChanges
        .pipe(takeUntilDestroyed())
        .subscribe(() => this.forget(name));
    }
    void this.load();
  }

  protected async load(): Promise<void> {
    this.reading.set(true);
    try {
      const signUp = await firstValueFrom(this.api.status());
      if (this.destroyRef.destroyed) return;
      this.stampedAt = Date.now();
      this.signUp.set(signUp);
      if (signUp.status === 'Open' && signUp.caller !== 'Joined') await this.legal.load();
      this.state.set('ready');
    } catch {
      if (!this.destroyRef.destroyed && this.signUp() === null) this.state.set('failed');
    } finally {
      this.reading.set(false);
    }
  }

  protected firstNameReasons(): string[] {
    return this.nameReasons('firstName', $localize`Enter your first name.`);
  }

  protected lastNameReasons(): string[] {
    return this.nameReasons('lastName', $localize`Enter your last name.`);
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

  protected birthReasons(): string[] {
    const zone = this.signUp()?.timeZoneId ?? null;
    return birthDateReasons(this.birthStatus(), this.birthDate(), dayInZone(new Date(), zone));
  }

  protected formReasons(): string[] {
    return [
      ...this.firstNameReasons(),
      ...this.lastNameReasons(),
      ...this.emailReasons(),
      ...this.passwordReasons(),
      ...this.confirmPasswordReasons(),
      ...this.birthReasons(),
      ...this.legal.missing(),
    ];
  }

  /** A field's messages on screen: the page's own once earned, else what the server said of it. */
  protected shown(
    field: TrainField | 'confirmPassword',
    messages: readonly string[],
  ): readonly string[] | null {
    if (this.attempt.shows(field, messages)) return messages;
    const server = field === 'confirmPassword' ? undefined : this.serverErrors()[field];
    return server && server.length > 0 ? server : null;
  }

  protected setBirthDate(value: string): void {
    this.birthDate.set(value);
    this.forget('birthDate');
  }

  protected setWebsite(event: Event): void {
    this.website.set((event.target as HTMLInputElement).value);
  }

  protected async submit(): Promise<void> {
    const signUp = this.signUp();
    if (!signUp || signUp.status !== 'Open' || this.submitting()) return;
    if (this.formReasons().length > 0) {
      this.form.markAllAsTouched();
      this.attempt.attempt();
      this.focus(this.summary);
      return;
    }

    const signedIn = this.signedIn();
    const value = this.form.getRawValue();
    if (!signedIn && value.password !== value.confirmPassword) {
      this.error.set($localize`Passwords do not match.`);
      this.next.set(null);
      this.focus(this.summary);
      return;
    }

    this.attempt.reset();
    this.submitting.set(true);
    this.error.set(null);
    this.next.set(null);
    this.serverErrors.set({});
    const before = new Set(this.tenants.memberships().map((membership) => membership.tenantId));
    try {
      const result = await this.send(
        {
          firstName: value.firstName,
          lastName: value.lastName,
          email: signedIn ? this.accountEmail() : value.email,
          birthDate: this.birthDate(),
          password: signedIn ? null : value.password,
          website: this.website(),
          legalDocumentIds: this.legal.ids(),
        },
        true,
      );
      // Left meanwhile (a retry waits up to three seconds): nothing more is shown or opened.
      if (this.destroyRef.destroyed) return;
      if (result.joined) {
        await this.openTheHouse(before);
        return;
      }
      this.clearPasswords();
      this.registration.set(result);
      this.focus(this.answer);
    } catch (error) {
      if (!this.destroyRef.destroyed) await this.explain(error);
    } finally {
      this.submitting.set(false);
    }
  }

  /** Signed in with another account than the one meant: sign out and stay, as a visitor now. */
  protected async signOut(): Promise<void> {
    this.signingOut.set(true);
    try {
      await this.auth.logout();
    } catch {
      // A session the server already dropped is what this button was for; the read below says.
    } finally {
      this.signingOut.set(false);
    }
    await this.auth.initialize(true);
    this.error.set(null);
    this.next.set(null);
    await this.load();
  }

  /**
   * One post, and at most one more: sent too soon, it waits out the rest of the minimum and tries
   * again; sent with a stamp the server no longer takes, it reads a fresh one and tries again.
   */
  private async send(
    request: Omit<RegisterTraineeRequest, 'formStamp'>,
    mayRetry: boolean,
  ): Promise<TraineeRegistrationResponse> {
    await this.csrf.refresh();
    try {
      return await firstValueFrom(
        this.api.register({ ...request, formStamp: this.signUp()?.formStamp ?? null }),
      );
    } catch (error) {
      const kind = trainRefusal(error).kind;
      if (!mayRetry || (kind !== 'too-fast' && kind !== 'stamp')) throw error;
      if (kind === 'stamp') await this.freshStamp();
      await this.waitOutTheMinimum();
      // Nothing was stored for the refused post, so a page left meanwhile sends no second one.
      if (this.destroyRef.destroyed) throw error;
      return this.send(request, false);
    }
  }

  private async freshStamp(): Promise<void> {
    const signUp = await firstValueFrom(this.api.status());
    this.stampedAt = Date.now();
    this.signUp.set(signUp);
    if (signUp.status !== 'Open' || signUp.caller === 'Joined') throw new SignUpNoLongerOpen();
  }

  private async waitOutTheMinimum(): Promise<void> {
    const remaining = MINIMUM_FORM_MS + 200 - (Date.now() - this.stampedAt);
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
  }

  private async explain(error: unknown): Promise<void> {
    if (error instanceof SignUpNoLongerOpen) {
      this.focus(this.answer);
      return;
    }
    const refusal = trainRefusal(error);
    switch (refusal.kind) {
      case 'closed':
        this.signUp.set(CLOSED_SIGN_UP);
        this.focus(this.answer);
        return;
      case 'full':
        this.signUp.update((signUp) =>
          signUp
            ? { ...signUp, status: 'Full', opensAgainOn: refusal.opensAgainOn, formStamp: null }
            : signUp,
        );
        this.focus(this.answer);
        return;
      case 'legal':
        // A document was published or replaced while the page was open: the ones in force now.
        this.error.set(await this.legal.refused());
        break;
      case 'age':
        this.serverErrors.set({ birthDate: [ageSentence(refusal.minimumAge)] });
        this.error.set(refusalSentence(refusal, this.locale));
        break;
      case 'fields':
        if (this.signedIn() && (refusal.errors.password || refusal.errors.email)) {
          await this.sessionEnded();
          break;
        }
        this.serverErrors.set(refusal.errors);
        this.error.set(refusalSentence(refusal, this.locale));
        break;
      case 'existing-account':
        this.clearPasswords();
        this.next.set('sign-in');
        this.error.set(refusalSentence(refusal, this.locale));
        break;
      case 'wrong-account':
        this.next.set('sign-out');
        this.error.set(refusalSentence(refusal, this.locale));
        break;
      case 'already-joined':
        this.next.set('today');
        this.error.set(refusalSentence(refusal, this.locale));
        break;
      case 'other':
        this.error.set(
          apiErrorMessage(
            error,
            this.signedIn()
              ? $localize`You couldn’t be signed up. Try again.`
              : $localize`Your account could not be created. Try again.`,
          ),
        );
        break;
      default:
        this.error.set(refusalSentence(refusal, this.locale));
    }
    this.focus(this.summary);
  }

  /**
   * The signed-in form asks for no email or password, so a refusal of either means the server saw no
   * session: it ended on its own (a password changed elsewhere, the session ran out). The session is read
   * again and, signed out, the page becomes a visitor's, keeping the names and date of birth typed.
   */
  private async sessionEnded(): Promise<void> {
    await this.auth.initialize(true);
    await this.load();
    if (this.signedIn()) {
      this.error.set($localize`You couldn’t be signed up. Try again.`);
      return;
    }
    this.next.set('sign-in');
    this.error.set(
      $localize`You were signed out, so this form now creates a new account. To sign up with the account you have, sign in again.`,
    );
  }

  /**
   * Today in TB Gym's own space, chosen first: someone who is also a coach's client (decision 34) may have
   * that space selected. A click meant for a new tab is the browser's.
   */
  protected async openToday(event: MouseEvent): Promise<void> {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    const name = this.signUp()?.workspaceName ?? null;
    try {
      if (!houseMembership(this.tenants.memberships(), name)) await this.tenants.load();
    } catch {
      // Today opens in the space already chosen.
    }
    const house = houseMembership(this.tenants.memberships(), name);
    if (house) this.tenants.select(house.tenantId);
    await this.router.navigateByUrl('/');
  }

  /**
   * Joined at once with the account signed in: Today opens in TB Gym's space, which the membership
   * list holds now and did not before (the answer names no workspace).
   */
  private async openTheHouse(before: ReadonlySet<string>): Promise<void> {
    try {
      await this.tenants.load();
      const name = this.signUp()?.workspaceName ?? null;
      const clients = this.tenants
        .memberships()
        .filter((membership) => membership.role === 'Client');
      const joined = clients.filter((membership) => !before.has(membership.tenantId));
      // A new membership, by the space's name first; one without it only when the list before was read
      // (or holds one space), so an unread list never sends the person to a coach's space they were in.
      const house =
        joined.find((membership) => membership.tenantName === name) ??
        (before.size > 0 || clients.length === 1 ? joined[0] : undefined);
      if (house) this.tenants.select(house.tenantId);
    } catch {
      // Today reads the memberships again on its own; the person has joined either way.
    }
    await this.router.navigateByUrl('/');
  }

  private nameReasons(field: 'firstName' | 'lastName', required: string): string[] {
    // Spaces alone are no name: the server refuses them too.
    const control = this.form.controls[field];
    if (control.value.trim() === '') return [required];
    return control.hasError('maxlength') ? [$localize`Use 100 characters or fewer.`] : [];
  }

  private forget(field: TrainField): void {
    if (this.serverErrors()[field] === undefined) return;
    this.serverErrors.update((errors) => {
      const rest = { ...errors };
      delete rest[field];
      return rest;
    });
  }

  private clearPasswords(): void {
    this.form.controls.password.reset('');
    this.form.controls.confirmPassword.reset('');
  }

  // What is about to be said renders on the next change detection; focus waits for it.
  private focus(target: () => ElementRef<HTMLElement> | undefined): void {
    afterNextRender(() => target()?.nativeElement.focus(), { injector: this.injector });
  }
}
