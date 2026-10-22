import { DatePipe } from '@angular/common';
import {
  afterNextRender,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ClientAccessStore } from '../../core/access/client-access.store';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage, featureAccessReason } from '../../core/api/api-error';
import type { CheckInAssignmentListItem, CheckInResponseDetail } from '../../core/api/generated';
import { ownCheckInDenialMessage } from '../../core/i18n/display-labels';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { initialsOf } from '../../shell/initials';
import { Avatar } from '../../ui/avatar';
import { Button, ButtonLink } from '../../ui/button';
import { drawnTogether } from '../../ui/drawn-together';
import { EmptyState } from '../../ui/empty-state';
import { Icon } from '../../ui/icon';
import { Skeleton } from '../../ui/skeleton';
import { StatusPill } from '../../ui/status-pill';
import { answeredCount, homeLists } from './checkin-flow.models';
import { responseDraftFromDetail } from './checkin-response.models';

/** Sent check-ins shown before "Show all": history is collapsed by default (§2 rule 7). */
const SENT_PREVIEW = 3;

/**
 * The client's check-ins (M6): the one due first as the page's single action, anything else still
 * open, and the ones already sent. Answering happens in `CheckInFlow`, one question per screen.
 */
@Component({
  selector: 'app-my-checkins',
  imports: [
    DatePipe,
    RouterLink,
    Avatar,
    Button,
    ButtonLink,
    EmptyState,
    Icon,
    Skeleton,
    StatusPill,
  ],
  templateUrl: './my-checkins.html',
  styleUrl: './my-checkins.scss',
})
export class MyCheckIns {
  private readonly api = inject(ApiClient);
  private readonly tenants = inject(TenantStore);
  private readonly access = inject(ClientAccessStore);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private loadedTenantId: string | null = null;

  protected readonly pageSize = 50;
  protected readonly items = signal<CheckInAssignmentListItem[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(true);
  protected readonly loadingMore = signal(false);
  protected readonly error = signal<string | null>(null);
  /**
   * Set when the server closed check-ins and said why. It replaces the lists rather than sitting
   * above them: "you may not read these" must never be shown as "you have none" (CHK-011).
   */
  protected readonly denial = signal<string | null>(null);
  protected readonly nextDetail = signal<CheckInResponseDetail | null>(null);
  /** The check-in comes from a person: their name and face sit on the card. */
  protected readonly coachName = signal<string | null>(null);
  protected readonly initialsOf = initialsOf;
  protected readonly showAllSent = signal(false);
  /** The card's two reads, its coach and its question count, have answered. */
  protected readonly cardRead = signal(false);

  protected readonly lists = computed(() => homeLists(this.items()));
  protected readonly next = computed(() => this.lists().open[0] ?? null);
  /**
   * The page is drawn once the list and the card's two reads have answered, or the card's are 1.5 s
   * late, when their lines keep their places until they land; so the coach's line and the count never
   * push the page down (audit A14a, the shift A13b measured at 0.023).
   */
  protected readonly drawn = drawnTogether(
    () => !this.loading(),
    () => this.next() === null || this.cardRead(),
  );
  protected readonly alsoOpen = computed(() => this.lists().open.slice(1));
  protected readonly sentShown = computed(() =>
    this.showAllSent() ? this.lists().sent : this.lists().sent.slice(0, SENT_PREVIEW),
  );
  protected readonly hiddenSent = computed(() =>
    Math.max(0, this.lists().sent.length - SENT_PREVIEW),
  );

  /** Question count and progress for the card, once the check-in due first has been read. */
  protected readonly nextSize = computed(() => {
    const detail = this.nextDetail();
    const next = this.next();
    if (detail === null || next === null || detail.assignment.id !== next.assignment.id) {
      return null;
    }

    const total = detail.version.questions.length;
    const answered = detail.response === null ? 0 : answeredCount(responseDraftFromDetail(detail));
    return {
      total,
      answered,
      percent: total === 0 ? 0 : Math.round((answered / total) * 100),
      note: detail.version.formDescription,
    };
  });

  constructor() {
    // A new workspace or session starts from nothing, and the effect below reloads it.
    this.scope.onReset(() => {
      this.loadedTenantId = null;
      this.reset();
    });
    effect(() => {
      this.scope.epoch();
      const tenantId = this.tenants.selectedTenantId();
      // The access answer first: check-ins it calls closed are never asked for (see `load`).
      const status = this.access.status();
      if (tenantId !== null && (status === 'idle' || status === 'loading')) return;
      if (tenantId === this.loadedTenantId) return;
      this.loadedTenantId = tenantId;
      untracked(() => {
        this.reset();
        if (tenantId !== null) void this.load();
      });
    });
    // The page heading takes focus on arrival, so a screen reader starts at "Check-ins".
    afterNextRender(() => this.heading()?.nativeElement.focus({ preventScroll: true }));
  }

  protected retry(): void {
    void this.load();
  }

  protected async loadMore(): Promise<void> {
    if (this.items().length >= this.total() || this.loadingMore()) return;
    return this.scope.run('more', async (owner) => {
      this.loadingMore.set(true);
      try {
        const page = await owner.wait(
          firstValueFrom(this.api.listOwnCheckInAssignments(this.items().length, this.pageSize)),
        );
        this.items.set(appendUnique(this.items(), page.items));
        this.total.set(Number(page.total));
      } catch (error) {
        if (owner.current) {
          this.error.set(apiErrorMessage(error, $localize`Older check-ins could not be loaded.`));
        }
      } finally {
        if (owner.current) this.loadingMore.set(false);
      }
    });
  }

  private async load(): Promise<void> {
    return this.scope.run('load', async (owner) => {
      this.loading.set(true);
      this.cardRead.set(false);
      this.error.set(null);
      this.denial.set(null);
      const access = this.access.decision('CheckIns');
      if (access?.isAllowed === false) {
        // The plan has closed check-ins (ended, paused or never in it): the page says why without
        // asking for a list the API would refuse, a 403 in the console (audit AUTH-12). When the
        // answer could not be read, the list is asked for and a refusal explains itself.
        this.items.set([]);
        this.total.set(0);
        this.denial.set(ownCheckInDenialMessage(access.reason));
        this.loading.set(false);
        return;
      }
      try {
        const page = await owner.wait(
          firstValueFrom(this.api.listOwnCheckInAssignments(0, this.pageSize)),
        );
        this.items.set(page.items);
        this.total.set(Number(page.total));
        this.loading.set(false);
      } catch (error) {
        if (!owner.current) return;
        this.items.set([]);
        this.total.set(0);
        const reason = featureAccessReason(error);
        if (reason === null) {
          this.error.set(apiErrorMessage(error, $localize`Your check-ins could not be loaded.`));
        } else {
          this.denial.set(ownCheckInDenialMessage(reason));
        }
        this.loading.set(false);
        return;
      }

      // The card's coach and question count are niceties: if either cannot be read, the card
      // simply goes without it.
      const next = this.next();
      if (next === null) return;
      const [detail, coach] = await owner.wait(
        Promise.allSettled([
          firstValueFrom(this.api.getOwnCheckInResponse(next.assignment.id)),
          firstValueFrom(this.api.getOwnCoach()),
        ]),
      );
      this.nextDetail.set(detail.status === 'fulfilled' ? detail.value : null);
      this.coachName.set(coach.status === 'fulfilled' ? coach.value.name : null);
      this.cardRead.set(true);
    });
  }

  private reset(): void {
    this.items.set([]);
    this.total.set(0);
    this.loading.set(true);
    this.cardRead.set(false);
    this.loadingMore.set(false);
    this.error.set(null);
    this.denial.set(null);
    this.nextDetail.set(null);
    this.coachName.set(null);
    this.showAllSent.set(false);
  }
}

function appendUnique(
  current: readonly CheckInAssignmentListItem[],
  incoming: readonly CheckInAssignmentListItem[],
): CheckInAssignmentListItem[] {
  const ids = new Set(current.map((item) => item.assignment.id));
  return [...current, ...incoming.filter((item) => !ids.has(item.assignment.id))];
}
