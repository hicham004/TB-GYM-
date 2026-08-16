import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { TenantStore } from './tenant.store';

export const tenantInterceptor: HttpInterceptorFn = (request, next) => {
  const tenantId = inject(TenantStore).selectedTenantId();
  const isLocalApiRequest = request.url.startsWith('/api/') || request.url.startsWith('/hubs/');

  let prepared = request.clone({ withCredentials: true });
  if (tenantId && isLocalApiRequest) {
    prepared = prepared.clone({ setHeaders: { 'X-Tenant-Id': tenantId } });
  }

  return next(prepared);
};
