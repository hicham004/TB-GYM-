import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { checkInRoutes } from './checkins.routes';

@Component({ template: '' })
class Stub {}

const CLIENT = '0f8b6a52-58a8-4d6f-9c3e-6d1f0e2b7a11';
const ASSIGNMENT = '9a4c2e10-7b5d-4f8e-8a21-3c6b5d4e2f90';

async function landing(url: string): Promise<string> {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'checkins', children: checkInRoutes },
        { path: 'clients', component: Stub },
        { path: 'clients/:clientId/checkins', component: Stub },
        { path: 'clients/:clientId/checkins/:assignmentId', component: Stub },
      ]),
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  return TestBed.inject(Router).url;
}

/** The old Client check-ins page (audit A14b): its bookmarks open the client's record. */
describe('the old Client check-ins address', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('opens the client’s Check-ins it named, or the check-in itself', async () => {
    expect(await landing(`/checkins/clients?clientId=${CLIENT}`)).toBe(
      `/clients/${CLIENT}/checkins`,
    );
    TestBed.resetTestingModule();
    expect(await landing(`/checkins/clients?clientId=${CLIENT}&assignmentId=${ASSIGNMENT}`)).toBe(
      `/clients/${CLIENT}/checkins/${ASSIGNMENT}`,
    );
  });

  it('opens Clients when it names no client, or something that is not one', async () => {
    expect(await landing('/checkins/clients')).toBe('/clients');
    TestBed.resetTestingModule();
    expect(await landing('/checkins/clients?clientId=..%2F..%2Fadmin')).toBe('/clients');
    TestBed.resetTestingModule();
    expect(await landing(`/checkins/clients?clientId=${CLIENT}&assignmentId=nope`)).toBe(
      `/clients/${CLIENT}/checkins`,
    );
  });
});
