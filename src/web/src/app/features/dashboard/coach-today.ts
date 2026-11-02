import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
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
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import type { CoachClientDetails } from '../../core/api/api.models';
import type { CoachTodayView } from '../../core/api/generated';
import { AuthStore } from '../../core/auth/auth.store';
import { MessagingRealtimeService } from '../../core/messaging/messaging-realtime.service';
import { Motion, type Stop } from '../../core/motion/motion';
import { EmailDelivery } from '../../core/system/email-delivery';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Avatar } from '../../ui/avatar';
import { Button, ButtonLink, IconButton } from '../../ui/button';
import { UiDisclosure, UiDisclosureContent } from '../../ui/disclosure';
import { EmptyState } from '../../ui/empty-state';
import { Icon } from '../../ui/icon';
import { Skeleton } from '../../ui/skeleton';
import { UiToast } from '../../ui/toast';
import { ClientRelease } from '../clients/client-release';
import { StatusesHelp } from '../clients/statuses-help';
import { ConversationStarter } from '../messaging/conversation-starter';
import {
  ARRIVAL_MOMENT,
  arrivalOf,
  arriveRow,
  closeStrip,
  FAILED_POLL_MS,
  IDLE_AFTER_MS,
  IDLE_POLL_MS,
  leaveRow,
  newArrivals,
  openStrip,
  POLL_MS,
  pulseRing,
  STRIP_MS,
  type Arrival,
} from './arrival-moment';
import { buildCoachToday, claimFirstBuild } from './build-moment';
import {
  mapCoachToday,
  type ActivityRow,
  type AttentionRow,
  type CoachToday as CoachTodayModel,
} from './coach-today.models';

/** A Needs-you row on its way out (W6): the row as it was, at the place it held. */
interface Departed {
  readonly row: AttentionRow;
  readonly index: number;
}

/** A phone's width, where the feed sits under Needs you, folded with its count (critique B4b). */
const PHONE_QUERY = '(max-width: 47.99rem)';

/**
 * Coach Today (C1): who needs the coach now, this month's money received and active clients, the
 * plans ending soon or ended and not renewed, and what their clients did (critique B4b, CLI-020).
 * One read, `GET /api/coach-today`, already ranked and limited to the clients this person coaches;
 * the screen phrases it and links every row to the place its action happens. A reply from a
 * workspace the coach has just switched away from is dropped.
 *
 * It hears the phone (motion plan W6): while the tab is in view it reads again quietly every few
 * seconds, at once when a message lands, and a workout a client just finished arrives as a strip
 * under the greeting and slides into the feed. On the first read per app load it builds itself
 * (W12): the panels rise in turn, once.
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
    IconButton,
    NgTemplateOutlet,
    RouterLink,
    Skeleton,
    StatusesHelp,
    UiDisclosure,
    UiDisclosureContent,
  ],
  templateUrl: './coach-today.html',
  styleUrls: [
    './coach-today.scss',
    './coach-today-lists.scss',
    './coach-today-month.scss',
    './coach-today-live.scss',
  ],
})
export class CoachToday {
  private readonly api = inject(ApiClient);
  private readonly locale = inject(LOCALE_ID);
  private readonly auth = inject(AuthStore);
  private readonly tenants = inject(TenantStore);
  private readonly conversations = inject(ConversationStarter);
  private readonly emailDelivery = inject(EmailDelivery);
  private readonly toast = inject(UiToast);
  private readonly realtime = inject(MessagingRealtimeService);
  private readonly motion = inject(Motion);
  private readonly document = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly injector = inject(Injector);
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly endedHeading = viewChild<ElementRef<HTMLElement>>('endedHeading');
  private readonly strip = viewChild<ElementRef<HTMLElement>>('strip');

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

  /** The workout a client just finished, as the strip under the greeting (W6); leaving on its way out. */
  protected readonly arrival = signal<(Arrival & { leaving: boolean }) | null>(null);
  /** The strip's one sentence for screen readers, in a live region that is always there. */
  protected readonly arrivalWords = computed(() => {
    const arrival = this.arrival();
    if (arrival === null) return '';
    return arrival.records ? `${arrival.sentence} · ${arrival.records}` : arrival.sentence;
  });
  /** True while the quiet re-read succeeds and the tab is in view: the dot beside the feed. */
  protected readonly live = signal(false);
  /** Needs-you rows a quiet read resolved, kept in place until their leave has ended (W6). */
  private readonly departed = signal<readonly Departed[]>([]);
  /** The Needs-you rows as drawn: the server's, with the rows on their way out still in place. */
  protected readonly attention = computed(() => {
    const rows: (AttentionRow & { leaving?: boolean })[] = [...(this.today()?.attention ?? [])];
    const keys = new Set(rows.map((row) => row.key));
    for (const { row, index } of this.departed()) {
      if (!keys.has(row.key))
        rows.splice(Math.min(index, rows.length), 0, { ...row, leaving: true });
    }
    return rows;
  });
  private readonly leaves: Stop[] = [];

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

  /** The keys of the last full activity list read; null before the first read of a workspace. */
  private known: Set<string> | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private stripTimer: ReturnType<typeof setTimeout> | null = null;
  private stopStrip: Stop | null = null;
  /** The panels' rise on the first view per app load (W12), while it runs. */
  private stopBuild: Stop | null = null;
  private rereading = false;
  private readFailed = false;
  /** The last input or realtime bump; fifteen quiet minutes slow the re-read to one a minute. */
  private lastActivity = Date.now();
  private handledBumps: number;

  constructor() {
    this.scope.onReset(() => this.reset());
    effect(() => {
      this.scope.epoch();
      if (this.tenants.selectedTenantId()) void this.load();
    });
    // The greeting takes focus on arrival, so a screen reader starts at the top of Today.
    afterNextRender(() => this.heading()?.nativeElement.focus({ preventScroll: true }));

    const destroyRef = inject(DestroyRef);
    const media = typeof matchMedia === 'function' ? matchMedia(PHONE_QUERY) : null;
    if (media) {
      this.phone.set(media.matches);
      const onChange = (event: MediaQueryListEvent) => this.phone.set(event.matches);
      media.addEventListener('change', onChange);
      destroyRef.onDestroy(() => media.removeEventListener('change', onChange));
    }

    // Hearing the phone (W6): a message bumps the re-read at once; input and bumps keep its beat.
    this.handledBumps = untracked(() => this.realtime.listRefreshRequests());
    effect(() => {
      const bumps = this.realtime.listRefreshRequests();
      if (bumps === this.handledBumps) return;
      this.handledBumps = bumps;
      untracked(() => this.bump());
    });
    const document = this.document;
    const onVisibility = () => this.onVisibility();
    const onInput = () => {
      this.lastActivity = Date.now();
    };
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('pointerdown', onInput, { passive: true });
    document.addEventListener('keydown', onInput, { passive: true });
    destroyRef.onDestroy(() => {
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('pointerdown', onInput);
      document.removeEventListener('keydown', onInput);
      this.quiet();
    });
  }

  protected async load(): Promise<void> {
    return this.scope.run('today', async (owner) => {
      this.loading.set(true);
      this.failed.set(false);
      try {
        const view = await owner.wait(firstValueFrom(this.api.getCoachToday()));
        const model = this.map(view);
        this.remember(model);
        this.today.set(model);
        this.readFailed = false;
        this.live.set(this.visible());
        if (claimFirstBuild()) this.build();
      } catch {
        if (owner.current) this.failed.set(true);
      } finally {
        if (owner.current) {
          this.loading.set(false);
          this.schedule();
        }
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

  /** The strip leaves on Dismiss or at the end of its minute; a click opens the client's page (W6). */
  protected dismissArrival(): void {
    const current = this.arrival();
    if (current === null || current.leaving) return;
    this.clearStripTimer();
    this.arrival.set({ ...current, leaving: true });
    this.stopStrip = closeStrip(this.strip()?.nativeElement, this.motion, () => {
      this.stopStrip = null;
      if (this.arrival()?.leaving) this.arrival.set(null);
    });
  }

  /**
   * The quiet re-read (W6): reads Today again and swaps the view in place, never clearing it or
   * showing a failure; a finished workout that is new against the last read and happened within two
   * minutes is raised as the strip and slides into the feed.
   */
  private async reread(): Promise<void> {
    this.pollTimer = null;
    if (this.rereading || this.loading() || this.today() === null) return;
    this.rereading = true;
    await this.scope.run('live', async (owner) => {
      try {
        const view = await owner.wait(firstValueFrom(this.api.getCoachToday()));
        const model = this.map(view);
        const fresh = newArrivals(this.known, model.activity, Date.now());
        const resolved = this.resolvedRows(model);
        this.remember(model);
        this.today.set(model);
        this.readFailed = false;
        this.live.set(this.visible());
        if (resolved.length > 0) this.depart(resolved);
        if (fresh.length > 0) this.raise(fresh[0]);
      } catch {
        if (owner.current) {
          this.readFailed = true;
          this.live.set(false);
        }
      } finally {
        if (owner.current) {
          this.rereading = false;
          this.schedule();
        }
      }
    });
  }

  /** The first view per app load builds itself (W12): the panels rise once the render has drawn them. */
  private build(): void {
    afterNextRender(
      () => {
        this.stopBuild = buildCoachToday(this.host.nativeElement, this.motion);
      },
      { injector: this.injector },
    );
  }

  /** The strip under the greeting and the row's slide into the feed; a second arrival takes the strip. */
  private raise(row: ActivityRow): void {
    const wasUp = this.arrival() !== null && !this.arrival()?.leaving;
    this.stopStrip?.();
    this.stopStrip = null;
    this.clearStripTimer();
    this.arrival.set({ ...arrivalOf(row), leaving: false });
    this.stripTimer = setTimeout(() => this.dismissArrival(), STRIP_MS);
    const key = row.key.replace(/["\\]/g, '');
    afterNextRender(
      () => {
        const strip = this.strip()?.nativeElement;
        if (!wasUp) openStrip(strip, this.motion);
        pulseRing(strip?.querySelector('.arrival-ring') ?? undefined, this.motion);
        const li = this.host.nativeElement.querySelector(`li.event[data-key="${key}"]`);
        arriveRow(li ?? undefined, this.motion);
      },
      { injector: this.injector },
    );
  }

  /** The Needs-you rows the previous read had and this one has not, where motion can show them go. */
  private resolvedRows(model: CoachTodayModel): Departed[] {
    if (!this.motion.allowed(ARRIVAL_MOMENT)) return [];
    const keys = new Set(model.attention.map((row) => row.key));
    const going = new Set(this.departed().map(({ row }) => row.key));
    return (this.today()?.attention ?? [])
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => !keys.has(row.key) && !going.has(row.key));
  }

  /** Resolved rows slide out and collapse before the list closes over them. */
  private depart(resolved: Departed[]): void {
    this.departed.update((list) => [...list, ...resolved]);
    afterNextRender(
      () => {
        for (const { row } of resolved) {
          const key = row.key.replace(/["\\]/g, '');
          const li = this.host.nativeElement.querySelector(`li.need[data-key="${key}"]`);
          this.leaves.push(
            leaveRow(li ?? undefined, this.motion, () =>
              this.departed.update((list) => list.filter((gone) => gone.row.key !== row.key)),
            ),
          );
        }
      },
      { injector: this.injector },
    );
  }

  /** The next quiet read after the beat the moment's rules give; none while the tab is hidden. */
  private schedule(delay = this.beat()): void {
    this.clearPoll();
    if (!this.visible() || this.today() === null) return;
    this.pollTimer = setTimeout(() => void this.reread(), delay);
  }

  private beat(): number {
    if (this.readFailed) return FAILED_POLL_MS;
    return Date.now() - this.lastActivity >= IDLE_AFTER_MS ? IDLE_POLL_MS : POLL_MS;
  }

  /** A message landed somewhere in the workspace: read at once, and count it as activity. */
  private bump(): void {
    this.lastActivity = Date.now();
    if (!this.loading() && this.today() !== null) this.schedule(0);
  }

  /** A hidden tab reads nothing; a tab brought back reads at once. */
  private onVisibility(): void {
    if (!this.visible()) {
      this.clearPoll();
      this.live.set(false);
      return;
    }
    this.lastActivity = Date.now();
    this.schedule(0);
  }

  private visible(): boolean {
    return this.document.visibilityState !== 'hidden';
  }

  private map(view: CoachTodayView): CoachTodayModel {
    return mapCoachToday(view, {
      locale: this.locale,
      now: new Date(),
      userId: this.auth.user()?.id ?? null,
    });
  }

  private remember(model: CoachTodayModel): void {
    this.known = new Set(model.activity.map((row) => row.key));
  }

  private clearPoll(): void {
    if (this.pollTimer !== null) clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }

  private clearStripTimer(): void {
    if (this.stripTimer !== null) clearTimeout(this.stripTimer);
    this.stripTimer = null;
  }

  /** Stops hearing the phone: on destroy and on a workspace reset. */
  private quiet(): void {
    this.clearPoll();
    this.clearStripTimer();
    this.stopStrip?.();
    this.stopStrip = null;
    this.stopBuild?.();
    this.stopBuild = null;
    for (const stop of this.leaves.splice(0)) stop();
    this.departed.set([]);
    this.rereading = false;
    this.readFailed = false;
    this.known = null;
    this.live.set(false);
  }

  private reset(): void {
    this.quiet();
    this.arrival.set(null);
    this.startingChat.set(null);
    this.feedOpen.set(false);
    this.today.set(null);
    this.loading.set(true);
    this.failed.set(false);
  }
}
