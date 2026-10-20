import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionExpiry } from './session-expiry';
import { sessionInterceptor } from './session.interceptor';

describe('sessionInterceptor', () => {
  let ended: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ended = vi.fn(() => Promise.resolve());
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([sessionInterceptor])),
        provideHttpClientTesting(),
        { provide: SessionExpiry, useValue: { ended } },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  /** Sends one request, answers it with `status`, and returns what the caller saw. */
  async function answer(method: 'GET' | 'PUT', url: string, status: number): Promise<unknown> {
    const http = TestBed.inject(HttpClient);
    const pending = firstValueFrom(method === 'GET' ? http.get(url) : http.put(url, {})).catch(
      (error: unknown) => error,
    );
    TestBed.inject(HttpTestingController)
      .expectOne({ method, url })
      .flush({ code: 'x' }, { status, statusText: 'Answer' });
    return pending;
  }

  /**
   * An open tab whose session ended used to show each screen's own load error ("Clients could not
   * be loaded. Check your connection") while the shell stayed up (audit WEB-1).
   */
  it('reports a 401 from the API as an ended session and still hands the caller its error', async () => {
    const seen = await answer('GET', '/api/clients/overview', 401);

    expect(ended).toHaveBeenCalledTimes(1);
    expect(seen).toMatchObject({ status: 401 });
  });

  it('counts a refused personal setting under /api/auth as an ended session', async () => {
    await answer('PUT', '/api/auth/me/theme', 401);

    expect(ended).toHaveBeenCalledTimes(1);
  });

  it('leaves the sign-in and the session check to the auth store, which reads their 401 itself', async () => {
    await answer('GET', '/api/auth/me', 401);
    const http = TestBed.inject(HttpClient);
    const login = firstValueFrom(http.post('/api/auth/login', {})).catch(() => undefined);
    TestBed.inject(HttpTestingController)
      .expectOne('/api/auth/login')
      .flush({ code: 'invalid_credentials' }, { status: 401, statusText: 'Unauthorized' });
    await login;

    expect(ended).not.toHaveBeenCalled();
  });

  it('does not treat a refusal, a fault or another origin as an ended session', async () => {
    await answer('GET', '/api/clients/overview', 403);
    await answer('GET', '/api/clients/overview', 500);
    await answer('GET', '/assets/i18n/en.json', 401);

    expect(ended).not.toHaveBeenCalled();
  });
});
