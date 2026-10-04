import { HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { apiErrorMessage } from '../../core/api/api-error';
import { FormAttempt } from '../../core/forms/form-attempt';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button } from '../../ui/button';
import { Control, Field } from '../../ui/field';
import { Icon } from '../../ui/icon';
import { Skeleton } from '../../ui/skeleton';
import { SavedRepliesApi } from './saved-replies-api';
import {
  filterReplies,
  maximumReplyLength,
  maximumTitleLength,
  replyIssues,
  type SavedReply,
} from './saved-replies.models';

/** The form is open on a reply, or on a new one when `reply` is null. */
interface Editing {
  readonly reply: SavedReply | null;
}

/**
 * A coach's saved replies, in the composer's sheet (C6, R3.5c, MSG-023): find one and drop it into
 * the composer, or keep a new one, change one or delete one. Choosing a reply never sends it; the
 * coach still reads and sends the message. The server keeps each coach's replies to themselves.
 */
@Component({
  selector: 'app-saved-replies',
  imports: [Button, Control, Field, Icon, Skeleton],
  templateUrl: './saved-replies.html',
  styleUrl: './saved-replies.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SavedRepliesSheet {
  private readonly api = inject(SavedRepliesApi);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /** What the coach has written so far, offered as a new reply's text. */
  readonly draft = input('');
  readonly use = output<string>();

  protected readonly items = signal<readonly SavedReply[] | null>(null);
  protected readonly maximum = signal(100);
  protected readonly loadFailed = signal<string | null>(null);
  protected readonly search = signal('');
  protected readonly editing = signal<Editing | null>(null);
  protected readonly title = signal('');
  protected readonly body = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly confirmingDelete = signal(false);
  protected readonly attempt = new FormAttempt();
  protected readonly maximumTitle = maximumTitleLength;
  protected readonly maximumBody = maximumReplyLength;

  private readonly titleInput = viewChild<ElementRef<HTMLInputElement>>('titleInput');
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');
  private readonly summary = viewChild<ElementRef<HTMLElement>>('summary');

  protected readonly visible = computed(() => filterReplies(this.items() ?? [], this.search()));
  protected readonly issues = computed(() => replyIssues(this.title(), this.body()));
  protected readonly atLimit = computed(() => (this.items()?.length ?? 0) >= this.maximum());

  constructor() {
    this.scope.onReset(() => {
      this.items.set(null);
      this.editing.set(null);
    });
    void this.load();
  }

  protected useReply(reply: SavedReply): void {
    this.use.emit(reply.body);
  }

  protected editLabel(reply: SavedReply): string {
    return $localize`Edit ${reply.title}:title:`;
  }

  protected submit(event: Event): void {
    event.preventDefault();
    void this.save();
  }

  /** A new reply starts from what the coach has written, when there is something. */
  protected startNew(): void {
    this.openForm(null, '', this.draft().trim());
  }

  protected startEdit(reply: SavedReply): void {
    this.openForm(reply, reply.title, reply.body);
  }

  protected backToList(): void {
    const leaving = this.editing()?.reply ?? null;
    this.editing.set(null);
    this.error.set(null);
    this.confirmingDelete.set(false);
    afterNextRender(
      () => {
        const target =
          leaving === null
            ? null
            : this.host.querySelector<HTMLElement>(`[data-reply-edit="${leaving.id}"]`);
        (target ?? this.searchInput()?.nativeElement)?.focus();
      },
      { injector: this.injector },
    );
  }

  protected async save(): Promise<void> {
    return this.scope.run('save', async (owner) => {
      const editing = this.editing();
      if (editing === null || this.busy()) return;

      this.attempt.attempt();
      const issues = this.issues();
      if (issues.title.length > 0 || issues.body.length > 0) {
        this.summary()?.nativeElement.focus();
        return;
      }

      this.busy.set(true);
      this.error.set(null);
      try {
        await owner.wait(this.csrf.refresh());
        const title = this.title().trim();
        const body = this.body().trim();
        const saved = await owner.wait(
          firstValueFrom(
            editing.reply === null
              ? this.api.create(title, body)
              : this.api.edit(editing.reply.id, title, body, editing.reply.version),
          ),
        );
        this.items.update((items) =>
          sortByTitle([...(items ?? []).filter((item) => item.id !== saved.id), saved]),
        );
        this.backToList();
      } catch (error) {
        if (!owner.current) return;
        this.error.set(this.failure(error, $localize`This reply could not be saved.`));
        if (conflictCode(error) === 'saved_reply_stale_version') void this.load();
      } finally {
        if (owner.current) this.busy.set(false);
      }
    });
  }

  protected async remove(): Promise<void> {
    return this.scope.run('remove', async (owner) => {
      const reply = this.editing()?.reply ?? null;
      if (reply === null || this.busy()) return;

      this.busy.set(true);
      this.error.set(null);
      try {
        await owner.wait(this.csrf.refresh());
        await owner.wait(firstValueFrom(this.api.delete(reply.id, reply.version)));
        this.dropFromList(reply.id);
      } catch (error) {
        if (!owner.current) return;
        if (error instanceof HttpErrorResponse && error.status === 404) {
          // Already gone, from another window: the list just catches up.
          this.dropFromList(reply.id);
          return;
        }

        this.error.set(this.failure(error, $localize`This reply could not be deleted.`));
        this.confirmingDelete.set(false);
        if (conflictCode(error) === 'saved_reply_stale_version') void this.load();
      } finally {
        if (owner.current) this.busy.set(false);
      }
    });
  }

  protected retry(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    return this.scope.run('load', async (owner) => {
      this.loadFailed.set(null);
      try {
        const replies = await owner.wait(firstValueFrom(this.api.list()));
        this.items.set(replies.items);
        this.maximum.set(replies.maximum);
      } catch (error) {
        if (!owner.current) return;
        this.loadFailed.set(
          apiErrorMessage(error, $localize`Your saved replies could not be loaded.`),
        );
      }
    });
  }

  private openForm(reply: SavedReply | null, title: string, body: string): void {
    this.attempt.reset();
    this.error.set(null);
    this.confirmingDelete.set(false);
    this.title.set(title);
    this.body.set(body);
    this.editing.set({ reply });
    afterNextRender(() => this.titleInput()?.nativeElement.focus(), { injector: this.injector });
  }

  private dropFromList(id: string): void {
    this.items.update((items) => (items ?? []).filter((item) => item.id !== id));
    this.editing.set(null);
    this.confirmingDelete.set(false);
    afterNextRender(() => this.searchInput()?.nativeElement.focus(), { injector: this.injector });
  }

  private failure(error: unknown, fallback: string): string {
    switch (conflictCode(error)) {
      case 'saved_reply_limit_reached':
        return $localize`You can keep up to ${this.maximum()}:max: saved replies. Delete one to add another.`;
      case 'saved_reply_stale_version':
        return $localize`This reply was changed in another window. The list now shows the latest version.`;
      default:
        return apiErrorMessage(error, fallback);
    }
  }
}

function conflictCode(error: unknown): string | null {
  if (!(error instanceof HttpErrorResponse) || error.status !== 409) return null;
  const body = error.error as { code?: unknown } | null;
  return typeof body?.code === 'string' ? body.code : null;
}

function sortByTitle(items: readonly SavedReply[]): readonly SavedReply[] {
  return [...items].sort((left, right) =>
    left.title.localeCompare(right.title, undefined, { sensitivity: 'base' }),
  );
}
