import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import {
  ClientSummary,
  CreateClientRequest,
  CurrentUser,
  HealthResponse,
  LoginRequest,
  SystemStatus,
  TenantMembership,
} from './api.models';

@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly http = inject(HttpClient);

  getSystemStatus(): Observable<SystemStatus> {
    return this.http.get<SystemStatus>('/api/system/status');
  }

  getLiveHealth(): Observable<HealthResponse> {
    return this.http.get<HealthResponse>('/health/live');
  }

  getReadyHealth(): Observable<HealthResponse> {
    return this.http.get<HealthResponse>('/health/ready');
  }

  getCsrfToken(): Observable<{ token: string }> {
    return this.http.get<{ token: string }>('/api/auth/csrf');
  }

  login(request: LoginRequest): Observable<CurrentUser> {
    return this.http.post<CurrentUser>('/api/auth/login', request);
  }

  logout(): Observable<void> {
    return this.http.post<void>('/api/auth/logout', {});
  }

  getCurrentUser(): Observable<CurrentUser> {
    return this.http.get<CurrentUser>('/api/auth/me');
  }

  getTenants(): Observable<TenantMembership[]> {
    return this.http.get<TenantMembership[]>('/api/tenants');
  }

  getClients(): Observable<ClientSummary[]> {
    return this.http.get<ClientSummary[]>('/api/clients');
  }

  createClient(request: CreateClientRequest): Observable<ClientSummary> {
    return this.http.post<ClientSummary>('/api/clients', request);
  }
}
