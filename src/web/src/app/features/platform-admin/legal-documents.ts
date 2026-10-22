import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  LOCALE_ID,
  signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { apiErrorMessage } from '../../core/api/api-error';
import { CsrfService } from '../../core/security/csrf.service';
import { type Closable, GuardedSheets, type LeaveQuestion } from '../../core/forms/guarded-sheets';
import { Button, ButtonLink } from '../../ui/button';
import { UiConfirm } from '../../ui/confirm';
import { Icon } from '../../ui/icon';
import { Skeleton } from '../../ui/skeleton';
import { StatusPill } from '../../ui/status-pill';
import { PlatformAdminApi } from './platform-admin-api';
import {
  acceptanceLine,
  blankStart,
  inForceLine,
  legalGroups,
  startFrom,
  type LegalPublishStart,
  type LegalVersion,
} from './legal-documents.models';
import { LegalPublish } from './legal-publish';

/**
 * The platform admin's legal documents (audit INV-3, CLI-010): what people accept when they create a
 * coaching space or accept an invitation. Each document shows its version in force and who accepts it,
 * how often it was accepted, and the versions it replaced; a new version is published in a sheet from
 * reviewed text, and one published by mistake stops being asked for. TB Gym writes none of the words,
 * nothing is ever deleted, and the API authorizes the global role on every request.
 */
@Component({
  selector: 'app-legal-documents',
  imports: [Button, ButtonLink, Icon, LegalPublish, RouterLink, Skeleton, StatusPill, UiConfirm],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './legal-documents.html',
  styleUrl: './legal-documents.scss',
})
export class LegalDocuments extends GuardedSheets {
  private readonly api = inject(PlatformAdminApi);
  private readonly csrf = inject(CsrfService);
  private readonly locale = inject(LOCALE_ID);
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly publishSheet = viewChild.required<TemplateRef<unknown>>('publishSheet');
  private readonly confirmTemplate = viewChild.required<TemplateRef<unknown>>('confirmDialog');

  protected override readonly leaveQuestion: LeaveQuestion = {
    title: $localize`Discard this version?`,
    message: $localize`Close without publishing? What you typed will be lost.`,
    confirm: $localize`Discard`,
    cancel: $localize`Keep editing`,
  };

  protected readonly loadingLabel = $localize`Loading legal documents…`;
  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  /** The version a withdrawal is changing, so its buttons wait. */
  protected readonly working = signal<string | null>(null);
  protected readonly versions = signal<readonly LegalVersion[]>([]);
  protected readonly publishStart = signal<LegalPublishStart>(blankStart());
  protected readonly groups = computed(() => legalGroups(this.versions()));

  constructor() {
    super();
    afterNextRender(() => this.heading()?.nativeElement.focus({ preventScroll: true }));
    void this.load();
  }

  protected confirmDialog(): TemplateRef<unknown> {
    return this.confirmTemplate();
  }

  protected async load(): Promise<void> {
    if (this.versions().length === 0) this.state.set('loading');
    try {
      this.versions.set(await firstValueFrom(this.api.getLegalDocuments()));
      this.state.set('ready');
    } catch {
      // A reload after a publish keeps the list on screen; only a first load shows the failure.
      if (this.versions().length === 0) this.state.set('error');
    }
  }

  /** Blank, or a new version of one in force: the same document and people. */
  protected openPublish(from: LegalVersion | null): void {
    this.publishStart.set(from ? startFrom(from) : blankStart());
    const sheet = this.show<LegalVersion | null>(
      this.publishSheet(),
      $localize`Publish a legal document version`,
    );
    sheet.closed.subscribe(() => void this.load());
  }

  protected setDirty(dirty: boolean): void {
    this.dirty = dirty;
  }

  protected async finish(sheet: Closable, published: LegalVersion | null): Promise<void> {
    if (published) {
      this.done(
        sheet,
        $localize`${published.name}:document: version ${published.version}:version: is published. People who join from now on are asked to accept it.`,
      );
      return;
    }
    await this.closeAsking(sheet);
  }

  /**
   * Stops asking for a version published by mistake, after asking: nobody joining is asked for it from
   * then on, those who accepted it keep their acceptance, and its words stay readable.
   */
  protected async withdraw(version: LegalVersion): Promise<void> {
    if (this.working()) return;
    const yes = await this.ask(
      $localize`Stop asking for the ${version.name}:document: version ${version.version}:version:? People who join from now on are no longer asked to accept it. Those who accepted it keep their acceptance, and the version stays readable.`,
      $localize`Stop asking`,
      $localize`Keep it`,
      $localize`Stop asking for this version?`,
    );
    if (!yes) return;
    this.working.set(version.id);
    try {
      await this.csrf.refresh();
      await firstValueFrom(this.api.withdrawLegalDocument(version.id));
      this.toast.show(
        $localize`Nobody is asked for the ${version.name}:document: version ${version.version}:version: any more.`,
        { tone: 'success' },
      );
    } catch (error) {
      this.toast.show(
        apiErrorMessage(error, $localize`The version could not be withdrawn. Try again.`),
        { tone: 'error' },
      );
    } finally {
      this.working.set(null);
      await this.load();
    }
  }

  protected inForce(version: LegalVersion): string {
    return inForceLine(version, this.locale);
  }

  protected accepted(version: LegalVersion): string {
    return acceptanceLine(version.acceptances);
  }
}
