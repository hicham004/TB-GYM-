import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import {
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  LOCALE_ID,
  signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage, featureAccessReason } from '../../core/api/api-error';
import type {
  CheckInAssignmentDetail,
  CheckInAssignmentListItem,
  FeatureAccessReason,
} from '../../core/api/generated';
import { AuthStore } from '../../core/auth/auth.store';
import { GuardedSheets, type Closable } from '../../core/forms/guarded-sheets';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button, ButtonLink } from '../../ui/button';
import { isoWeekdayOfName } from '../../ui/calendar';
import { UiConfirm } from '../../ui/confirm';
import { EmptyState } from '../../ui/empty-state';
import { Icon } from '../../ui/icon';
import { Skeleton } from '../../ui/skeleton';
import { StatusPill } from '../../ui/status-pill';
import { AssignCheckIn, type WriteForm } from './assign-checkin-sheet';
import { checkInListGroups, checkInsClosed, type CheckInContext } from './client-checkins.models';
import { ClientWorkspaceContext } from './client-workspace.context';

type ListState = 'loading' | 'ready' | 'denied' | 'error';

/**
 * A client's check-ins (C5, R4.3): what needs review first, then what is not sent yet, then what
 * was reviewed. A sent check-in opens its review; an unsent one has nothing to read yet (CHK-013).
 * Assign a check-in opens a sheet here (audit A14b), where the old Client check-ins page used to be.
 */
@Component({
  selector: 'app-client-checkins',
  imports: [
    AssignCheckIn,
    Button,
    ButtonLink,
    EmptyState,
    Icon,
    NgTemplateOutlet,
    RouterLink,
    Skeleton,
    StatusPill,
    UiConfirm,
  ],
  templateUrl: './client-checkins.html',
  styleUrl: './client-checkins.scss',
})
export class ClientCheckIns extends GuardedSheets {
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthStore);
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);
  protected readonly locale = inject(LOCALE_ID);
  private readonly tenants = inject(TenantStore);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private loadedKey: string | null = null;
  private readonly assignSheet = viewChild.required<TemplateRef<unknown>>('assignSheet');
  private readonly confirmTemplate = viewChild.required<TemplateRef<unknown>>('confirmTemplate');
  private readonly headAssign = viewChild<ElementRef<HTMLButtonElement>>('headAssign');

  protected readonly context = inject(ClientWorkspaceContext);
  protected readonly pageSize = 50;
  protected readonly items = signal<readonly CheckInAssignmentListItem[]>([]);
  protected readonly total = signal(0);
  protected readonly state = signal<ListState>('loading');
  protected readonly reason = signal<FeatureAccessReason | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly loadingMore = signal(false);
  protected readonly moreError = signal<string | null>(null);
  protected readonly loadingLabel = $localize`Loading check-ins`;

  protected readonly firstName = computed(() => this.context.profile()?.firstName ?? '');
  /** The workspace's own day and the weekday its weeks start on, for the sheet's calendar. */
  protected readonly today = computed(() => this.context.workspace()?.currentDate ?? '');
  protected readonly firstDay = computed(() =>
    isoWeekdayOfName(this.context.workspace()?.weekStartsOn),
  );
  protected readonly timeZone = computed(() => this.context.workspace()?.timeZoneId ?? null);

  private readonly checkInContext = computed<CheckInContext | null>(() => {
    const workspace = this.context.workspace();
    return workspace
      ? {
          today: workspace.currentDate,
          locale: this.locale,
          timeZone: workspace.timeZoneId,
          userId: this.auth.user()?.id ?? null,
        }
      : null;
  });

  protected readonly groups = computed(() => {
    const context = this.checkInContext();
    return context ? checkInListGroups(this.items(), context) : null;
  });

  protected readonly closed = computed(() => {
    const reason = this.reason();
    return reason ? checkInsClosed(reason, this.firstName() || $localize`This client`) : '';
  });

  /**
   * Assigning needs the workspace's own day for its calendar; without it (its read failed) the list
   * cannot load either, so the button waits. A closed feature says why instead (CHK-011).
   */
  protected readonly canAssign = computed(
    () =>
      this.state() !== 'denied' && this.context.workspace() !== null && !this.context.isFormer(),
  );

  protected readonly emptyDescription = computed(
    () =>
      $localize`Assign one and ${this.firstName()}:name:’s answers come in here, ready to read beside the last.`,
  );

  constructor() {
    super();
    this.scope.onReset(() => this.reset());
    effect(() => {
      this.scope.epoch();
      const tenantId = this.tenants.selectedTenantId();
      const clientId = this.context.clientId();
      const workspace = this.context.workspace();
      const key =
        tenantId && clientId && workspace && !this.context.isFormer()
          ? `${tenantId}:${clientId}`
          : null;
      if (key && key !== this.loadedKey) {
        this.loadedKey = key;
        void this.load();
      }
    });
  }

  protected confirmDialog(): TemplateRef<unknown> {
    return this.confirmTemplate();
  }

  /** Assign a check-in, in a sheet over the list (audit A14b). */
  protected assign(): void {
    const name = this.firstName() || $localize`this client`;
    this.show(this.assignSheet(), $localize`Assign a check-in to ${name}:name:`);
  }

  protected async assigned(detail: CheckInAssignmentDetail | null, sheet: Closable): Promise<void> {
    if (detail === null) {
      await this.closeAsking(sheet);
      return;
    }
    const name = this.firstName() || $localize`Your client`;
    // Their Today shows the check-in due first, which may be an older one: the list always has it.
    this.done(sheet, $localize`Check-in assigned. ${name}:name: finds it under Check-ins.`);
    // The new one is due, so it joins "Not sent yet"; the list is read again rather than guessed.
    await this.load();
    // The empty list's own Assign button is gone once the first check-in is listed: focus moves to
    // the one above the list, which stays.
    if (!this.document.activeElement || this.document.activeElement === this.document.body) {
      this.headAssign()?.nativeElement.focus();
    }
  }

  /** Check-ins closed while the sheet was open: it closes, and the page says why (CHK-011). */
  protected closedWhileOpen(reason: FeatureAccessReason, sheet: Closable): void {
    this.dirty = false;
    sheet.close(null);
    this.reason.set(reason);
    this.state.set('denied');
  }

  /** No form is ready to send: the library, or a new form, closing the sheet (nothing was typed). */
  protected writeForm(where: WriteForm, sheet: Closable): void {
    sheet.close(null);
    void this.router.navigate(
      where === 'new' ? ['/checkins/forms', 'new'] : ['/checkins/forms'],
      where === 'new' ? { queryParams: { start: 'weekly' } } : {},
    );
  }

  protected load(): Promise<void> {
    return this.scope.run('load', async (owner) => {
      this.error.set(null);
      this.moreError.set(null);
      // The plan already says whether check-ins are included, so a client without them is not
      // asked; the refusal names its reason instead of drawing an empty list (CHK-011).
      const decision = this.context
        .plans()
        ?.featureAccess.find((item) => item.feature === 'CheckIns');
      if (decision && !decision.isAllowed) {
        this.reason.set(decision.reason);
        this.state.set('denied');
        return;
      }

      if (this.state() !== 'ready') this.state.set('loading');
      try {
        const list = await owner.wait(
          firstValueFrom(
            this.api.listClientCheckInAssignments(this.context.clientId(), 0, this.pageSize),
          ),
        );
        this.items.set(list.items);
        this.total.set(Number(list.total));
        this.state.set('ready');
      } catch (error) {
        if (!owner.current) return;
        const reason = featureAccessReason(error);
        if (reason !== null) {
          this.reason.set(reason);
          this.state.set('denied');
        } else {
          this.error.set(
            apiErrorMessage(
              error,
              $localize`${this.firstName()}:name:’s check-ins could not be loaded.`,
            ),
          );
          this.state.set('error');
        }
      }
    });
  }

  /** Older ones, a page at a time; the list grows for as long as the coaching does. */
  protected loadMore(): Promise<void> {
    return this.scope.run('more', async (owner) => {
      if (this.loadingMore() || this.items().length >= this.total()) return;
      this.loadingMore.set(true);
      this.moreError.set(null);
      try {
        const page = await owner.wait(
          firstValueFrom(
            this.api.listClientCheckInAssignments(
              this.context.clientId(),
              this.items().length,
              this.pageSize,
            ),
          ),
        );
        const seen = new Set(this.items().map((item) => item.assignment.id));
        this.items.update((items) => [
          ...items,
          ...page.items.filter((item) => !seen.has(item.assignment.id)),
        ]);
        this.total.set(Number(page.total));
      } catch (error) {
        if (!owner.current) return;
        this.moreError.set(apiErrorMessage(error, $localize`Older check-ins could not be loaded.`));
      } finally {
        if (owner.current) this.loadingMore.set(false);
      }
    });
  }

  private reset(): void {
    this.loadedKey = null;
    this.closeSheets();
    this.items.set([]);
    this.total.set(0);
    this.state.set('loading');
    this.reason.set(null);
    this.error.set(null);
    this.loadingMore.set(false);
    this.moreError.set(null);
  }
}
