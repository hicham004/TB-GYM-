import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  LOCALE_ID,
  signal,
  viewChild,
} from '@angular/core';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthStore } from '../../core/auth/auth.store';
import { dayInZone, houseDay } from '../../core/i18n/house-dates';
import { HomeHeader } from '../home/home-header';
import { LegalApi } from './legal-api';
import { type LegalDocumentPage, toLegalDocumentPage } from './legal.models';

/**
 * One published version of a legal document (audit INV-3), at the address registration and an
 * invitation link to: its text as it was published, the sentence people tick to accept it, when it came
 * into force or was replaced, and its fingerprint. Open to anyone, signed in or not, like What changed;
 * a replaced version stays readable, as people accepted it.
 */
@Component({
  selector: 'app-legal-document',
  imports: [HomeHeader, RouterLink],
  templateUrl: './legal-document.html',
  styleUrl: './legal-document.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LegalDocument {
  private readonly api = inject(LegalApi);
  private readonly auth = inject(AuthStore);
  private readonly locale = inject(LOCALE_ID);
  private readonly route = inject(ActivatedRoute);
  private readonly title = inject(Title);
  private readonly content = viewChild<ElementRef<HTMLElement>>('content');
  private left = false;

  protected readonly signedIn = computed(() => this.auth.user() !== null);
  protected readonly state = signal<'loading' | 'ready' | 'missing' | 'error'>('loading');
  protected readonly document = signal<LegalDocumentPage | null>(null);
  protected readonly when = computed(() => {
    const document = this.document();
    if (!document) return '';
    return document.retiredAtUtc
      ? $localize`In force from ${this.day(document.publishedAtUtc)}:from: to ${this.day(document.retiredAtUtc)}:to:. A newer version has replaced it.`
      : $localize`In force since ${this.day(document.publishedAtUtc)}:since:.`;
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.left = true));
    void this.load();
  }

  /**
   * A fragment link would resolve against `<base href="/">` and load the homepage, so the skip link moves
   * focus itself, as the app shell's does.
   */
  protected skipToContent(event: Event): void {
    event.preventDefault();
    this.content()?.nativeElement.focus();
  }

  protected async load(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('documentId') ?? '';
    this.state.set('loading');
    try {
      const document = toLegalDocumentPage(await firstValueFrom(this.api.document(id)));
      this.document.set(document);
      this.state.set('ready');
      // A person who has gone on to another page keeps that page's title.
      if (!this.left) this.title.setTitle($localize`${document.name}:document: | TB Gym`);
    } catch (error) {
      // Only the server's word that no such version is published means it is missing.
      const status = error instanceof HttpErrorResponse ? error.status : 0;
      this.state.set(status === 404 || status === 400 ? 'missing' : 'error');
    }
  }

  /** The day on the reader's own clock: a platform document belongs to no workspace. */
  private day(instant: string): string {
    return houseDay(dayInZone(instant, null), this.locale, dayInZone(new Date(), null));
  }
}
