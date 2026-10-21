import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject } from '@angular/core';
import { Meta } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { AuthStore } from '../../core/auth/auth.store';
import { ButtonLink } from '../../ui/button';
import { EmptyState } from '../../ui/empty-state';
import { AuthFrame } from '../auth/auth-frame';

/**
 * The page for an address the app does not have (audit AUTH-10), where every unknown address used to
 * go home without a word. Someone signed in sees it inside their own shell, with the way back to
 * Today; a visitor sees it in the signed-out frame, light like the other signed-out pages, with the
 * homepage and sign-in.
 *
 * The browser cannot answer 404 for an address of the app, so while the page is shown it asks search
 * engines not to index it. A missing file (an address with an extension, such as /sitemap.xml) gets
 * a real 404 from nginx, with the shell, so a person sees this page there too.
 */
@Component({
  selector: 'app-not-found',
  imports: [AuthFrame, ButtonLink, EmptyState, RouterLink],
  templateUrl: './not-found.html',
  styleUrls: ['../auth/auth.scss', './not-found.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotFound {
  private readonly auth = inject(AuthStore);
  protected readonly signedIn = computed(() => this.auth.user() !== null);

  constructor() {
    // A tag the document already has (the private pre-launch build's) already says it; it stays.
    const meta = inject(Meta);
    if (meta.getTag('name="robots"') === null) {
      const added = meta.addTag({ name: 'robots', content: 'noindex' });
      inject(DestroyRef).onDestroy(() => added?.remove());
    }
  }
}
