import { ChangeDetectionStrategy, Component, computed, inject, LOCALE_ID } from '@angular/core';
import { RouterLink } from '@angular/router';
import changelogMarkdown from '../../../content/changelog.md';
import { AuthStore } from '../../core/auth/auth.store';
import { formatChangeDate, parseChangelog } from '../home/changelog-parser';
import { HomeHeader } from '../home/home-header';

/**
 * What changed (UI plan R6.2f): every change a coach or a client can see, newest first, from
 * `src/content/changelog.md` at build time. The page is rendered ahead of time like the homepage,
 * so it is finished HTML with no request behind it. A signed-in person can open it too: the app's
 * own shell is around the page then, so the website's header and foot stay out of the way.
 */
@Component({
  selector: 'app-changelog',
  imports: [RouterLink, HomeHeader],
  templateUrl: './changelog.html',
  styleUrl: './changelog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Changelog {
  private readonly auth = inject(AuthStore);
  private readonly locale = inject(LOCALE_ID);
  protected readonly signedIn = computed(() => this.auth.user() !== null);
  protected readonly releases = parseChangelog(changelogMarkdown);
  protected readonly newest = this.releases[0] ? this.date(this.releases[0].date) : null;

  protected date(value: string): string {
    return formatChangeDate(value, this.locale);
  }
}
