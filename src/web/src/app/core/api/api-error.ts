import { HttpErrorResponse } from '@angular/common/http';
import { ApiErrorBody } from './api.models';

export function apiErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof HttpErrorResponse)) {
    return fallback;
  }

  const body = error.error as ApiErrorBody | undefined;
  if (body?.message) {
    return body.message;
  }

  if (body?.errors) {
    const first = Object.values(body.errors).flat()[0];
    if (first) {
      return first;
    }
  }

  return fallback;
}
