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
import { SettingsFrame } from '../settings/settings-frame';
import { settingsGroups } from '../settings/settings-groups';
import { AccountCertificatesApi } from './account-certificates-api';
import {
  CERTIFICATES_EMPTY,
  CERTIFICATES_LEDE,
  ownPillFor,
  SHOW_TO_CLIENTS,
  SWITCH_REFUSED,
  takesSwitch,
  withLine,
  type OwnCertificateLine,
} from './account-certificates.models';

type View = 'loading' | 'error' | 'missing' | 'ready';

/**
 * Settings › Your account › Certificates (notes plan N4b, CLI-021): what TB Gym shows a coach's clients
 * about them, one line per proof TB Gym recorded and confirmed, and the switch that stops a line at
 * once. Every line, its sentence, its state and whether it takes the switch are the server's reading
 * (`GET /api/coach-certificates/me`); the switch writes the server's own setting and shows what it
 * answers. Nothing here adds, edits or asks for a file: TB Gym keeps the record.
 */
@Component({
  selector: 'app-account-certificates',
  imports: [Button, ButtonLink, Checkbox, Control, RouterLink, SettingsFrame, Skeleton, StatusPill],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './account-certificates.html',
  styleUrl: './account-certificates.scss',
})
export class AccountCertificates {
  private readonly api = inject(AccountCertificatesApi);
  private readonly csrf = inject(CsrfService);
  private readonly locale = inject(LOCALE_ID);
  private readonly tenants = inject(TenantStore);
  private readonly injector = inject(Injector);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly pageHeading = viewChild<ElementRef<HTMLElement>>('pageHeading');
  // The role from the membership itself, the way the Settings frame reads it.
  private readonly role = computed(() => this.tenants.selectedMembership()?.role ?? null);
  /** The choice on its way to the server for each line that is saving. */
  private readonly pending = new Map<string, boolean>();
  /**
   * Each line's last save answer, as a count of the answers drawn: a read of the lines sent before an
   * answer may have been made before that save, so it never draws over it.
   */
  private readonly answeredAt = new Map<string, number>();
  private answers = 0;

  protected readonly lede = CERTIFICATES_LEDE;
  protected readonly empty = CERTIFICATES_EMPTY;
  protected readonly showLabel = SHOW_TO_CLIENTS;
  protected readonly refused = SWITCH_REFUSED;
  protected readonly loadingLabel = $localize`Loading your certificate lines…`;

  protected readonly state = signal<View>('loading');
  protected readonly lines = signal<readonly OwnCertificateLine[]>([]);
  /** The lines whose switch is saving now, a refusal's read of the lines included: a press waits for it. */
  protected readonly saving = signal<ReadonlySet<string>>(new Set());
  /** The lines whose choice is on its way to the server now: what "Saving your choice…" says. */
  protected readonly sending = signal<ReadonlySet<string>>(new Set());
  /** The line whose switch the server refused last, until the next press. */
  protected readonly failed = signal<string | null>(null);

  protected readonly items = computed(() =>
    this.lines().map((line) => ({
      line,
      pill: ownPillFor(line, this.locale),
      switchable: takesSwitch(line),
    })),
  );

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
      this.lines.set([]);
      this.pending.clear();
      this.answeredAt.clear();
      this.saving.set(new Set());
      this.sending.set(new Set());
      this.failed.set(null);
    });
    effect(() => {
      this.scope.epoch();
      const tenantId = this.tenants.selectedTenantId();
      const role = this.role();
      untracked(() => {
        // An owner's and a coach's own lines; the API agrees and answers anyone else nothing.
        if (tenantId === null || (role !== 'Owner' && role !== 'Coach')) {
          this.lines.set([]);
          this.state.set('missing');
          return;
        }
        void this.load();
      });
    });
    // On arrival a screen reader starts at the page's heading, as the other account pages do (§9).
    afterNextRender(() => this.pageHeading()?.nativeElement.focus({ preventScroll: true }));
  }

  /** Each switch is told apart by its line's sentence, and by the refusal under it while one shows. */
  protected describedBy(lineId: string): string {
    const sentence = `certificate-${lineId}`;
    return this.failed() === lineId ? `${sentence} ${sentence}-error` : sentence;
  }

  protected async load(): Promise<void> {
    this.state.set('loading');
    await this.scope.run('lines', async (operation) => {
      try {
        this.lines.set(await operation.wait(firstValueFrom(this.api.getOwn())));
        this.state.set('ready');
      } catch (error) {
        if (!operation.current) return;
        this.lines.set([]);
        // A refusal means this page is not theirs in this space; anything else may pass, so it offers a retry.
        this.state.set(
          error instanceof HttpErrorResponse && error.status >= 400 && error.status < 500
            ? 'missing'
            : 'error',
        );
      }
    });
  }

  /**
   * The box says "show"; the server keeps the coach's switch. It saves at once, against the version
   * the page read, and draws what the server answers, even an answer that differs from the press. The
   * box is never disabled, so keyboard focus stays on it through the save: a press meanwhile is put
   * back to the choice on its way. A refusal puts it back to what the server still holds, says so
   * under the line, and reads the lines again, since a refusal may mean TB Gym took the line down.
   */
  protected async setShown(line: OwnCertificateLine, input: HTMLInputElement): Promise<void> {
    if (this.saving().has(line.id)) {
      // A press while the line saves, or while a refusal is read again, goes back to the choice on its
      // way, or else to what the server last said.
      input.checked =
        this.pending.get(line.id) ??
        this.lines().find((item) => item.id === line.id)?.coachShows ??
        line.coachShows;
      return;
    }
    const shown = input.checked;
    this.pending.set(line.id, shown);
    this.saving.update((ids) => new Set(ids).add(line.id));
    this.sending.update((ids) => new Set(ids).add(line.id));
    this.failed.set(null);
    await this.scope.run(`save:${line.id}`, async (operation) => {
      try {
        await operation.wait(this.csrf.refresh());
        const saved = await operation.wait(
          firstValueFrom(this.api.setShown(line.id, shown, line.version)),
        );
        this.sent(line.id);
        this.answeredAt.set(line.id, ++this.answers);
        this.lines.update((lines) => withLine(lines, saved));
        // The binding writes the box only when its value changes, so an answer that differs from the
        // press would leave the press showing.
        input.checked = saved.coachShows;
      } catch {
        // Nothing is on its way any more: the refusal, not "Saving", is what the line says now.
        this.sent(line.id);
        if (!operation.current) return;
        input.checked = line.coachShows;
        this.pending.delete(line.id);
        this.failed.set(line.id);
        await this.reread();
        // A page left meanwhile, or another space opened, has nothing here to put right.
        if (!operation.current) return;
        const now = this.lines().find((item) => item.id === line.id);
        if (now && takesSwitch(now)) {
          input.checked = now.coachShows;
        } else {
          // The box and its refusal went with the line's switch (taken down or gone): there is nothing
          // left to try again, and the line's pill says why. The page's heading takes focus, so a
          // keyboard or a screen reader is not left on nothing.
          if (this.failed() === line.id) this.failed.set(null);
          this.focusHeading();
        }
      }
    });
    this.pending.delete(line.id);
    this.sent(line.id);
    this.saving.update((ids) => {
      const next = new Set(ids);
      next.delete(line.id);
      return next;
    });
  }

  /** The line's choice is no longer on its way. */
  private sent(lineId: string): void {
    if (!this.sending().has(lineId)) return;
    this.sending.update((ids) => {
      const next = new Set(ids);
      next.delete(lineId);
      return next;
    });
  }

  private async reread(): Promise<void> {
    const sent = this.answers;
    await this.scope.run('lines', async (operation) => {
      try {
        const read = await operation.wait(firstValueFrom(this.api.getOwn()));
        const shown = this.lines();
        // Another line's save that answered after this read was sent keeps its newer answer.
        this.lines.set(
          read.map((line) =>
            (this.answeredAt.get(line.id) ?? 0) > sent
              ? (shown.find((item) => item.id === line.id) ?? line)
              : line,
          ),
        );
      } catch {
        // The lines on screen stay as they were; the refusal under the line says to try again.
      }
    });
  }

  /** Only when focus fell with the box: a coach who moved on meanwhile keeps where they went. */
  private focusHeading(): void {
    afterNextRender(
      () => {
        const active = document.activeElement;
        if (active && active !== document.body) return;
        this.pageHeading()?.nativeElement.focus({ preventScroll: true });
      },
      { injector: this.injector },
    );
  }
}
