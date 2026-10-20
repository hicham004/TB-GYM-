import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { SessionExpiry } from './session-expiry';

/**
 * A 401 from the API means the session ended under the open app (audit WEB-1). The caller still gets
 * its error; the person is taken to sign-in (`SessionExpiry`, which ignores it when nobody is shown as
 * signed in). Signing in and the session check are left out: their 401 is an answer the auth store
 * reads for itself.
 */
export const sessionInterceptor: HttpInterceptorFn = (request, next) => {
  const expiry = inject(SessionExpiry);
  return next(request).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401 && endsSession(request)) {
        void expiry.ended();
      }
      return throwError(() => error);
    }),
  );
};

function endsSession(request: HttpRequest<unknown>): boolean {
  if (!request.url.startsWith('/api/') || request.url === '/api/auth/login') return false;
  return !(request.url === '/api/auth/me' && request.method === 'GET');
}
