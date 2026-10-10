import { provideHttpClient, withInterceptors, HttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { firstValueFrom, of, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../api/api-client';
import type { ClientInvitation } from '../api/api.models';
import type { ClientOverviewView } from '../api/generated';
import { AuthStore } from '../auth/auth.store';
import { CsrfService } from '../security/csrf.service';
import { ClientListApi } from '../../features/clients/client-list-api';
import { Clients } from '../../features/clients/clients';
import { Invitations } from '../../features/invitations/invitations';
import { ExerciseLibrary } from '../../features/training/exercise-library';
import { ExerciseLibraryApi } from '../../features/training/exercise-library-api';
import { TenantStore } from './tenant.store';
import { tenantInterceptor } from './tenant.interceptor';
import { fill, press, settle } from '../../../testing/dom';
import { clientListView, overviewRow } from '../../../testing/client-list-fixtures';
import { coachClient } from '../../../testing/coach-today-fixtures';

/** A client list holding one client, whose first name says which workspace it came from. */
const directory = (id: string): ClientOverviewView =>
  clientListView({ clients: [overviewRow(coachClient(id, id, 'Client'))] });
const invitation = (id: string, email = '') =>
  ({ id, status: 'Pending', email }) as ClientInvitation;

describe('tenant ownership in migrated screens', () => {
  const api = {
    getTenants: vi.fn(() => of(['A', 'B'].map((tenantId) => ({ tenantId, role: 'Owner' })))),
    getInvitations: vi.fn(() => of<ClientInvitation[]>([])),
    createInvitation: vi.fn(() => of(invitation('created'))),
  };
  const clientList = { getOverview: vi.fn(() => of(directory('none'))) };
  const exercises = {
    search: vi.fn(() => of({ items: [], total: 0 })),
    listMedia: vi.fn(() => of({ items: [], total: 0, skip: 0, take: 100 })),
    grant: vi.fn(() => of({ items: [] })),
  };
  const csrf = { refresh: vi.fn(async (): Promise<void> => undefined) };

  beforeEach(async () => {
    vi.resetAllMocks();
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ApiClient, useValue: api },
        { provide: ClientListApi, useValue: clientList },
        { provide: ExerciseLibraryApi, useValue: exercises },
        { provide: AuthStore, useValue: { user: signal(null) } },
        { provide: CsrfService, useValue: csrf },
        provideHttpClient(withInterceptors([tenantInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    await TestBed.inject(TenantStore).load('A');
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
  });

  const listed = (fixture: { componentInstance: Clients }) =>
    fixture.componentInstance['list']()?.rows.map((row) => row.id) ?? null;

  it('client directory rejects slow A success after B and clears synchronously', async () => {
    const a = new Subject<ClientOverviewView>();
    clientList.getOverview.mockReturnValueOnce(a).mockReturnValueOnce(of(directory('B')));
    const fixture = TestBed.createComponent(Clients);
    await settle(fixture);
    const tenants = TestBed.inject(TenantStore);
    tenants.select('B');
    expect(listed(fixture)).toBeNull();
    expect(fixture.componentInstance['failed']()).toBeNull();
    await settle(fixture);
    a.next(directory('A'));
    await settle(fixture);
    expect(fixture.nativeElement.textContent).toContain('B Client');
    expect(fixture.nativeElement.textContent).not.toContain('A Client');
  });

  it('client directory ignores an old error after B succeeds', async () => {
    const a = new Subject<ClientOverviewView>();
    clientList.getOverview.mockReturnValueOnce(a).mockReturnValueOnce(of(directory('B')));
    const fixture = TestBed.createComponent(Clients);
    await settle(fixture);
    TestBed.inject(TenantStore).select('B');
    await settle(fixture);
    a.error(new Error('old tenant failed'));
    await settle(fixture);
    expect(fixture.componentInstance['failed']()).toBeNull();
    expect(listed(fixture)).toEqual(['B']);
  });

  it('client directory reloads on a coalesced A -> B -> A switch', async () => {
    const first = new Subject<ClientOverviewView>();
    clientList.getOverview.mockReturnValueOnce(first).mockReturnValueOnce(of(directory('new A')));
    const fixture = TestBed.createComponent(Clients);
    await settle(fixture);
    const tenants = TestBed.inject(TenantStore);
    tenants.select('B');
    tenants.select('A');
    await settle(fixture);
    first.next(directory('old A'));
    await settle(fixture);
    expect(clientList.getOverview).toHaveBeenCalledTimes(2);
    expect(listed(fixture)).toEqual(['new A']);
  });

  it('client directory keeps the newest reload and its placeholder', async () => {
    const old = new Subject<ClientOverviewView>();
    const latest = new Subject<ClientOverviewView>();
    clientList.getOverview.mockReturnValueOnce(old).mockReturnValueOnce(latest);
    const fixture = TestBed.createComponent(Clients);
    await settle(fixture);
    const loading = fixture.componentInstance['load']();
    old.next(directory('old'));
    await settle(fixture);
    expect(listed(fixture)).toBeNull();
    expect(fixture.nativeElement.querySelector('app-skeleton')).not.toBeNull();
    latest.next(directory('latest'));
    await loading;
    expect(listed(fixture)).toEqual(['latest']);
  });

  it.each(['logout', 'destroy'])('client directory ignores responses after %s', async (action) => {
    const result = new Subject<ClientOverviewView>();
    clientList.getOverview.mockReturnValueOnce(result);
    const fixture = TestBed.createComponent(Clients);
    await settle(fixture);
    if (action === 'logout') TestBed.inject(TenantStore).clear();
    else fixture.destroy();
    result.next(directory('private'));
    await new Promise((resolve) => setTimeout(resolve));
    expect(listed(fixture)).toBeNull();
    expect(fixture.componentInstance['failed']()).toBeNull();
  });

  /** The sheet on top, which the CDK draws outside the page. */
  const openSheet = () => {
    const open = document.querySelectorAll<HTMLElement>('[role="dialog"]');
    return open.length ? open[open.length - 1] : null;
  };
  const toastText = () =>
    document.querySelector('.tb-toast-host, app-toast-host')?.textContent ?? '';

  /** Opens the invite sheet, fills in a client of workspace `who` and presses Send. */
  async function sendInvitation(
    fixture: { componentInstance: Invitations; detectChanges(): void },
    who: string,
  ) {
    fixture.componentInstance['openInvite']();
    await settle(fixture as never);
    const sheet = openSheet()!;
    fill(sheet, 'First name', who);
    fill(sheet, 'Last name', 'Client');
    fill(sheet, 'Email', `${who.toLowerCase()}@example.test`);
    await settle(fixture as never);
    press(sheet, 'Send invitation');
    await settle(fixture as never);
  }

  it('invitation writes keep their initiating tenant and a late answer changes nothing', async () => {
    const firstResponse = new Subject<ClientInvitation>();
    const secondResponse = new Subject<ClientInvitation>();
    const tenants = TestBed.inject(TenantStore);
    const dispatched: (string | null)[] = [];
    api.createInvitation
      .mockImplementationOnce(() => {
        dispatched.push(tenants.selectedTenantId());
        return firstResponse;
      })
      .mockImplementationOnce(() => {
        dispatched.push(tenants.selectedTenantId());
        return secondResponse;
      });
    const fixture = TestBed.createComponent(Invitations);
    await settle(fixture);
    await sendInvitation(fixture, 'A');
    expect(openSheet()).not.toBeNull();

    // The workspace changes while A's answer is on its way: the sheet goes with it.
    tenants.select('B');
    await settle(fixture);
    expect(openSheet()).toBeNull();
    await sendInvitation(fixture, 'B');
    firstResponse.next(invitation('A', 'a@example.test'));
    await settle(fixture);
    expect(toastText()).not.toContain('a@example.test');
    expect(openSheet()).not.toBeNull();

    secondResponse.next(invitation('B', 'b@example.test'));
    await settle(fixture);
    expect(dispatched).toEqual(['A', 'B']);
    expect(toastText()).toContain('b@example.test');
    expect(openSheet()).toBeNull();
  });

  it('invitation CSRF wait cannot retarget a write, including A -> B -> A', async () => {
    let resume!: () => void;
    csrf.refresh.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resume = resolve;
        }),
    );
    const fixture = TestBed.createComponent(Invitations);
    await settle(fixture);
    await sendInvitation(fixture, 'A');
    const tenants = TestBed.inject(TenantStore);
    tenants.select('B');
    tenants.select('A');
    resume();
    await settle(fixture);
    expect(api.createInvitation).not.toHaveBeenCalled();
  });

  it('filtered exercise results cannot overwrite a newer query', async () => {
    const fixture = TestBed.createComponent(ExerciseLibrary);
    await settle(fixture);
    const old = new Subject<{ items: []; total: number }>();
    const newest = new Subject<{ items: []; total: number }>();
    exercises.search.mockReturnValueOnce(old).mockReturnValueOnce(newest);
    const view = fixture.componentInstance;
    // Two reads in flight, as two filters chosen quickly make: the older answer arrives last.
    const first = view['load']();
    const second = view['load']();
    newest.next({ items: [], total: 2 });
    await second;
    old.next({ items: [], total: 99 });
    await first;
    expect(view['total']()).toBe(2);
    TestBed.inject(TenantStore).select('B');
    expect(view['total']()).toBe(0);
  });

  it('HTTP writes retain the tenant header captured at dispatch', async () => {
    const http = TestBed.inject(HttpClient);
    const backend = TestBed.inject(HttpTestingController);
    const write = firstValueFrom(http.post('/api/invitations', { firstName: 'A' }));
    const request = backend.expectOne('/api/invitations');
    TestBed.inject(TenantStore).select('B');
    expect(request.request.headers.get('X-Tenant-Id')).toBe('A');
    request.flush({});
    await write;
    backend.verify();
  });
});
