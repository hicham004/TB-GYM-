import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthStore } from '../../core/auth/auth.store';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { ClientToday } from './client-today';
import { ButtonLink } from '../../ui/button';
import { EmptyState } from '../../ui/empty-state';
import { CoachToday } from './coach-today';

/** `/` after sign-in: Coach Today for staff, the client's Today for a client. */
@Component({
  selector: 'app-dashboard',
  imports: [ButtonLink, ClientToday, CoachToday, EmptyState, RouterLink],
  templateUrl: './dashboard.html',
})
export class Dashboard {
  protected readonly auth = inject(AuthStore);
  protected readonly tenants = inject(TenantStore);
}
