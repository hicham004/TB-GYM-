import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiClient } from './api-client';

describe('ApiClient contract mapping', () => {
  let api: ApiClient;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(ApiClient);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  it('normalizes generated PostgreSQL concurrency values for workspace forms', () => {
    api.getWorkspace().subscribe((workspace) => {
      expect(workspace.version).toBe(42);
      expect(workspace.defaultCurrencyCode).toBe('USD');
    });

    http.expectOne('/api/workspace').flush({
      id: 'workspace-a',
      name: 'Solo Coach',
      slug: 'solo-coach',
      timeZoneId: 'Asia/Beirut',
      defaultCulture: 'en-LB',
      defaultCurrencyCode: 'USD',
      weekStartsOn: 'Monday',
      version: '42',
    });
  });

  it('normalizes generated decimal and version unions for client intake', () => {
    api.getSelfProfile().subscribe((profile) => {
      expect(profile.heightCentimeters).toBe(177.8);
      expect(profile.averageDailySteps).toBe(8000);
      expect(profile.version).toBe(7);
    });

    http.expectOne('/api/client-profile/me').flush({
      id: 'client-a',
      firstName: 'Mira',
      lastName: 'Haddad',
      email: 'mira@example.test',
      phoneNumber: null,
      birthDate: '1995-04-02',
      heightCentimeters: '177.80',
      heightEnteredValue: '70',
      heightEnteredUnit: 'Inch',
      workType: null,
      averageDailySteps: '8000',
      trainingBackground: null,
      foodPreferences: null,
      foodAversions: null,
      goals: 'Build strength',
      allergies: null,
      medications: null,
      previousInjuries: null,
      onboardingStatus: 'InProgress',
      onboardingCompletedAtUtc: null,
      version: '7',
    });
  });

  it('normalizes immutable commercial money, payments, and concurrency values', () => {
    api.getClientCommercialOverview('client-a').subscribe((overview) => {
      const enrollment = overview.enrollments[0];
      expect(enrollment.priceAmount).toBe(250);
      expect(enrollment.paidAmount).toBe(100);
      expect(enrollment.balanceAmount).toBe(150);
      expect(enrollment.version).toBe(9);
      expect(enrollment.payments[0].amount).toBe(100);
      expect(enrollment.payments[0].receivedOn).toBe('2026-08-20');
      expect(overview.featureAccess[0].reason).toBe('PaymentRequired');
    });

    http.expectOne('/api/commercial/clients/client-a').flush({
      clientProfileId: 'client-a',
      isRelationshipBlocked: false,
      featureAccess: [
        {
          feature: 'Training',
          isAllowed: false,
          reason: 'PaymentRequired',
          enrollmentId: 'enrollment-a',
          accessibleFrom: '2026-08-20',
          accessibleUntilExclusive: '2026-10-15',
        },
      ],
      enrollments: [
        {
          id: 'enrollment-a',
          productId: 'product-a',
          offerId: 'offer-a',
          renewedFromEnrollmentId: null,
          productName: 'Premium Coaching',
          offerLabel: '8 weeks',
          priceAmount: '250.00',
          priceCurrency: 'USD',
          paidAmount: '100.00',
          balanceAmount: '150.00',
          startDate: '2026-08-20',
          endDateExclusive: '2026-10-15',
          lastActiveDate: '2026-10-14',
          storedStatus: 'PendingPayment',
          effectiveStatus: 'PendingPayment',
          statusReason: null,
          cancelledOn: null,
          features: ['Training'],
          payments: [
            {
              id: 'payment-a',
              amount: '100.00',
              currencyCode: 'USD',
              receivedAtUtc: '2026-08-20T10:00:00Z',
              receivedOn: '2026-08-20',
              method: 'Cash',
              reference: null,
              note: null,
              recordedByUserId: 'coach-a',
              operation: 'Receipt',
              source: 'Manual',
              createdAtUtc: '2026-08-20T10:00:00Z',
            },
          ],
          createdAtUtc: '2026-08-20T09:00:00Z',
          version: '9',
        },
      ],
    });
  });

  it('hands a feature read back as the server sent it, for the feature to map (audit WEB-5)', () => {
    api.getMyTrainingWeek().subscribe((week) => {
      expect(week.days[0].scheduled).toBe('2');
    });

    http.expectOne('/api/training/me/week').flush({
      weekStart: '2026-08-24',
      days: [{ date: '2026-08-24', scheduled: '2', completed: '1' }],
    });
  });

  it('sends the list’s filter in the server’s words and leaves All out', () => {
    api
      .listConversations(null, null, 25, { filter: 'AwaitingReply', search: ' rania ' })
      .subscribe();
    const narrowed = http.expectOne((request) => request.url === '/api/messaging/conversations');
    expect(narrowed.request.params.get('filter')).toBe('AwaitingReply');
    expect(narrowed.request.params.get('search')).toBe('rania');
    narrowed.flush({ items: [], hasMore: false });

    api.listConversations(null, null, 25, { filter: 'All', search: '' }).subscribe();
    const plain = http.expectOne((request) => request.url === '/api/messaging/conversations');
    expect(plain.request.params.has('filter')).toBe(false);
    expect(plain.request.params.has('search')).toBe(false);
    plain.flush({ items: [], hasMore: false });
  });

  it('keeps the two unread counts numbers for the shell', () => {
    api.getMessagingUnreadCount().subscribe((unread) => expect(unread).toBe(3));
    api.getUnreadNotificationCount().subscribe((unread) => expect(unread).toBe(4));

    http.expectOne('/api/messaging/unread-count').flush({ unread: '3' });
    http.expectOne('/api/notifications/unread-count').flush({ unread: '4' });
  });
});
