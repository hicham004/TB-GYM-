import { DOCUMENT } from '@angular/common';
import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { CsrfService } from '../security/csrf.service';
import { TenantStore } from '../tenancy/tenant.store';
import type { BrandColors } from './brand-theme';

/**
 * The selected workspace's brand (plan §3.1, GAM-005), drawn everywhere its members go: the colours
 * as custom properties on <html>, and the logo for the sidebar and the client's Today.
 *
 * The brand arrives with the list of workspaces the app loads before any screen. The code that
 * derives readable tones is fetched as soon as the app starts, alongside the session requests, so it
 * is ready by then and the first frame is already in the coach's colours without carrying that code
 * in the first download. Signed out, without a workspace, and on the screens that are TB Gym's own
 * (`HOUSE_BRAND`: billing and the platform admin) the stylesheet's TB Gym colours stay.
 */
@Injectable({ providedIn: 'root' })
export class WorkspaceBrandStore {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly root = inject(DOCUMENT).documentElement;
  private readonly theme = import('./brand-theme');
  private readonly houseBrand = signal(false);
  private painted = false;
  private paints = 0;
  private readonly logo = signal<{ assetId: string; url: string } | null>(null);
  private retriedAssetId: string | null = null;

  /** The workspace's own colours, or null while it keeps TB Gym's. */
  readonly colors = computed<BrandColors | null>(() => {
    const membership = this.tenants.selectedMembership();
    return membership?.brandColor && membership.accentColor
      ? { brand: membership.brandColor, accent: membership.accentColor }
      : null;
  });

  /** The coaching space's name, shown beside its logo. */
  readonly name = computed(() => this.tenants.selectedMembership()?.tenantName ?? null);

  readonly logoAssetId = computed(() => this.tenants.selectedMembership()?.logoAssetId ?? null);

  /** The logo's content address once granted; null without a logo or until the grant arrives. */
  readonly logoUrl = computed(() => {
    const logo = this.logo();
    return logo !== null && logo.assetId === this.logoAssetId() ? logo.url : null;
  });

  constructor() {
    effect(() => {
      const colors = this.houseBrand() ? null : this.colors();
      untracked(() => void this.paint(colors));
    });
    effect(() => {
      const assetId = this.logoAssetId();
      untracked(() => void this.grant(assetId));
    });
  }

  /** True on a screen that is TB Gym's own rather than the coach's. */
  useHouseBrand(house: boolean): void {
    this.houseBrand.set(house);
  }

  /**
   * The logo image failed to load: its grant ran out while the page stayed open, or a newer logo
   * replaced it. A fresh grant is asked for once per logo, so a broken image never loops.
   */
  logoFailed(): void {
    const assetId = this.logoAssetId();
    if (assetId === null || this.retriedAssetId === assetId) {
      this.logo.set(null);
      return;
    }
    this.retriedAssetId = assetId;
    void this.grant(assetId);
  }

  private async paint(colors: BrandColors | null): Promise<void> {
    const paint = ++this.paints;
    if (colors === null && !this.painted) return;
    const { brandTokens, clearBrandTokens, safeBrand, writeBrandTokens } = await this.theme;
    if (paint !== this.paints) return;
    if (colors === null) {
      clearBrandTokens(this.root);
    } else {
      writeBrandTokens(this.root, brandTokens(safeBrand(colors)));
    }
    this.painted = colors !== null;
  }

  private async grant(assetId: string | null): Promise<void> {
    if (assetId === null) {
      this.logo.set(null);
      return;
    }
    try {
      // A grant is a POST, and the list of workspaces that names the logo arrives just after
      // signing in, while the page still holds the signed-out antiforgery token.
      await this.csrf.refresh();
      const access = await firstValueFrom(this.api.createMediaAccess(assetId));
      if (this.logoAssetId() === assetId) this.logo.set({ assetId, url: access.url });
    } catch {
      // Without a readable logo the space's initials stand in for it.
      if (this.logoAssetId() === assetId) this.logo.set(null);
    }
  }
}
