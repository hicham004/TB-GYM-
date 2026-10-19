import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { EmailDelivery } from './email-delivery';

const STATUS = {
  name: 'TB Gym API',
  architecture: 'Modular Monolith',
  framework: '.NET 10',
  utcTime: '2026-10-19T09:00:00Z',
};

function setUp() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  const delivery = TestBed.inject(EmailDelivery);
  return { delivery, http: TestBed.inject(HttpTestingController) };
}

describe('EmailDelivery', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('says email is off only once the server says it sends none, asking once per visit', async () => {
    const { delivery, http } = setUp();
    expect(delivery.off()).toBe(false);

    http.expectOne('/api/system/status').flush({ ...STATUS, emailAvailable: false });
    await delivery.load();
    expect(delivery.off()).toBe(true);

    // Asked again, it answers from the first reply: email is a setting of the deployment.
    await delivery.load();
    http.expectNone('/api/system/status');
    http.verify();
  });

  it('treats a server that sends email, or a status that cannot be read, as email on', async () => {
    const on = setUp();
    on.http.expectOne('/api/system/status').flush({ ...STATUS, emailAvailable: true });
    await on.delivery.load();
    expect(on.delivery.off()).toBe(false);
    TestBed.resetTestingModule();

    const failed = setUp();
    failed.http
      .expectOne('/api/system/status')
      .flush('down', { status: 503, statusText: 'Service Unavailable' });
    await failed.delivery.load();
    expect(failed.delivery.off()).toBe(false);
  });
});
