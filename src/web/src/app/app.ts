import { Component, inject, OnInit } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthStore } from './core/auth/auth.store';
import { TenantStore } from './core/tenancy/tenant.store';

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  protected readonly auth = inject(AuthStore);
  protected readonly tenants = inject(TenantStore);

  ngOnInit(): void {
    void this.auth.initialize();
  }

  protected selectTenant(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.tenants.select(value || null);
  }

  protected logout(): void {
    void this.auth.logout();
  }
}
