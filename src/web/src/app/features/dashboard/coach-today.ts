import { NgTemplateOutlet } from '@angular/common';
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
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import type { CoachClientDetails } from '../../core/api/api.models';
import { AuthStore } from '../../core/auth/auth.store';
import { EmailDelivery } from '../../core/system/email-delivery';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Avatar } from '../../ui/avatar';
import { Button, ButtonLink } from '../../ui/button';
import { UiDisclosure, UiDisclosureContent } from '../../ui/disclosure';
import { EmptyState } from '../../ui/empty-state';
import { Icon } from '../../ui/icon';
import { Skeleton } from '../../ui/skeleton';
import { UiToast } from '../../ui/toast';
import { ClientRelease } from '../clients/client-release';
import { StatusesHelp } from '../clients/statuses-help';
import { ConversationStarter } from '../messaging/conversation-starter';
import { mapCoachToday, type CoachToday as CoachTodayModel } from './coach-today.models';

/** A phone's width, where the feed sits under Needs you, folded with its count (critique B4b). */
const PHONE_QUERY = '(max-width: 47.99rem)';

/**
 * Coach Today (C1): who needs the coach now, this month's money received and active clients, the
 * plans ending soon or ended and not renewed, and what their clients did (critique B4b, CLI-020).
 * One read, `GET /api/coach-today`, already ranked and limited to the clients this person coaches;
 * the screen phrases it and links every row to the place its action happens. A reply from a
 * workspace the coach has just switched away from is dropped.
 */
@Component({
  selector: 'app-coach-today',
  imports: [
    Avatar,
    Button,
    ButtonLink,
    ClientRelease,
    EmptyState,
    Icon,
    NgTemplateOutlet,
    RouterLink,
    Skeleton,
    StatusesHelp,
    UiDisclosure,
    UiDisclosureContent,
  ],
  templateUrl: './coach-today.html',
  styleUrls: ['./coach-today.scss', './coach-today-lists.scss', './coach-today-month.scss'],
})
export class CoachToday {
  private readonly api = inject(ApiClient);
  private readonly locale = inject(LOCALE_ID);
  private readonly auth = inject(AuthStore);
  private readonly tenants = inject(TenantStore);
  private readonly conversations = inject(ConversationStarter);
  private readonly emailDelivery = inject(EmailDelivery);
  private readonly toast = inject(UiToast);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly injector = inject(Injector);
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly endedHeading = viewChild<ElementRef<HTMLElement>>('endedHeading');

  protected readonly today = signal<CoachTodayModel | null>(null);
  /**
   * The client whose chat Remind or Message is starting, so its button waits and a second press
   * does nothing.
   */
  protected readonly startingChat = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);
  /**
   * On a phone the feed sits under Needs you in a fold that names its count; wider, it comes last as
   * its own panel (critique B4b). Either way it is drawn once, where it is read.
   */
  protected readonly phone = signal(false);
  /** The feed starts with the newest five; Show all opens the rest (critique T2). */
  protected readonly feedOpen = signal(false);
  protected readonly feedPreview = 5;
  protected readonly activityCount = computed(() => this.today()?.activity.length ?? 0);
  protected readonly activity = computed(() => {
    const rows = this.today()?.activity ?? [];
    return this.feedOpen() ? rows : rows.slice(0, this.feedPreview);
  });

  protected readonly firstName = computed(
    () => (this.auth.user()?.displayName ?? '').trim().split(/\s+/)[0] ?? '',
  );

  /**
   * A coach on someone else's team, rather than the space's owner (audit AUTH-16): with no clients
   * yet they are welcomed to the team, not told their coaching space is ready.
   */
  protected readonly joinedTeam = computed(
    () => this.tenants.selectedMembership()?.role === 'Coach',
  );
  protected readonly teamWelcome = computed(() => {
    const space = this.tenants.selectedMembership()?.tenantName.trim();
    return space
      ? $localize`Welcome to the team at ${space}:space:`
      : $localize`Welcome to the team`;
  });

  constructor() {
    this.scope.onReset(() => this.reset());
    effect(() => {
      this.scope.epoch();
      if (this.tenants.selectedTenantId()) void this.load();
    });
    // The greeting takes focus on arrival, so a screen reader starts at the top of Today.
    afterNextRender(() => this.heading()?.nativeElement.focus({ preventScroll: true }));

    const media = typeof matchMedia === 'function' ? matchMedia(PHONE_QUERY) : null;
    if (media) {
      this.phone.set(media.matches);
      const onChange = (event: MediaQueryListEvent) => this.phone.set(event.matches);
      media.addEventListener('change', onChange);
      inject(DestroyRef).onDestroy(() => media.removeEventListener('change', onChange));
    }
  }

  protected async load(): Promise<void> {
    return this.scope.run('today', async (owner) => {
      this.loading.set(true);
      this.failed.set(false);
      try {
        const view = await owner.wait(firstValueFrom(this.api.getCoachToday()));
        this.today.set(
          mapCoachToday(view, {
            locale: this.locale,
            now: new Date(),
            userId: this.auth.user()?.id ?? null,
          }),
        );
      } catch {
        if (owner.current) this.failed.set(true);
      } finally {
        if (owner.current) this.loading.set(false);
      }
    });
  }

  /**
   * Remind for an overdue check-in (critique B4a) and Message on a plan ending soon (B4b), with no
   * chat yet: starts the coach's chat with the client, as the client page's Message does, and opens
   * it in Messages.
   */
  protected async startChat(clientId: string): Promise<void> {
    if (this.startingChat() !== null) return;
    this.startingChat.set(clientId);
    try {
      await this.conversations.open(clientId);
    } catch (error) {
      this.toast.show(
        apiErrorMessage(
          error,
          $localize`Couldn’t open this conversation. Check messaging access and retry.`,
        ),
        { tone: 'error' },
      );
    } finally {
      this.startingChat.set(null);
    }
  }

  /**
   * The owner ended a client's coaching from Ended, not renewed (ADR 0027): they are a former client
   * now, so Today is read again without them, and focus waits on the section their row left.
   */
  protected async released(profile: CoachClientDetails): Promise<void> {
    this.toast.show(
      this.emailDelivery.off()
        ? $localize`Coaching with ${profile.firstName}:name: has ended. They no longer have access. Email is off on this server, so they weren’t emailed.`
        : $localize`Coaching with ${profile.firstName}:name: has ended. They no longer have access, and we are emailing them.`,
      { tone: 'success' },
    );
    await this.load();
    afterNextRender(() => this.endedHeading()?.nativeElement.focus(), {
      injector: this.injector,
    });
  }

  private reset(): void {
    this.startingChat.set(null);
    this.feedOpen.set(false);
    this.today.set(null);
    this.loading.set(true);
    this.failed.set(false);
  }
}
