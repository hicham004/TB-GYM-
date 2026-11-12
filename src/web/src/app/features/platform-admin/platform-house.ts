import { formatDate } from '@angular/common';
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
import type { HouseSetting } from '../../core/api/generated';
import { type Closable, GuardedSheets, type LeaveQuestion } from '../../core/forms/guarded-sheets';
import { Button } from '../../ui/button';
import { UiConfirm } from '../../ui/confirm';
import { Icon } from '../../ui/icon';
import { Skeleton } from '../../ui/skeleton';
import { StatTile } from '../../ui/stat-tile';
import { StatusPill } from '../../ui/status-pill';
import { PlatformHouseApi } from './platform-house-api';
import { PlatformHouseSetting } from './platform-house-setting';
import {
  changedLine,
  type HouseAdmin,
  houseSettingWords,
  type HouseSettingRow,
  type HouseWorkspace,
  houseZoneLabel,
  placesContext,
  settingValueText,
  signUpLine,
  signUpPill,
  weekRange,
} from './platform-house.models';

/**
 * The platform admin's House page (notes plan N9a2, ADR 0041): which coaching space is TB Gym's own, where
 * its sign-up stands this week, and its settings, each with who last changed it and when. A setting is
 * changed in a sheet; nothing is worked out here, and while no space is marked the page names the server
 * command that marks one, since that command alone may (CLI-022).
 */
@Component({
  selector: 'app-platform-house',
  imports: [
    Button,
    Icon,
    PlatformHouseSetting,
    RouterLink,
    Skeleton,
    StatTile,
    StatusPill,
    UiConfirm,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './platform-house.html',
  styleUrl: './platform-house.scss',
})
export class PlatformHouse extends GuardedSheets {
  private readonly api = inject(PlatformHouseApi);
  private readonly locale = inject(LOCALE_ID);
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly changeSheet = viewChild.required<TemplateRef<unknown>>('changeSheet');
  private readonly confirmTemplate = viewChild.required<TemplateRef<unknown>>('confirmDialog');

  protected override readonly leaveQuestion: LeaveQuestion = {
    title: $localize`Discard this change?`,
    message: $localize`Close without saving? What you typed will be lost.`,
    confirm: $localize`Discard`,
    cancel: $localize`Keep editing`,
  };

  protected readonly loadingLabel = $localize`Loading the house…`;
  /** Typed into the template, `<slug or id>` would be read as an element. */
  protected readonly houseCommand = 'platform-admin house set <slug or id>';
  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly view = signal<HouseAdmin | null>(null);
  /** The setting a sheet opened on, as it was then, with the house it belongs to. */
  protected readonly changeWith = signal<{
    readonly row: HouseSettingRow;
    readonly house: HouseWorkspace;
  } | null>(null);
  private readonly words = houseSettingWords();

  protected readonly rows = computed(() => {
    const view = this.view();
    const house = view?.house;
    if (!view || !house) return [];
    return view.settings.map((row) => ({
      row,
      words: this.words[row.setting],
      shown: settingValueText(row.value, this.locale),
      changed: changedLine(row, house, this.locale),
    }));
  });
  protected readonly zone = computed(() => {
    const house = this.view()?.house;
    return house ? houseZoneLabel(house, this.locale) : '';
  });
  protected readonly weekStartsOn = computed(() => {
    const signUp = this.view()?.signUp;
    return signUp ? formatDate(signUp.weekStartsOn, 'EEEE', this.locale) : '';
  });
  protected readonly week = computed(() => {
    const signUp = this.view()?.signUp;
    return signUp ? weekRange(signUp, this.locale) : '';
  });
  protected readonly pill = computed(() => {
    const signUp = this.view()?.signUp;
    return signUp ? signUpPill(signUp.status) : null;
  });
  protected readonly line = computed(() => {
    const signUp = this.view()?.signUp;
    return signUp ? signUpLine(signUp, this.locale) : '';
  });
  protected readonly places = computed(() =>
    placesContext(this.settingNow('SignUpsPerWeek')?.value ?? null, this.locale),
  );

  constructor() {
    super();
    afterNextRender(() => this.heading()?.nativeElement.focus({ preventScroll: true }));
    void this.load();
  }

  protected confirmDialog(): TemplateRef<unknown> {
    return this.confirmTemplate();
  }

  protected async load(): Promise<void> {
    if (this.view() === null) this.state.set('loading');
    try {
      this.view.set(await firstValueFrom(this.api.getHouse()));
      this.state.set('ready');
    } catch {
      // A read again after a change keeps the page on screen; only a first read shows the failure.
      if (this.view() === null) this.state.set('error');
    }
  }

  protected settingNow(setting: HouseSetting): HouseSettingRow | null {
    return this.view()?.settings.find((row) => row.setting === setting) ?? null;
  }

  protected openChange(row: HouseSettingRow): void {
    const house = this.view()?.house;
    if (!house) return;
    this.changeWith.set({ row, house });
    const sheet = this.show<HouseSettingRow | null>(
      this.changeSheet(),
      $localize`Change ${this.words[row.setting].inSentence}:setting:`,
    );
    sheet.closed.subscribe(() => void this.load());
  }

  protected setDirty(dirty: boolean): void {
    this.dirty = dirty;
  }

  protected async finish(sheet: Closable, saved: HouseSettingRow | null): Promise<void> {
    if (saved) {
      // The server's answer is on the page at once, so a read after it that fails never leaves the
      // old value beside a toast that names the new one.
      this.view.update((view) =>
        view
          ? {
              ...view,
              settings: view.settings.map((row) => (row.setting === saved.setting ? saved : row)),
            }
          : view,
      );
      const label = this.words[saved.setting].label;
      const shown = settingValueText(saved.value, this.locale);
      this.done(
        sheet,
        saved.value === null
          ? $localize`${label}:setting: is now empty, so sign-up is closed.`
          : saved.setting === 'SignUpsPerWeek' && Number(saved.value) === 0
            ? $localize`${label}:setting: is now ${shown}:value:, so sign-up is closed.`
            : $localize`${label}:setting: is now ${shown}:value:.`,
      );
      return;
    }
    await this.closeAsking(sheet);
  }
}
