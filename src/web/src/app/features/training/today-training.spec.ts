import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type {
  ClientTrainingDayResult,
  ClientTrainingUpcomingView,
  MediaAccessView,
} from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { press, query, settle } from '../../../testing/dom';
import { fakeMotion, type FakeMotion, provideFakeMotion } from '../../../testing/motion-fake';
import { DemoClips } from './demo-clips';
import { TodayTraining } from './today-training';

interface TodayTrainingMediaHarness {
  showMedia(assetId: string, event: Event): Promise<void>;
}

/** Today with Lower A started: Back squat, its demos the ids given. */
function dayWithDemos(mediaAssetIds: string[]): ClientTrainingDayResult {
  return {
    isAllowed: true,
    accessReason: 'Granted',
    localDate: '2026-11-13',
    workouts: [
      {
        sessionId: 'session-1',
        mesocycleId: 'mesocycle-1',
        workoutExecutionId: 'execution-1',
        name: 'Lower A',
        coachNotes: null,
        status: 'InProgress',
        notes: [],
        executionVersion: 3,
        exercises: [
          {
            prescriptionId: 'prescription-1',
            performanceId: 'exercise-performance-1',
            prescribedExerciseId: 'exercise-1',
            prescribedExerciseName: 'Back squat',
            actualExerciseId: 'exercise-1',
            actualExerciseName: 'Back squat',
            wasSubstituted: false,
            modificationPolicy: 'Locked',
            alternatives: [],
            coachNotes: null,
            mediaAssetIds,
            previousPerformance: null,
            sets: [],
          },
        ],
      },
    ],
  };
}

/** The upcoming read beside it: a program assigned, nothing else unfinished. */
function upcomingView(): ClientTrainingUpcomingView {
  return {
    isAllowed: true,
    accessReason: 'Granted',
    localDate: '2026-11-13',
    timeZoneId: 'Asia/Beirut',
    hasAssignedProgram: true,
    hasVisibleSessions: true,
    searchThrough: '2026-12-11',
    nextSession: null,
    unfinishedWorkouts: [],
    nextSkip: null,
    todayCoverage: null,
  };
}

/** An uploaded clip's grant: the same-origin address its cookie opens (MED-004). */
function clipGrant(assetId: string): MediaAccessView {
  return {
    assetId,
    kind: 'Video',
    source: 'Upload',
    contentType: 'video/webm',
    url: `/api/media/${assetId}/content`,
    expiresAtUtc: '2026-11-13T08:00:00Z',
    downloadAllowed: false,
  };
}

/** The player on that workout; motion as the fake says, or, with none, jsdom's reduced motion. */
async function renderWorkout(mediaAssetIds: string[], motion?: FakeMotion) {
  const grant = vi.fn((assetId: string) => of(clipGrant(assetId)));
  await TestBed.configureTestingModule({
    imports: [TodayTraining],
    providers: [
      provideRouter([]),
      {
        provide: ApiClient,
        useValue: {
          createMediaAccess: grant,
          getMyTrainingToday: () => of(dayWithDemos(mediaAssetIds)),
          getMyUpcomingTraining: () => of(upcomingView()),
        },
      },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
      ...(motion ? [provideFakeMotion(motion)] : []),
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(TodayTraining);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, grant };
}

describe('TodayTraining media dialog', () => {
  afterEach(() => {
    document.body.replaceChildren();
    TestBed.resetTestingModule();
  });

  it('moves focus into the rendered dialog, closes on Escape, and restores focus', async () => {
    let releaseCsrf!: () => void;
    const csrfReady = new Promise<void>((resolve) => {
      releaseCsrf = resolve;
    });
    const access: MediaAccessView = {
      assetId: 'asset-1',
      kind: 'Image',
      source: 'Upload',
      contentType: 'image/png',
      url: '/api/media/asset-1/content',
      expiresAtUtc: '2026-08-21T18:00:00Z',
      downloadAllowed: false,
    };

    await TestBed.configureTestingModule({
      imports: [TodayTraining],
      providers: [
        provideRouter([]),
        {
          provide: ApiClient,
          useValue: {
            createMediaAccess: vi.fn(() => of(access)),
            getMyTrainingToday: () =>
              of({ isAllowed: false, workouts: [], accessReason: 'NoEntitlement' }),
            getMyUpcomingTraining: () =>
              of({ isAllowed: false, unfinishedWorkouts: [], accessReason: 'NoEntitlement' }),
          },
        },
        {
          provide: CsrfService,
          useValue: { refresh: vi.fn(() => csrfReady) },
        },
        {
          provide: TenantStore,
          useValue: { selectedTenantId: signal('tenant-1') },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(TodayTraining);
    fixture.detectChanges();
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();

    let eventTarget: EventTarget | null = trigger;
    const open = (fixture.componentInstance as unknown as TodayTrainingMediaHarness).showMedia(
      access.assetId,
      {
        get currentTarget() {
          return eventTarget;
        },
      } as unknown as Event,
    );
    eventTarget = null;
    releaseCsrf();
    await open;
    fixture.detectChanges();
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    const close = host.querySelector<HTMLButtonElement>('button[aria-label="Close media"]');
    expect(close).not.toBeNull();
    expect(document.activeElement).toBe(close);

    close!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));

    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('opens a YouTube demo on YouTube in a new tab, from the same dialog, and plays nothing here', async () => {
    const access: MediaAccessView = {
      assetId: 'asset-yt',
      kind: 'Video',
      source: 'ExternalEmbed',
      contentType: null,
      url: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
      expiresAtUtc: '2026-08-21T18:00:00Z',
      downloadAllowed: false,
      externalProvider: 'YouTube',
      watchUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    };
    await TestBed.configureTestingModule({
      imports: [TodayTraining],
      providers: [
        provideRouter([]),
        {
          provide: ApiClient,
          useValue: {
            createMediaAccess: vi.fn(() => of(access)),
            getMyTrainingToday: () =>
              of({ isAllowed: false, workouts: [], accessReason: 'NoEntitlement' }),
            getMyUpcomingTraining: () =>
              of({ isAllowed: false, unfinishedWorkouts: [], accessReason: 'NoEntitlement' }),
          },
        },
        { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
        { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(TodayTraining);
    fixture.detectChanges();
    const trigger = document.createElement('button');
    document.body.append(trigger);
    await (fixture.componentInstance as unknown as TodayTrainingMediaHarness).showMedia(
      access.assetId,
      { currentTarget: trigger } as unknown as Event,
    );
    fixture.detectChanges();
    await fixture.whenStable();

    // C18 (audit WEA-2): the old 'not enabled for this beta' refusal is gone; the video's page opens.
    const host = fixture.nativeElement as HTMLElement;
    const dialog = host.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain(
      'This demo is a video on YouTube. It opens there, in a new tab.',
    );
    const link = dialog.querySelector<HTMLAnchorElement>('[data-watch-external]')!;
    expect(link.getAttribute('href')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(dialog.querySelector('video, iframe, img')).toBeNull();
    expect(host.textContent).not.toContain('not enabled for this beta');
  });

  it('plays an uploaded video like a GIF while the clips play: muted, looping, inline, its controls kept (notes plan N9b4)', async () => {
    const { fixture, host, grant } = await renderWorkout(['clip-1'], fakeMotion({ allowed: true }));

    press(host, 'Watch demo 1');
    await settle(fixture);

    expect(grant).toHaveBeenCalledExactlyOnceWith('clip-1');
    const video = query<HTMLVideoElement>(host, '.media-overlay[role="dialog"] video');
    expect(video.getAttribute('src')).toBe('/api/media/clip-1/content');
    // The property, which mutes it; the attribute alone, written after the element is made, does not.
    expect(video.muted).toBe(true);
    expect(video.hasAttribute('muted')).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.playsInline).toBe(true);
    expect(video.autoplay).toBe(true);
    // The bigger view keeps the browser's controls: the sound, a pause and the whole screen.
    expect(video.controls).toBe(true);
    expect(video.getAttribute('controlsList')).toBe('nodownload');

    // The clips paused (the clip's own pause, or a list's): the bigger view waits for its controls.
    TestBed.inject(DemoClips).pause();
    await settle(fixture);
    expect(video.autoplay).toBe(false);
    expect(video.muted).toBe(true);
    expect(video.controls).toBe(true);
  });

  it('waits for its play control under reduced motion, still muted and looping', async () => {
    const { fixture, host } = await renderWorkout(['clip-1']);

    press(host, 'Watch demo 1');
    await settle(fixture);

    const video = query<HTMLVideoElement>(host, '.media-overlay[role="dialog"] video');
    expect(video.autoplay).toBe(false);
    expect(video.hasAttribute('autoplay')).toBe(false);
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.playsInline).toBe(true);
    expect(video.controls).toBe(true);
  });
});
