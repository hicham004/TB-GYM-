import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, throwError, type Observable } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type {
  ClientCommercialOverview,
  CoachClientDetails,
  WorkspaceDetails,
} from '../../core/api/api.models';
import type { CheckInResponseDetail } from '../../core/api/generated';
import { AuthStore } from '../../core/auth/auth.store';
import { confirmBeforeLeaving } from '../../core/forms/leave-guard';
import { UnsavedWork } from '../../core/forms/unsaved-work';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { UiToast } from '../../ui/toast';
import {
  comparisonOf,
  CURRENT_ID,
  earlierDetail,
  OLDEST_ID,
  reviewDashboard,
  reviewDetail,
  reviewList,
  REVIEW_CLIENT_ID,
} from '../../../testing/checkin-review-fixtures';
import { LEA_ID } from '../../../testing/coach-today-fixtures';
import { press, settle, type } from '../../../testing/dom';
import { mapProgressDashboard } from '../progress/progress-dashboard.models';
import { ClientCheckInReview } from './client-checkin-review';
import { ClientWorkspaceContext } from './client-workspace.context';

@Component({ template: '<p>Check-ins</p>' })
class CheckInsStub {}

const PROFILE = {
  id: REVIEW_CLIENT_ID,
  firstName: 'Maya',
  lastName: 'Fakhoury',
  onboardingStatus: 'Completed',
  version: 3,
  release: null,
} as unknown as CoachClientDetails;

type Feature = 'Training' | 'Nutrition' | 'CheckIns' | 'Messaging';

function access(closed: Partial<Record<Feature, string>> = {}) {
  return (['Training', 'Nutrition', 'CheckIns', 'Messaging'] as Feature[]).map((feature) => ({
    feature,
    isAllowed: !closed[feature],
    reason: closed[feature] ?? 'Granted',
    enrollmentId: 'enrollment-1',
    accessibleFrom: '2026-07-21',
    accessibleUntilExclusive: '2026-12-14',
  })) as ClientCommercialOverview['featureAccess'];
}

const REVIEWED = reviewDetail({
  status: 'Reviewed',
  reviewedAtUtc: '2026-10-01T12:00:00Z',
  reviewedByUserId: LEA_ID,
  version: 5,
});

interface Options {
  detail?: CheckInResponseDetail;
  closed?: Partial<Record<Feature, string>>;
  api?: Record<string, unknown>;
}

async function render(options: Options = {}) {
  const current = options.detail ?? reviewDetail();
  const earlier = earlierDetail();
  const api = {
    getClientCheckInResponse: vi.fn((): Observable<CheckInResponseDetail> => of(current)),
    listClientCheckInAssignments: vi.fn(() => of(reviewList(current))),
    compareCheckInResponses: vi.fn(() => of(comparisonOf(current, earlier))),
    getCheckInFormVersion: vi.fn(() => of(earlier.version)),
    getClientProgressDashboard: vi.fn(() => of(mapProgressDashboard(reviewDashboard()))),
    createMediaAccessBatch: vi.fn((ids: readonly string[]) =>
      of({ items: ids.map((assetId) => ({ assetId })) }),
    ),
    reviewCheckInResponse: vi.fn((): Observable<CheckInResponseDetail> => of(REVIEWED)),
    createDirectConversation: vi.fn(() => of({ conversation: { id: 'conversation-1' } })),
    sendConversationMessage: vi.fn((): Observable<unknown> => of({ id: 'message-1' })),
    ...options.api,
  };
  const csrf = { refresh: vi.fn().mockResolvedValue(undefined) };
  const toast = { show: vi.fn(() => ({ dismiss: vi.fn() })) };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'clients/:clientId/checkins', component: CheckInsStub },
        {
          path: 'clients/:clientId/checkins/:assignmentId',
          component: ClientCheckInReview,
          canDeactivate: [confirmBeforeLeaving],
        },
      ]),
      ClientWorkspaceContext,
      { provide: ApiClient, useValue: api },
      { provide: CsrfService, useValue: csrf },
      { provide: UiToast, useValue: toast },
      { provide: AuthStore, useValue: { user: signal({ id: LEA_ID }) } },
      {
        provide: TenantStore,
        useValue: { selectedTenantId: signal('tenant-1'), isOwner: signal(false) },
      },
    ],
  });
  const context = TestBed.inject(ClientWorkspaceContext);
  context.clientId.set(REVIEW_CLIENT_ID);
  context.profile.set(PROFILE);
  context.plans.set({
    clientProfileId: REVIEW_CLIENT_ID,
    isRelationshipBlocked: false,
    featureAccess: access(options.closed),
    enrollments: [],
  } as unknown as ClientCommercialOverview);
  context.workspace.set({
    currentDate: '2026-10-01',
    weekStartsOn: 'Monday',
    timeZoneId: 'Asia/Beirut',
  } as WorkspaceDetails);
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(
    `/clients/${REVIEW_CLIENT_ID}/checkins/${current.assignment.id}`,
    ClientCheckInReview,
  );
  await settle(harness.fixture);
  await settle(harness.fixture);
  return {
    harness,
    host: harness.routeNativeElement as HTMLElement,
    api,
    toast,
    router: TestBed.inject(Router),
  };
}

const all = (host: ParentNode, selector: string) =>
  Array.from(host.querySelectorAll<HTMLElement>(selector));
const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const primary = (host: HTMLElement) => textOf(host.querySelector('button.primary'));
const alertText = (host: HTMLElement) => textOf(host.querySelector('#reply-summary'));

/** Waits, a macrotask at a time, for a dialog with this title to open. */
async function dialogNamed(fixture: { detectChanges(): void }, title: string) {
  for (let attempt = 0; attempt < 50; attempt++) {
    fixture.detectChanges();
    const open = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).find(
      (dialog) => textOf(dialog.querySelector('h2')) === title,
    );
    if (open) return open;
    await new Promise((resolve) => setTimeout(resolve));
  }
  throw new Error(`No dialog titled "${title}" opened.`);
}

function named(host: ParentNode, name: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).filter(
    (candidate) => textOf(candidate) === name,
  );
  if (found.length !== 1) throw new Error(`${found.length} buttons are named "${name}".`);
  return found[0];
}

describe('a check-in under review', () => {
  afterEach(() => {
    document.body
      .querySelectorAll('.cdk-overlay-container')
      .forEach((node) => node.replaceChildren());
    TestBed.resetTestingModule();
  });

  describe('reading it', () => {
    it('says what it is, when it came and how late, with what it needs', async () => {
      const { host } = await render();

      expect(textOf(host.querySelector('h2.title'))).toBe('Weekly check-in');
      expect(textOf(host.querySelector('.facts-line'))).toBe(
        'Sent Thu 1 Oct · Due Wed 30 Sep · 1 day late',
      );
      expect(textOf(host.querySelector('app-status-pill'))).toBe('Needs review');
      expect(primary(host)).toBe('Mark reviewed');
    });

    it('lays every answer beside last week’s and marks the five that differ', async () => {
      const { host, api } = await render();

      expect(api.compareCheckInResponses).toHaveBeenCalledWith(
        REVIEW_CLIENT_ID,
        `response-${CURRENT_ID}`,
        'response-assignment-23-sep',
      );
      expect(all(host, '.row .prompt').map(textOf)).toEqual([
        'How was your energy this week?',
        'How well did you sleep?',
        'How stressed did you feel?',
        'How closely did you follow your plan?',
        'What was your biggest win this week?',
        'Anything else I should know?',
      ]);
      expect(all(host, '.row.changed .prompt').map(textOf)).toEqual([
        'How was your energy this week?',
        'How stressed did you feel?',
        'How closely did you follow your plan?',
        'What was your biggest win this week?',
        'Anything else I should know?',
      ]);
      expect(all(host, '.tag-changed').map(textOf)).toEqual(Array(5).fill('Changed'));
      expect(textOf(host.querySelector('.answers-line'))).toBe(
        '5 answers are different from Wed 23 Sep.',
      );

      const energy = host.querySelector<HTMLElement>('.row')!;
      expect(all(energy, '.when').map(textOf)).toEqual(['This time', 'Wed 23 Sep']);
      expect(all(energy, '.figure-answer').map(textOf)).toEqual(['8 out of 10', '6 out of 10']);
      expect(textOf(all(host, '.row')[5].querySelector('.before .blank'))).toBe('No answer');
    });

    it('never says an answer got better or worse (CHK-012)', async () => {
      const { host } = await render();
      const answers = textOf(host.querySelector('.answers'));

      for (const judgement of ['better', 'worse', 'improved', '↑', '↓', '+2', '−3']) {
        expect(answers).not.toContain(judgement);
      }
    });

    it('reads it beside another earlier check-in when asked', async () => {
      const { host, api, harness } = await render();

      named(host, 'Compare with another').click();
      await settle(harness.fixture);
      const choices = all(host, '.item .item-title').map(textOf);
      expect(choices).toEqual(['Sent Wed 23 Sep', 'Sent Wed 16 Sep']);
      all(host, '.item')[1].click();
      await settle(harness.fixture);

      expect(api.compareCheckInResponses).toHaveBeenLastCalledWith(
        REVIEW_CLIENT_ID,
        `response-${CURRENT_ID}`,
        `response-${OLDEST_ID}`,
      );
      expect(all(host.querySelector('.row')!, '.when').map(textOf)).toEqual([
        'This time',
        'Wed 16 Sep',
      ]);
    });

    it('stands alone when it is the first of its form', async () => {
      const first = reviewDetail();
      const { host, api } = await render({
        detail: first,
        api: {
          listClientCheckInAssignments: vi.fn(() =>
            of({
              clientProfileId: REVIEW_CLIENT_ID,
              total: 1,
              items: [reviewList(first).items[1]],
            }),
          ),
        },
      });

      expect(api.compareCheckInResponses).not.toHaveBeenCalled();
      expect(textOf(host.querySelector('.answers-line'))).toBe(
        'Maya’s first Weekly check-in, so there is nothing earlier to read it beside.',
      );
      expect(host.querySelector('.when')).toBeNull();
      expect(all(host, '.row').length).toBe(6);
    });

    it('shows the weight and the photos up to the day it was sent, by their own dates', async () => {
      const { host, api } = await render();

      expect(api.getClientProgressDashboard).toHaveBeenCalledWith(
        REVIEW_CLIENT_ID,
        '2026-07-10',
        '2026-10-02',
      );
      expect(textOf(host.querySelector('.weight .figure'))).toBe('71.4 kg');
      expect(textOf(host.querySelector('.weight .delta'))).toBe('↓ 0.4 kg on the week before');
      expect(textOf(host.querySelector('.weight .panel-span'))).toBe('12 weeks to Thu 1 Oct');
      expect(api.createMediaAccessBatch).toHaveBeenCalledWith([
        'asset-front-2-sep',
        'asset-front-23-sep',
        'asset-front-1-oct',
        'asset-side-1-oct',
      ]);
      const compare = host.querySelector('app-photo-compare');
      expect(all(compare!, 'img').map((img) => img.getAttribute('src'))).toEqual([
        '/api/media/asset-front-23-sep/content/thumbnail',
        '/api/media/asset-front-1-oct/content/thumbnail',
      ]);
      expect(all(compare!, '.control span').map(textOf)).toEqual(['Wed 23 Sep', 'Thu 1 Oct']);
      expect(all(host, '.poses label').map(textOf)).toEqual(['Front', 'Side']);
      expect(textOf(host.querySelector('.photo-note'))).toBe(
        'From Maya’s progress photos, by the day each was taken.',
      );
    });

    it('starts on the first pose and shows a pose with one photo on its own', async () => {
      const { host, harness } = await render();
      const poses = () => all(host, '.poses input') as HTMLInputElement[];

      expect(poses().map((radio) => radio.checked)).toEqual([true, false]);
      poses()[1].click();
      await settle(harness.fixture);

      expect(host.querySelector('app-photo-compare')).toBeNull();
      expect(host.querySelector('.single-photo img')!.getAttribute('src')).toBe(
        '/api/media/asset-side-1-oct/content/thumbnail',
      );
      expect(host.querySelector('.single-photo img')!.getAttribute('alt')).toBe(
        'Maya, Side, Thu 1 Oct',
      );
      expect(textOf(host.querySelector('.single-photo figcaption'))).toBe('Thu 1 Oct');
    });

    it('says the photos could not be shown when their previews are refused, not that there are none', async () => {
      const { host } = await render({
        api: { createMediaAccessBatch: vi.fn(() => throwError(() => new Error('offline'))) },
      });

      expect(host.querySelector('app-photo-compare')).toBeNull();
      expect(textOf(host.querySelector('.photos .panel-body'))).toBe(
        'The photos could not be shown right now. Reload the page to try again.',
      );
      expect(textOf(host.querySelector('.weight .figure'))).toBe('71.4 kg');
    });

    it('says what will appear when there are no photos', async () => {
      const { host } = await render({
        api: {
          getClientProgressDashboard: vi.fn(() =>
            of(mapProgressDashboard(reviewDashboard({ photos: false }))),
          ),
        },
      });

      expect(textOf(host.querySelector('.photos .panel-body'))).toBe(
        'No progress photos in the 12 weeks before this check-in. Photos Maya adds show here, by the day each was taken.',
      );
    });
  });

  describe('closed and unsent check-ins', () => {
    it('reads nothing when check-ins are not in the plan, and says so', async () => {
      const { host, api } = await render({ closed: { CheckIns: 'NoEntitlement' } });

      expect(api.getClientCheckInResponse).not.toHaveBeenCalled();
      expect(textOf(host.querySelector('#closed-heading'))).toBe('Check-ins are closed');
      expect(textOf(host.querySelector('.prose p'))).toBe('Check-ins aren’t part of Maya’s plan.');
    });

    it('turns the server’s refusal into its reason, never a failure', async () => {
      const refused = new HttpErrorResponse({ status: 403, error: { accessReason: 'Paused' } });
      const { host } = await render({
        api: { getClientCheckInResponse: vi.fn(() => throwError(() => refused)) },
      });

      expect(textOf(host.querySelector('.prose p'))).toBe(
        'Maya’s plan is paused, so their check-ins aren’t shown.',
      );
      expect(host.querySelector('[role="alert"]')).toBeNull();
    });

    it('says a missing check-in is not here', async () => {
      const missing = new HttpErrorResponse({ status: 404 });
      const { host } = await render({
        api: { getClientCheckInResponse: vi.fn(() => throwError(() => missing)) },
      });

      expect(textOf(host.querySelector('#missing-heading'))).toBe('This check-in isn’t here');
    });

    it('shows no answers before it is sent (CHK-013), and offers nothing to do', async () => {
      const { host, api } = await render({ detail: reviewDetail({ status: 'Draft' }) });

      expect(textOf(host.querySelector('#unsent-heading'))).toBe('Not sent yet');
      expect(textOf(host.querySelector('.prose p'))).toBe(
        'Was due Wed 30 Sep. Maya has started it. You’ll see the answers once it is sent.',
      );
      expect(host.querySelector('.row')).toBeNull();
      expect(host.querySelector('textarea')).toBeNull();
      expect(host.querySelector('button.primary')).toBeNull();
      expect(api.compareCheckInResponses).not.toHaveBeenCalled();
      expect(api.getClientProgressDashboard).not.toHaveBeenCalled();
    });
  });

  describe('reviewing and replying', () => {
    it('marks it reviewed with one click, then offers a reply', async () => {
      const { host, api, toast, harness } = await render();

      press(host, 'Mark reviewed');
      await settle(harness.fixture);

      expect(api.reviewCheckInResponse).toHaveBeenCalledWith(REVIEW_CLIENT_ID, CURRENT_ID, 4);
      expect(api.sendConversationMessage).not.toHaveBeenCalled();
      expect(textOf(host.querySelector('app-status-pill'))).toBe('Reviewed');
      expect(textOf(host.querySelector('.reviewed-line'))).toBe('Reviewed Thu 1 Oct by you');
      expect(primary(host)).toBe('Send reply');
      expect(toast.show).toHaveBeenCalledWith('Check-in marked reviewed.', { tone: 'success' });
    });

    it('sends the reply into the chat first, then marks it reviewed', async () => {
      const { host, api, toast, harness } = await render();

      type(host, 'textarea', '  Great week, Maya. Ease off the lunges.  ');
      await settle(harness.fixture);
      expect(primary(host)).toBe('Send and mark reviewed');
      press(host, 'Send and mark reviewed');
      await settle(harness.fixture);

      const [clientId, conversationKey] = api.createDirectConversation.mock.calls[0] as unknown as [
        string,
        string,
      ];
      expect(clientId).toBe(REVIEW_CLIENT_ID);
      expect(conversationKey).toMatch(/[0-9a-f-]{36}/);
      expect(api.sendConversationMessage).toHaveBeenCalledWith(
        'conversation-1',
        'Great week, Maya. Ease off the lunges.',
        expect.stringMatching(/[0-9a-f-]{36}/),
      );
      expect(api.sendConversationMessage.mock.invocationCallOrder[0]).toBeLessThan(
        api.reviewCheckInResponse.mock.invocationCallOrder[0],
      );
      expect(host.querySelector('textarea')!.value).toBe('');
      expect(textOf(host.querySelector('.sent-note'))).toBe(
        'Sent to your chat with Maya. Open chat',
      );
      expect(host.querySelector('.sent-note a')!.getAttribute('href')).toBe(
        '/messages?conversation=conversation-1',
      );
      expect(toast.show).toHaveBeenCalledWith('Reply sent and check-in marked reviewed.', {
        tone: 'success',
      });
    });

    it('marks nothing reviewed when the reply fails, keeps it, and retries with the same key', async () => {
      const lost = new HttpErrorResponse({ status: 0 });
      const sendConversationMessage = vi
        .fn()
        .mockReturnValueOnce(throwError(() => lost))
        .mockReturnValue(of({ id: 'message-1' }));
      const { host, api, harness } = await render({ api: { sendConversationMessage } });

      type(host, 'textarea', 'Great week.');
      await settle(harness.fixture);
      press(host, 'Send and mark reviewed');
      await settle(harness.fixture);

      expect(api.reviewCheckInResponse).not.toHaveBeenCalled();
      expect(host.querySelector('textarea')!.value).toBe('Great week.');
      expect(alertText(host)).not.toBe('');

      press(host, 'Send and mark reviewed');
      await settle(harness.fixture);
      const keys = sendConversationMessage.mock.calls.map((call) => call[2]);
      expect(keys[0]).toBe(keys[1]);
      expect(api.reviewCheckInResponse).toHaveBeenCalledTimes(1);
    });

    it('says the reply went when the review then loses a race, and reads it again', async () => {
      const raced = new HttpErrorResponse({
        status: 409,
        error: { code: 'CheckInAlreadyReviewed' },
      });
      const getClientCheckInResponse = vi
        .fn()
        .mockReturnValueOnce(of(reviewDetail()))
        .mockReturnValue(of(REVIEWED));
      const { host, harness } = await render({
        api: {
          getClientCheckInResponse,
          reviewCheckInResponse: vi.fn(() => throwError(() => raced)),
        },
      });

      type(host, 'textarea', 'Great week.');
      await settle(harness.fixture);
      press(host, 'Send and mark reviewed');
      await settle(harness.fixture);

      expect(alertText(host)).toBe(
        'Your reply was sent. This check-in changed while it was open, so it has been read again.',
      );
      expect(getClientCheckInResponse).toHaveBeenCalledTimes(2);
      expect(textOf(host.querySelector('app-status-pill'))).toBe('Reviewed');
    });

    it('sends only, when asked, and leaves it waiting for review', async () => {
      const { host, api, toast, harness } = await render();

      type(host, 'textarea', 'Can you send a photo of the knee?');
      await settle(harness.fixture);
      press(host, 'Send only');
      await settle(harness.fixture);

      expect(api.sendConversationMessage).toHaveBeenCalledTimes(1);
      expect(api.reviewCheckInResponse).not.toHaveBeenCalled();
      expect(toast.show).toHaveBeenCalledWith('Reply sent to Maya.', { tone: 'success' });
      expect(primary(host)).toBe('Mark reviewed');
    });

    it('refuses an empty reply out loud, without asking the server', async () => {
      const { host, api, harness } = await render({ detail: REVIEWED });

      press(host, 'Send reply');
      await settle(harness.fixture);

      expect(alertText(host)).toBe('This reply cannot be sent yet: Write your reply first.');
      expect(api.createDirectConversation).not.toHaveBeenCalled();
    });

    it('has no reply box when messaging is not in the plan, and still marks reviewed', async () => {
      const { host } = await render({ closed: { Messaging: 'NoEntitlement' } });

      expect(host.querySelector('textarea')).toBeNull();
      expect(textOf(host.querySelector('.reply .muted'))).toBe(
        'Messaging isn’t part of Maya’s plan, so you can’t reply here.',
      );
      expect(primary(host)).toBe('Mark reviewed');
    });
  });

  describe('leaving with a reply not sent', () => {
    it('asks first, stays when asked to, and leaves when told', async () => {
      const { harness, router } = await render();
      // With nothing written there is nothing to lose, so nothing is asked.
      expect(await router.navigateByUrl(`/clients/${REVIEW_CLIENT_ID}/checkins`)).toBe(true);

      await harness.navigateByUrl(
        `/clients/${REVIEW_CLIENT_ID}/checkins/${CURRENT_ID}`,
        ClientCheckInReview,
      );
      await settle(harness.fixture);
      const page = harness.routeNativeElement as HTMLElement;
      type(page, 'textarea', 'Great week.');
      await settle(harness.fixture);

      const stay = router.navigateByUrl(`/clients/${REVIEW_CLIENT_ID}/checkins`);
      const asked = await dialogNamed(harness.fixture, 'Leave without sending?');
      expect(textOf(asked)).toContain('Your reply to Maya has not been sent.');
      named(asked, 'Stay').click();
      expect(await stay).toBe(false);

      const leave = router.navigateByUrl(`/clients/${REVIEW_CLIENT_ID}/checkins`);
      named(
        await dialogNamed(harness.fixture, 'Leave without sending?'),
        'Leave without sending',
      ).click();
      expect(await leave).toBe(true);
      expect(router.url).toBe(`/clients/${REVIEW_CLIENT_ID}/checkins`);
    });

    it('lets a workspace switch or a sign-out ask it, and warns before a reload', async () => {
      const { host, harness } = await render();
      const unsaved = TestBed.inject(UnsavedWork);
      expect(await unsaved.confirmLeave()).toBe(true);

      type(host, 'textarea', 'Great week.');
      await settle(harness.fixture);
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);

      const asked = unsaved.confirmLeave();
      named(await dialogNamed(harness.fixture, 'Leave without sending?'), 'Stay').click();
      expect(await asked).toBe(false);
    });
  });
});
