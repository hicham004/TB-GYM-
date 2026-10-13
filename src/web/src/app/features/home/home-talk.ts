import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  Injector,
  PLATFORM_ID,
  signal,
  viewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import { FormAttempt } from '../../core/forms/form-attempt';
import { CsrfService } from '../../core/security/csrf.service';
import { WebsiteSettingsStore } from '../../core/website/website-settings';
import { Control, Field } from '../../ui/field';

/** The server's rule: the least a person takes between the form appearing and sending it. */
export const MINIMUM_FORM_MS = 3000;

/** The server's answer when the form was sent sooner than that, or with a stamp it no longer takes. */
const TOO_FAST = 'contact_form_too_fast';
const STAMP_INVALID = 'contact_form_stamp_invalid';

const NAME_MAX = 120;
const GYM_MAX = 160;
const CONTACT_MAX = 200;
const MESSAGE_MAX = 1000;

type TalkField = 'name' | 'gymName' | 'contact' | 'message' | 'website';

/** An email address or a phone number, judged the way the server judges it. */
export function looksLikeContact(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.includes('@')) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
  const digits = trimmed.replace(/[\s\-.()]/g, '').replace(/^\+/, '');
  return /^[0-9]{7,15}$/.test(digits);
}

/**
 * Talk to us about your gym (UI plan R6.2g): the one way a gym writes to TB Gym from the homepage.
 *
 * Four fields on signals and native inputs, deliberately without Angular's forms package: the
 * homepage is the one page every visitor loads, and the package would be its only use there. The
 * server's rules are repeated here only to say them early. The form asks the server for a stamp
 * when it comes into view (or on the first touch), posts it back with the message, and answers the
 * two refusals a person can meet by waiting or by fetching a new stamp, once. A script that fills
 * the hidden "Website" field is answered as if accepted and kept nowhere. Nothing here runs at
 * build time: the page arrives with the empty form, and the stamp is asked for in the browser.
 */
@Component({
  selector: 'app-home-talk',
  imports: [Field, Control],
  templateUrl: './home-talk.html',
  styleUrl: './home-talk.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeTalk {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly settings = inject(WebsiteSettingsStore);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly section = viewChild.required<ElementRef<HTMLElement>>('section');
  private readonly summary = viewChild<ElementRef<HTMLElement>>('summary');
  private readonly doneNote = viewChild<ElementRef<HTMLElement>>('doneNote');

  private stamp: Promise<string | null> | null = null;
  private stampedAt = 0;

  protected readonly attempt = new FormAttempt();
  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly sent = signal<{ name: string; contact: string } | null>(null);
  protected readonly whatsAppLink = this.settings.whatsAppLink;

  protected readonly name = signal('');
  protected readonly gymName = signal('');
  protected readonly contact = signal('');
  protected readonly message = signal('');
  /** The honeypot: a person never sees it, so it stays empty. */
  protected readonly website = signal('');

  protected readonly nameReasons = computed(() => {
    const value = this.name().trim();
    if (value.length === 0) return [$localize`Enter your name.`];
    return value.length > NAME_MAX ? [$localize`Use ${NAME_MAX} characters or fewer.`] : [];
  });

  protected readonly gymNameReasons = computed(() => {
    const value = this.gymName().trim();
    if (value.length === 0) return [$localize`Enter the name of your gym.`];
    return value.length > GYM_MAX ? [$localize`Use ${GYM_MAX} characters or fewer.`] : [];
  });

  protected readonly contactReasons = computed(() => {
    const value = this.contact();
    if (!looksLikeContact(value)) {
      return [$localize`Enter an email address or a WhatsApp number we can reach you on.`];
    }
    return value.trim().length > CONTACT_MAX
      ? [$localize`Use ${CONTACT_MAX} characters or fewer.`]
      : [];
  });

  protected readonly messageReasons = computed(() =>
    this.message().length > MESSAGE_MAX ? [$localize`Use ${MESSAGE_MAX} characters or fewer.`] : [],
  );

  protected readonly formReasons = computed(() => [
    ...this.nameReasons(),
    ...this.gymNameReasons(),
    ...this.contactReasons(),
    ...this.messageReasons(),
  ]);

  constructor() {
    afterNextRender(() => this.watchForTheSection());
  }

  /** The first touch of the form asks for the stamp, if coming into view has not already. */
  protected wake(): void {
    this.ensureStamp();
  }

  protected write(field: TalkField, event: Event): void {
    this[field].set((event.target as HTMLInputElement | HTMLTextAreaElement).value);
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.formReasons().length > 0) {
      this.attempt.attempt();
      this.focusTheSummary();
      return;
    }

    this.attempt.reset();
    this.submitting.set(true);
    this.error.set(null);
    const value = {
      name: this.name(),
      gymName: this.gymName(),
      contact: this.contact(),
      message: this.message(),
      website: this.website(),
    };
    try {
      await this.post(value, true);
      this.sent.set({ name: value.name.trim(), contact: value.contact.trim() });
      // The note takes the form's place on the next render; focus lands on it then.
      afterNextRender(() => this.doneNote()?.nativeElement.focus(), { injector: this.injector });
    } catch (error) {
      this.error.set(this.explain(error));
      this.focusTheSummary();
    } finally {
      this.submitting.set(false);
    }
  }

  // The summary is hidden while it is empty, and what it is about to say renders on the next
  // change detection; focus has to wait for that, or it lands nowhere.
  private focusTheSummary(): void {
    afterNextRender(() => this.summary()?.nativeElement.focus(), { injector: this.injector });
  }

  /**
   * One post, and at most one more: sent too soon, it waits out the rest of the minimum and tries
   * again; sent with a stamp the server no longer takes, it fetches a fresh one and tries again
   * (which may itself have to wait).
   */
  private async post(value: Record<TalkField, string>, mayRetry: boolean): Promise<void> {
    const stamp = await this.ensureStamp();
    await this.csrf.refresh();
    try {
      await firstValueFrom(this.api.submitContactRequest({ ...value, formStamp: stamp }));
    } catch (error) {
      const code = refusalCode(error);
      if (!mayRetry || (code !== TOO_FAST && code !== STAMP_INVALID)) throw error;
      if (code === STAMP_INVALID) {
        this.stamp = null;
        await this.ensureStamp();
      }
      await this.waitOutTheMinimum();
      await this.post(value, false);
    }
  }

  private explain(error: unknown): string {
    if (error instanceof HttpErrorResponse && error.status === 429) {
      return $localize`Too many messages from this connection for now. Try again in an hour, or write to us on WhatsApp.`;
    }
    return apiErrorMessage(
      error,
      $localize`Your message could not be sent. Try again in a moment.`,
    );
  }

  private ensureStamp(): Promise<string | null> {
    if (!this.browser) return Promise.resolve(null);
    this.stamp ??= firstValueFrom(this.api.getContactForm()).then(
      (view) => {
        this.stampedAt = Date.now();
        return view.stamp;
      },
      () => {
        this.stamp = null;
        return null;
      },
    );
    return this.stamp;
  }

  private async waitOutTheMinimum(): Promise<void> {
    const remaining = MINIMUM_FORM_MS + 200 - (Date.now() - this.stampedAt);
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
  }

  // The stamp is asked for when the section scrolls into view, so a person who reads the page and
  // then fills the form has long met the minimum; a browser without the observer asks on first touch.
  private watchForTheSection(): void {
    if (!this.browser) return;
    this.settings.load();
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        this.ensureStamp();
      }
    });
    observer.observe(this.section().nativeElement);
    this.destroyRef.onDestroy(() => observer.disconnect());
  }
}

/** The stable code of a refused post, when the server sent one. */
function refusalCode(error: unknown): string | null {
  if (!(error instanceof HttpErrorResponse) || error.status !== 400) return null;
  const code = (error.error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : null;
}
