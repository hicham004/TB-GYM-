import { isPlatformServer } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  computed,
  inject,
  Injectable,
  InjectionToken,
  isDevMode,
  makeStateKey,
  PLATFORM_ID,
  signal,
  TransferState,
} from '@angular/core';
import { firstValueFrom, Observable } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { BodyweightUnit, CurrentUser } from '../api/api.models';
import { CsrfService } from '../security/csrf.service';
import { TenantStore } from '../tenancy/tenant.store';
import { isThemeMode, PersonalModeStore, type ThemeMode } from '../theme/personal-mode.store';

/**
 * The mark the build leaves in each pre-rendered page: the homepage, what changed and sign-in (R6.2a,
 * R6.2f, audit UIQ-13). Those documents were rendered for nobody, and a browser that starts from one
 * keeps the page on screen instead of covering it with the launch screen.
 */
export const RENDERED_SIGNED_OUT = makeStateKey<boolean>('tb-gym.rendered-signed-out');

/**
 * Whether a pre-rendered page reaches only a visitor without the sign-in cookie. nginx serves those
 * documents to such a visitor alone (`nginx.conf`, and `serve-built.mjs` as it does), so a browser that
 * starts from one has nobody to ask about and skips the session check (audit AUTH-12). The development
 * server renders those addresses for every request, cookie or not, so a development build still asks,
 * quietly, as before.
 */
export const PRERENDERED_FOR_VISITORS_ONLY = new InjectionToken<boolean>(
  'tb-gym.prerendered-for-visitors-only',
  { providedIn: 'root', factory: () => !isDevMode() },
);

/** The build-time render leaves the mark; a browser reads it. Nothing else ever sets it. */
function startedSignedOut(server: boolean, transferState: TransferState): boolean {
  if (server) transferState.set(RENDERED_SIGNED_OUT, true);
  return server || transferState.get(RENDERED_SIGNED_OUT, false);
}

@Injectable({ providedIn: 'root' })
export class AuthStore {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly theme = inject(PersonalModeStore);
  /** The build-time render of a pre-rendered page: no browser, no cookie, nothing to ask the API. */
  private readonly server = isPlatformServer(inject(PLATFORM_ID));
  private readonly startedSignedOut = startedSignedOut(this.server, inject(TransferState));
  private readonly userState = signal<CurrentUser | null>(null);
  private readonly loadingState = signal(!this.startedSignedOut);
  private readonly endedState = signal(false);
  /** The first session check of a page that began pre-rendered shows no launch screen. */
  private quietFirstLoad = this.startedSignedOut && !this.server;
  private initialization: Promise<void> | null = null;
  private sessionRequest = 0;
  /** Personal settings save one at a time: the account's concurrency stamp rejects two at once. */
  private settingsQueue: Promise<unknown> = Promise.resolve();

  readonly user = this.userState.asReadonly();
  readonly loading = this.loadingState.asReadonly();
  /**
   * The API no longer knows the session on screen (audit WEB-1): the sign-in ran out, or Sign out
   * everywhere or a password change on another device ended it. The screen stays as it is until the
   * person has left their page, where a leave guard may still hold typed work; then `expire` clears it.
   */
  readonly ended = this.endedState.asReadonly();
  /** The unit the person's own weigh-ins and progress start in (R2.5c); kilograms until saved. */
  readonly weightUnit = computed<BodyweightUnit>(
    () => this.userState()?.preferredWeightUnit ?? 'Kilogram',
  );

  constructor() {
    if (this.quietFirstLoad && inject(PRERENDERED_FOR_VISITORS_ONLY)) {
      // The page was served because the request carried no sign-in cookie, so nobody is signed in and
      // the check would only cost a request. Signing in, and any check asked for later, go to the API.
      this.quietFirstLoad = false;
      this.forgetSession();
      this.initialization = Promise.resolve();
    }
  }

  initialize(force = false): Promise<void> {
    if (!force && this.initialization) {
      return this.initialization;
    }

    this.initialization = this.server ? Promise.resolve() : this.loadSession();
    return this.initialization;
  }

  async login(email: string, password: string, rememberMe: boolean): Promise<void> {
    const request = ++this.sessionRequest;
    // The chosen workspace is kept: signing in again after a session ended lands where the person
    // was (WEB-8). `TenantStore.load` keeps it only if this account is a member there.
    this.tenants.unload();
    this.endedState.set(false);
    this.userState.set(null);
    this.theme.setMode('system');
    this.loadingState.set(true);
    try {
      await this.csrf.refresh();
      if (request !== this.sessionRequest) return;
      const user = await firstValueFrom(this.api.login({ email, password, rememberMe }));
      if (request !== this.sessionRequest) return;
      this.userState.set(user);
      this.theme.setMode(isThemeMode(user.preferredThemeMode) ? user.preferredThemeMode : 'system');
      await this.tenants.load();
    } finally {
      if (request === this.sessionRequest) this.loadingState.set(false);
    }
  }

  async logout(): Promise<void> {
    const request = ++this.sessionRequest;
    this.endedState.set(false);
    this.userState.set(null);
    this.theme.setMode('system');
    this.tenants.clear();
    this.loadingState.set(false);
    this.initialization = Promise.resolve();
    await this.csrf.refresh();
    if (request !== this.sessionRequest) return;
    await firstValueFrom(this.api.logout());
  }

  /** Records that the API no longer knows this session. Nothing on screen changes yet. */
  markEnded(): void {
    if (this.userState() !== null) this.endedState.set(true);
  }

  /**
   * Clears a session that ended by itself, once the person has left the page they were on. It sends
   * nothing, since the server has no session left to end, and unlike signing out it keeps the chosen
   * workspace, so signing in again lands where they were (WEB-8).
   */
  expire(): void {
    ++this.sessionRequest;
    this.endedState.set(false);
    this.userState.set(null);
    this.theme.setMode('system');
    this.tenants.unload();
    this.loadingState.set(false);
    this.initialization = Promise.resolve();
  }

  /**
   * Asks the API, without the launch screen, whether the browser is still signed in as the person on
   * screen: false when it is not (nobody, or another account signed in from another tab), null when
   * there is no answer (offline, a server fault) or the session changed meanwhile.
   */
  async stillSignedIn(): Promise<boolean | null> {
    const shown = this.userState();
    if (shown === null) return null;
    const request = this.sessionRequest;
    try {
      const user = await firstValueFrom(this.api.getCurrentUser());
      return request === this.sessionRequest ? user?.id === shown.id : null;
    } catch (error) {
      if (request !== this.sessionRequest) return null;
      return error instanceof HttpErrorResponse && error.status === 401 ? false : null;
    }
  }

  updateThemeMode(mode: ThemeMode): Promise<void> {
    return this.saveSetting(() => this.api.updateOwnThemeMode(mode));
  }

  updateWeightUnit(unit: BodyweightUnit): Promise<void> {
    return this.saveSetting(() => this.api.updateOwnWeightUnit(unit));
  }

  /**
   * One personal setting, saved after any earlier one has settled. The reply is the whole account,
   * and it is applied only to the session that asked: a sign-out or another account in between
   * leaves the new session alone. A failed save rejects its own caller and never blocks the next.
   */
  private saveSetting(send: () => Observable<CurrentUser>): Promise<void> {
    const request = this.sessionRequest;
    const accountId = this.userState()?.id;
    const saved = this.settingsQueue.then(async () => {
      if (request !== this.sessionRequest) return;
      // The security token belongs to the signed-in person, and sign-in itself fetched the one for
      // nobody: the first write after signing in is refused unless the token is fetched again.
      await this.csrf.refresh();
      if (request !== this.sessionRequest) return;
      const user = await firstValueFrom(send());
      if (request !== this.sessionRequest || !accountId || user.id !== accountId) return;
      this.userState.set(user);
      this.theme.setMode(isThemeMode(user.preferredThemeMode) ? user.preferredThemeMode : 'system');
    });
    this.settingsQueue = saved.catch(() => undefined);
    return saved;
  }

  private async loadSession(): Promise<void> {
    const request = ++this.sessionRequest;
    const quiet = this.quietFirstLoad;
    this.quietFirstLoad = false;
    if (!quiet) this.loadingState.set(true);
    try {
      await this.csrf.refresh();
      if (request !== this.sessionRequest) return;
      const user = await firstValueFrom(this.api.getCurrentUser());
      if (request !== this.sessionRequest) return;
      if (user === null) {
        this.forgetSession();
        return;
      }
      // Only a *different* account invalidates the persisted workspace. On a cold load there is
      // no previous user, so the stored selection is this same user's own choice and must
      // survive the refresh; `TenantStore.load` still discards an id they no longer belong to.
      const previous = this.userState();
      if (previous !== null && previous.id !== user.id) this.tenants.clear();
      this.endedState.set(false);
      this.userState.set(user);
      this.theme.setMode(isThemeMode(user.preferredThemeMode) ? user.preferredThemeMode : 'system');
      await this.tenants.load();
    } catch {
      if (request !== this.sessionRequest) return;
      this.forgetSession();
    } finally {
      if (request === this.sessionRequest) this.loadingState.set(false);
    }
  }

  /** No session: most often yesterday's ran out. The workspace stays chosen for the next sign-in. */
  private forgetSession(): void {
    this.endedState.set(false);
    this.userState.set(null);
    this.theme.setMode('system');
    this.tenants.unload();
  }
}
