import { Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../api/api-client';
import { TenantAsyncScope } from './tenant-async-scope';
import { TenantStore } from './tenant.store';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

@Component({ template: '' })
class OwnershipHarness {
  readonly tenants = inject(TenantStore);
  readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  readonly data = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly loading = signal(false);
  readonly selection = signal<string | null>(null);
  readonly skip = signal(0);

  constructor() {
    this.scope.onReset(() => {
      this.data.set(null); this.error.set(null); this.loading.set(false);
      this.selection.set(null); this.skip.set(0);
    });
  }

  load(pending: Promise<string>, lane = 'load') {
    return this.scope.run(lane, async (owner) => {
      this.loading.set(true);
      try { this.data.set(await owner.wait(pending)); }
      catch { if (owner.current) this.error.set('failed'); }
      finally { if (owner.current) this.loading.set(false); }
    });
  }
}

describe('tenant async ownership', () => {
  beforeEach(async () => {
    localStorage.clear();
    TestBed.configureTestingModule({providers: [{provide: ApiClient, useValue: {
      getTenants: () => of(['A', 'B'].map(tenantId => ({tenantId, role: 'Owner'}))),
    }}]});
    await TestBed.inject(TenantStore).load('A');
  });
  afterEach(() => { TestBed.resetTestingModule(); localStorage.clear(); });

  function setup() {
    const fixture = TestBed.createComponent(OwnershipHarness);
    fixture.detectChanges();
    return { fixture, view: fixture.componentInstance, tenants: TestBed.inject(TenantStore) };
  }

  it('clears all context state synchronously and ignores slow A after fast B', async () => {
    const {view, tenants} = setup();
    const a = deferred<string>(); const b = deferred<string>();
    view.data.set('old A'); view.error.set('old error'); view.selection.set('row'); view.skip.set(50);
    const first = view.load(a.promise);
    tenants.select('B');
    expect([view.data(), view.error(), view.selection(), view.skip(), view.loading()])
      .toEqual([null, null, null, 0, false]);
    const second = view.load(b.promise);
    b.resolve('B'); await second;
    a.resolve('A'); await first;
    expect(view.data()).toBe('B');
    expect(view.error()).toBeNull();
  });

  it('ignores an old rejection after B succeeds', async () => {
    const {view, tenants} = setup(); const a = deferred<string>();
    const first = view.load(a.promise);
    tenants.select('B'); await view.load(Promise.resolve('B'));
    a.reject(new Error('A failed')); await first;
    expect(view.data()).toBe('B'); expect(view.error()).toBeNull();
  });

  it('rejects original A ownership after A -> B -> A without an effect pass', async () => {
    const {view, tenants} = setup(); const a = deferred<string>();
    const first = view.load(a.promise);
    tenants.select('B'); tenants.select('A');
    await view.load(Promise.resolve('new A'));
    a.resolve('original A'); await first;
    expect(view.data()).toBe('new A');
  });

  it('lets only the newest reload within the same tenant apply', async () => {
    const {view} = setup(); const old = deferred<string>();
    const first = view.load(old.promise);
    await view.load(Promise.resolve('newest'));
    old.resolve('older'); await first;
    expect(view.data()).toBe('newest');
  });

  it('does not let stale finally turn off the current spinner', async () => {
    const {view} = setup(); const old = deferred<string>(); const latest = deferred<string>();
    const first = view.load(old.promise); const second = view.load(latest.promise);
    old.reject(new Error('old')); await first;
    expect(view.loading()).toBe(true); expect(view.error()).toBeNull();
    latest.resolve('latest'); await second;
    expect(view.loading()).toBe(false);
  });

  it('keeps independent operation lanes alive', async () => {
    const {view} = setup(); const one = deferred<string>(); const two = deferred<string>();
    const received: string[] = [];
    const first = view.scope.run('one', async owner => { received.push(await owner.wait(one.promise)); });
    const second = view.scope.run('two', async owner => { received.push(await owner.wait(two.promise)); });
    two.resolve('two'); await second; one.resolve('one'); await first;
    expect(received).toEqual(['two', 'one']);
  });

  it('suppresses a completed write response in a new context', async () => {
    const {view, tenants} = setup(); const response = deferred<string>();
    const dispatched: string[] = [];
    const write = view.scope.run('write', async owner => {
      dispatched.push(owner.tenantId);
      view.data.set(await owner.wait(response.promise));
    });
    tenants.select('B'); response.resolve('saved A'); await write;
    expect(dispatched).toEqual(['A']); expect(view.data()).toBeNull();
  });

  it('does not dispatch a write after its CSRF wait loses ownership', async () => {
    const {view, tenants} = setup(); const csrf = deferred<void>(); const dispatch = vi.fn();
    const write = view.scope.run('write', async owner => {
      await owner.wait(csrf.promise); dispatch(owner.tenantId);
    });
    tenants.select('B'); tenants.select('A'); csrf.resolve(); await write;
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('invalidates pending work on logout', async () => {
    const {view, tenants} = setup(); const response = deferred<string>();
    const pending = view.load(response.promise);
    tenants.clear(); expect(view.loading()).toBe(false);
    response.resolve('private'); await pending;
    expect(view.data()).toBeNull();
  });

  it('prevents responses and new operations after component destruction', async () => {
    const {view, fixture} = setup(); const response = deferred<string>();
    const pending = view.load(response.promise);
    fixture.destroy(); response.resolve('late'); await pending;
    expect(view.data()).toBeNull(); expect(view.loading()).toBe(false);
    const action = vi.fn(); await view.scope.run('load', action);
    expect(action).not.toHaveBeenCalled();
  });

  it('preserves errors of current operations for the caller', async () => {
    const {view} = setup(); const failure = new Error('current');
    await expect(view.scope.run('load', async owner => {
      await owner.wait(Promise.reject(failure));
    })).rejects.toBe(failure);
  });
});
