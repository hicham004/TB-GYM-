export interface SystemStatus {
  name: string;
  architecture: string;
  framework: string;
  utcTime: string;
}

export interface HealthResponse {
  status: string;
  checks: Record<string, HealthCheck>;
}

export interface HealthCheck {
  status: string;
  description: string | null;
}

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
}

export interface TenantMembership {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  role: 'Owner' | 'Coach' | 'Client';
}

export interface ClientSummary {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  birthDate: string | null;
  isCoachBlocked: boolean;
  version: number;
}

export interface CreateClientRequest {
  firstName: string;
  lastName: string;
  email: string;
  birthDate: string | null;
}

export interface LoginRequest {
  email: string;
  password: string;
  rememberMe: boolean;
}
