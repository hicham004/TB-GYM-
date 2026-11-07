import { HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
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
import { CsrfService } from '../../core/security/csrf.service';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button, ButtonLink } from '../../ui/button';
import { Checkbox } from '../../ui/checkbox';
import { Control } from '../../ui/field';
import { Skeleton } from '../../ui/skeleton';
import { StatusPill } from '../../ui/status-pill';
import { formatBillingDay } from '../billing/billing-access';
import { FoundingBadgeApi } from '../billing/founding-api';
import {
  FOUNDING_COACH,
  FOUNDING_COACH_LINE,
  ownerProgressLine,
  ownerTermsSentence,
  type FoundingBadge,
} from '../billing/founding.models';
import { SettingsFoundingMemo, SettingsFrame } from '../settings/settings-frame';
import { settingsGroups } from '../settings/settings-groups';

type View = 'loading' | 'error' | 'missing' | 'waiting' | 'earned';

/**
 * Settings › Your account › Founding coach (notes plan N3b, PBL-009): the owner of a founding coaching
 * space reads their badge, while it waits or once earned, and chooses whether their clients see it.
 * Every number and state is the server's reading (`GET /api/billing/founding`); the switch writes the
 * server's own setting and shows what it answers. Anyone else, or a space whose status ended or was
 * never marked, finds nothing here, as the Settings list does: each reading here is also the Settings
 * list's newest word, so the row goes the moment this page learns the status ended.
 */
@Component({
  selector: 'app-account-founding',
  imports: [Button, ButtonLink, Checkbox, Control, RouterLink, SettingsFrame, Skeleton, StatusPill],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './account-founding.html',
  styleUrl: './account-founding.scss',
})
export class AccountFounding {
  private readonly api = inject(FoundingBadgeApi);
  private readonly csrf = inject(CsrfService);
  private readonly locale = inject(LOCALE_ID);
  private readonly tenants = inject(TenantStore);
  private readonly memo = inject(SettingsFoundingMemo);
  private readonly injector = inject(Injector);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly pageHeading = viewChild<ElementRef<HTMLElement>>('pageHeading');
  private readonly nothingHeading = viewChild<ElementRef<HTMLElement>>('nothingHeading');
  // The role from the membership itself, the way the Settings frame reads it.
  private readonly role = computed(() => this.tenants.selectedMembership()?.role ?? null);

  protected readonly foundingCoach = FOUNDING_COACH;
  protected readonly line = FOUNDING_COACH_LINE;
  protected readonly loadingLabel = $localize`Loading your founding status…`;

  protected readonly state = signal<'loading' | 'ready' | 'missing' | 'error'>('loading');
  protected readonly badge = signal<FoundingBadge | null>(null);
  protected readonly saving = signal(false);
  protected readonly saveFailed = signal(false);
  /** The choice on its way to the server, while it saves. */
  private pending: boolean | null = null;

  protected readonly view = computed<View>(() => {
    const state = this.state();
    if (state !== 'ready') return state;
    const badge = this.badge();
    if (badge?.state === 'Earned') return 'earned';
    if (badge?.state === 'Waiting') return 'waiting';
    return 'missing';
  });

  protected readonly earnedOn = computed(() => this.dayOf(this.badge()?.earnedOn));
  protected readonly foundingSince = computed(() => this.dayOf(this.badge()?.foundingSince));
  protected readonly terms = computed(() => {
    const badge = this.badge();
    return badge ? ownerTermsSentence(badge.clientsNeeded, badge.monthsNeeded) : '';
  });
  protected readonly progress = computed(() => {
    const badge = this.badge();
    return badge ? ownerProgressLine(badge) : '';
  });

  /** The way back from "Nothing here": the top of the person's Settings, or Me for a client. */
  protected readonly back = computed(() => {
    const role = this.role();
    const top = settingsGroups(role)[0]?.items[0]?.link;
    if (top) return { link: top, label: $localize`Back to Settings` };
    return role === 'Client'
      ? { link: '/me', label: $localize`Back to Me` }
      : { link: '/', label: $localize`Back to Today` };
  });

  constructor() {
    this.scope.onReset(() => {
      this.badge.set(null);
      this.saving.set(false);
      this.saveFailed.set(false);
    });
    effect(() => {
      this.scope.epoch();
      const tenantId = this.tenants.selectedTenantId();
      const owner = this.role() === 'Owner';
      untracked(() => {
        // Only the space's owner holds the badge, and only they may read it (the API agrees).
        if (tenantId === null || !owner) {
          this.badge.set(null);
          this.state.set('missing');
          return;
        }
        void this.load();
      });
    });
  }

  protected async load(): Promise<void> {
    this.state.set('loading');
    await this.scope.run('badge', async (operation) => {
      try {
        const badge = await operation.wait(firstValueFrom(this.api.getBadge()));
        this.show(operation.tenantId, badge);
        this.state.set('ready');
      } catch (error) {
        if (!operation.current) return;
        this.badge.set(null);
        // A refusal means this page is not theirs; anything else may pass, so it offers a retry.
        this.state.set(
          error instanceof HttpErrorResponse && error.status >= 400 && error.status < 500
            ? 'missing'
            : 'error',
        );
      }
    });
  }

  /**
   * The box says "show"; the server keeps "hidden". It saves at once and draws what the server
   * answers, even an answer that differs from the press. The box is never disabled, so keyboard
   * focus stays on it through the save: a press meanwhile is put back to the choice on its way. A
   * refusal puts it back to what the server still holds, says so, and reads the badge again, since a
   * refusal may mean TB Gym ended the status; a press during that read goes back to the server's too.
   */
  protected async setShown(input: HTMLInputElement): Promise<void> {
    const badge = this.badge();
    if (!badge || this.saving()) {
      input.checked = !(this.pending ?? badge?.hidden ?? false);
      return;
    }
    const hidden = !input.checked;
    this.pending = hidden;
    this.saving.set(true);
    this.saveFailed.set(false);
    await this.scope.run('save', async (operation) => {
      try {
        await operation.wait(this.csrf.refresh());
        const saved = await operation.wait(firstValueFrom(this.api.setHidden(hidden)));
        this.show(operation.tenantId, saved);
        // The binding writes the box only when its value changes, so an answer that differs from
        // the press would leave the press showing.
        input.checked = !saved.hidden;
      } catch {
        if (!operation.current) return;
        input.checked = !badge.hidden;
        // Nothing is on its way any more.
        this.pending = null;
        this.saveFailed.set(true);
        await this.reread();
        // A page left meanwhile, or another space opened, has nothing here to put right.
        if (!operation.current) return;
        const now = this.badge();
        if (this.view() === 'earned' && now) {
          input.checked = !now.hidden;
        } else {
          // The box and its alert are gone with the badge: the heading of what the page now says
          // takes focus, so a keyboard or a screen reader is not left on nothing.
          this.focusHeading();
        }
      }
    });
    this.pending = null;
    this.saving.set(false);
  }

  private async reread(): Promise<void> {
    await this.scope.run('badge', async (operation) => {
      try {
        this.show(operation.tenantId, await operation.wait(firstValueFrom(this.api.getBadge())));
      } catch {
        // The badge on screen stays as it was; the refusal line says to try again.
      }
    });
  }

  /** Draws the server's reading, and gives it to the Settings list as its newest word. */
  private show(tenantId: string, badge: FoundingBadge): void {
    this.badge.set(badge);
    this.memo.write(tenantId, this.scope.epoch(), badge.state);
  }

  /** Only when focus fell with the box: an owner who moved on meanwhile keeps where they went. */
  private focusHeading(): void {
    afterNextRender(
      () => {
        const active = document.activeElement;
        if (active && active !== document.body) return;
        (this.nothingHeading() ?? this.pageHeading())?.nativeElement.focus({ preventScroll: true });
      },
      { injector: this.injector },
    );
  }

  private dayOf(date: string | null | undefined): string {
    return date ? formatBillingDay(date, this.locale) : '';
  }
}
