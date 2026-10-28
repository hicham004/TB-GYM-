import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { EmailDelivery } from './email-delivery';
import { MediaUploads } from './media-uploads';

const STATUS = {
  name: 'TB Gym API',
  architecture: 'Modular Monolith',
  framework: '.NET 10',
  utcTime: '2026-10-27T09:00:00Z',
  emailAvailable: true,
};

function setUp() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  const uploads = TestBed.inject(MediaUploads);
  return { uploads, http: TestBed.inject(HttpTestingController) };
}

describe('MediaUploads', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('says uploads are off only once the server says it takes none, sharing email’s one request', async () => {
    const { uploads, http } = setUp();
    const email = TestBed.inject(EmailDelivery);
    expect(uploads.off()).toBe(false);

    http
      .expectOne('/api/system/status')
      .flush({ ...STATUS, emailAvailable: false, mediaUploadsAvailable: false });
    await uploads.load();
    await email.load();
    expect(uploads.off()).toBe(true);
    expect(email.off()).toBe(true);

    http.expectNone('/api/system/status');
    http.verify();
  });

  it('treats a server that takes uploads, or a status that cannot be read, as uploads on', async () => {
    const on = setUp();
    on.http.expectOne('/api/system/status').flush({ ...STATUS, mediaUploadsAvailable: true });
    await on.uploads.load();
    expect(on.uploads.off()).toBe(false);
    TestBed.resetTestingModule();

    const failed = setUp();
    failed.http
      .expectOne('/api/system/status')
      .flush('down', { status: 503, statusText: 'Service Unavailable' });
    await failed.uploads.load();
    expect(failed.uploads.off()).toBe(false);
  });
});
