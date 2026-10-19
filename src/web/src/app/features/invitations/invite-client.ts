import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import type { ClientInvitation } from '../../core/api/api.models';
import { FormAttempt } from '../../core/forms/form-attempt';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button } from '../../ui/button';
import { type IsoDate } from '../../ui/calendar';
import { DateInput, type DateInputStatus } from '../../ui/date-input';
import { Control, Field } from '../../ui/field';
import { IntentIdempotencyKey } from '../training/training-assignment-state';
import { inviteErrors } from './invitations.models';

/** Who an "Invite again" fills in: the person whose link ran out or was cancelled. */
export interface InvitePrefill {
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
}

/**
 * The invite form, in a sheet (R5.3a): a name and an email, and optionally a phone number and a birth
 * date. It says what happens (they get an email with a link, or none while email is off), keeps a
 * refusal on screen in the server's words, and sends one idempotency key for one entry, so a retry of
 * the same entry is the same invitation. The server decides who may be invited and what an adult is.
 */
@Component({
  selector: 'app-invite-client',
  imports: [Button, Control, DateInput, Field],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="body" (submit)="$event.preventDefault(); submit()" novalidate>
      @if (emailOff()) {
        <p class="muted" data-email-off i18n>
          Email is off on this server, so they won’t get the link to set up their account. The
          invitation is saved; once email is on, send it again.
        </p>
      } @else {
        <p class="muted" i18n>
          We email them a link to set up their account. Send it again if it gets lost; each new link
          replaces the one before.
        </p>
      }

      <app-field [label]="firstLabel" [errors]="shows('firstName') ? errors()['firstName'] : null">
        <input
          appControl
          name="firstName"
          autocomplete="off"
          maxlength="100"
          dir="auto"
          [value]="firstName()"
          (input)="firstName.set($any($event.target).value)"
          (blur)="attempt.touch('firstName')"
        />
      </app-field>
      <app-field [label]="lastLabel" [errors]="shows('lastName') ? errors()['lastName'] : null">
        <input
          appControl
          name="lastName"
          autocomplete="off"
          maxlength="100"
          dir="auto"
          [value]="lastName()"
          (input)="lastName.set($any($event.target).value)"
          (blur)="attempt.touch('lastName')"
        />
      </app-field>
      <app-field [label]="emailLabel" [errors]="shows('email') ? errors()['email'] : null">
        <input
          appControl
          name="email"
          type="email"
          inputmode="email"
          autocomplete="off"
          spellcheck="false"
          dir="ltr"
          [value]="email()"
          (input)="email.set($any($event.target).value)"
          (blur)="attempt.touch('email')"
        />
      </app-field>
      <app-field
        [label]="phoneLabel"
        [help]="phoneHelp"
        [errors]="shows('phoneNumber') ? errors()['phoneNumber'] : null"
      >
        <input
          appControl
          name="phoneNumber"
          type="tel"
          inputmode="tel"
          autocomplete="off"
          maxlength="30"
          dir="ltr"
          [value]="phoneNumber()"
          (input)="phoneNumber.set($any($event.target).value)"
          (blur)="attempt.touch('phoneNumber')"
        />
      </app-field>
      <app-date-input
        [label]="birthLabel"
        [help]="birthHelp"
        [errors]="shows('birthDate') ? errors()['birthDate'] : null"
        [(value)]="birthDate"
        (status)="birthStatus.set($event)"
        (touched)="attempt.touch('birthDate')"
      />

      @if (attempt.wasTried() && problemCount() > 0) {
        <p class="problem-text" role="alert" i18n>Check the fields marked above.</p>
      }
      @if (error(); as message) {
        <p class="problem-text refusal" role="alert">{{ message }}</p>
      }
      <div class="actions">
        <button appButton type="button" variant="text" (click)="closed.emit(null)" i18n>
          Not now
        </button>
        <button appButton type="submit" [loading]="busy()">
          @if (busy()) {
            <ng-container i18n>Sending…</ng-container>
          } @else {
            <ng-container i18n>Send invitation</ng-container>
          }
        </button>
      </div>
    </form>
  `,
  styles: `
    :host {
      display: block;
    }

    .body {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    p {
      color: var(--tb-ink);
      margin: 0;
      overflow-wrap: anywhere;
    }

    .muted {
      color: var(--tb-muted);
      font-size: 0.875rem;
    }

    .problem-text {
      background: var(--tb-danger-soft);
      border-radius: var(--tb-radius-control);
      color: var(--tb-danger);
      font-weight: 600;
      padding: 0.625rem 0.875rem;
      // Scrolled into view clear of the sticky action bar below it.
      scroll-margin-block-end: 5rem;
    }

    .actions {
      background: var(--tb-surface);
      border-block-start: 1px solid var(--tb-line);
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      inset-block-end: -1.5rem;
      justify-content: flex-end;
      margin-block-end: -1.5rem;
      margin-inline: -1.5rem;
      padding: 0.75rem 1.5rem;
      position: sticky;
    }
  `,
})
export class InviteClient {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  /**
   * A write belongs to the workspace it started in (ADR 0026): if the workspace changes while it waits
   * for the CSRF token or the server, it is dropped, never sent to the new one and never answered into it.
   */
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly intent = new IntentIdempotencyKey();

  /** Today, for the adult rule; the server checks it against the workspace's own day. */
  readonly today = input.required<IsoDate>();
  readonly prefill = input<InvitePrefill | null>(null);
  /** This server sends no email (audit LOST-1), so the sheet must not promise one. */
  readonly emailOff = input(false);
  /** The invitation that was created, or null when the sheet was closed without one. */
  readonly closed = output<ClientInvitation | null>();
  /** Whether something has been typed that closing would lose. */
  readonly dirtyChange = output<boolean>();

  protected readonly attempt = new FormAttempt();
  protected readonly firstLabel = $localize`First name`;
  protected readonly lastLabel = $localize`Last name`;
  protected readonly emailLabel = $localize`Email`;
  protected readonly phoneLabel = $localize`Phone number (optional)`;
  protected readonly phoneHelp = $localize`So you can reach them. Only your coaching space’s staff see it.`;
  protected readonly birthLabel = $localize`Date of birth (optional)`;
  protected readonly birthHelp = $localize`For example, 27 3 1990. They can add it later.`;

  protected readonly firstName = linkedSignal(() => this.prefill()?.firstName ?? '');
  protected readonly lastName = linkedSignal(() => this.prefill()?.lastName ?? '');
  protected readonly email = linkedSignal(() => this.prefill()?.email ?? '');
  protected readonly phoneNumber = signal('');
  protected readonly birthDate = signal('');
  protected readonly birthStatus = signal<DateInputStatus>('empty');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly entry = computed(() => ({
    firstName: this.firstName(),
    lastName: this.lastName(),
    email: this.email(),
    phoneNumber: this.phoneNumber(),
    birthDate: this.birthDate(),
    birthStatus: this.birthStatus(),
  }));
  protected readonly errors = computed(() => inviteErrors(this.entry(), this.today()));
  protected readonly problemCount = computed(() => Object.keys(this.errors()).length);

  constructor() {
    effect(() => {
      const prefill = this.prefill();
      this.dirtyChange.emit(
        this.firstName().trim() !== (prefill?.firstName ?? '') ||
          this.lastName().trim() !== (prefill?.lastName ?? '') ||
          this.email().trim() !== (prefill?.email ?? '') ||
          this.phoneNumber().trim() !== '' ||
          this.birthStatus() !== 'empty',
      );
    });
  }

  protected shows(field: string): boolean {
    return this.attempt.shows(field, this.errors()[field] ?? []);
  }

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    if (this.problemCount() > 0) {
      this.attempt.attempt();
      afterNextRender(
        () => this.host.nativeElement.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
        { injector: this.injector },
      );
      return;
    }
    const request = {
      email: this.email().trim(),
      firstName: this.firstName().trim(),
      lastName: this.lastName().trim(),
      phoneNumber: this.phoneNumber().trim() || null,
      birthDate: this.birthDate() || null,
    };
    return this.scope.run('create', async (owner) => {
      this.busy.set(true);
      this.error.set(null);
      try {
        await owner.wait(this.csrf.refresh());
        const invitation = await owner.wait(
          firstValueFrom(
            this.api.createInvitation({
              ...request,
              idempotencyKey: this.intent.forPayload(request),
            }),
          ),
        );
        this.intent.complete();
        this.closed.emit(invitation);
      } catch (error) {
        if (!owner.current) return;
        this.error.set(
          apiErrorMessage(error, $localize`The invitation could not be created. Try again.`),
        );
        // The refusal is at the foot of the form, where the sticky action bar can cover it.
        afterNextRender(
          () =>
            this.host.nativeElement
              .querySelector<HTMLElement>('.refusal')
              ?.scrollIntoView?.({ block: 'nearest' }),
          { injector: this.injector },
        );
      } finally {
        if (owner.current) this.busy.set(false);
      }
    });
  }
}
