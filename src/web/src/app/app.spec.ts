import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { App } from './app';
import { AuthStore } from './core/auth/auth.store';
import { TenantStore } from './core/tenancy/tenant.store';

describe('App', () => {
  it('creates the application shell', async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        {
          provide: AuthStore,
          useValue: {
            user: signal(null),
            loading: signal(false),
            initialize: vi.fn().mockResolvedValue(undefined),
            logout: vi.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: TenantStore,
          useValue: {
            memberships: signal([]),
            selectedTenantId: signal(null),
            select: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    expect(fixture.componentInstance).toBeTruthy();
    expect((fixture.nativeElement as HTMLElement).querySelector('.brand')?.textContent).toContain(
      'TB Gym',
    );
  });
});
