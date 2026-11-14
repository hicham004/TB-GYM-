import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type { BodyweightUnit, ClientSelfProfile } from '../../core/api/api.models';
import { AuthStore } from '../../core/auth/auth.store';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { UnsavedWork } from '../../core/forms/unsaved-work';
import { field, fill, formSummary, press, settle, type } from '../../../testing/dom';
import {
  finishedProfile,
  halfwayProfile,
  newProfile,
  workspace,
} from '../../../testing/intake-fixtures';
import { ClientProfilePage } from './client-profile';

interface Options {
  api?: Partial<Record<keyof ApiClient, unknown>>;
  unit?: BodyweightUnit;
  currentDate?: string;
}

async function render(initial: ClientSelfProfile = newProfile(), options: Options = {}) {
  const tenantId = signal<string | null>('tenant-1');
  await TestBed.configureTestingModule({
    imports: [ClientProfilePage],
    providers: [
      provideRouter([]),
      {
        provide: ApiClient,
        useValue: {
          getSelfProfile: vi.fn(() => of(initial)),
          getWorkspace: vi.fn(() =>
            of(workspace({ currentDate: options.currentDate ?? '2026-10-10' })),
          ),
          updateSelfIntake: vi.fn((request: { version: number }) =>
            of({ ...initial, firstName: 'Rana', version: request.version + 1 }),
          ),
          completeSelfOnboarding: vi.fn((request: { intake: { version: number } }) =>
            of({ ...initial, onboardingStatus: 'Completed', version: request.intake.version + 1 }),
          ),
          ...options.api,
        },
      },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      {
        provide: TenantStore,
        useValue: {
          selectedTenantId: tenantId,
          selectedMembership: signal({ tenantName: 'Atlas Performance' }),
        },
      },
      { provide: AuthStore, useValue: { weightUnit: signal(options.unit ?? 'Kilogram') } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(ClientProfilePage);
  await settle(fixture);
  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    api: TestBed.inject(ApiClient) as unknown as Record<string, ReturnType<typeof vi.fn>>,
    tenantId,
    page: fixture.componentInstance,
  };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

const dialog = () => {
  const open = document.querySelectorAll<HTMLElement>('[role="dialog"]');
  return open.length ? open[open.length - 1] : null;
};

const toast = () => textOf(document.querySelector('.tb-toast-host, app-toast-host'));

/** Types a birth date into the three boxes. */
function typeDate(host: ParentNode, day: string, month: string, year: string) {
  type(host, 'input.day', day);
  type(host, 'input.month', month);
  type(host, 'input.year', year);
}

describe('ClientProfilePage', () => {
  afterEach(() => {
    document.body.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());
    TestBed.resetTestingModule();
  });

  it('starts a new client on the first of five steps, saying what is coming', async () => {
    const { host } = await render();

    expect(textOf(host.querySelector('h1'))).toBe('Set up your profile');
    expect(textOf(host.querySelector('.lede'))).toContain('Your answers are saved as you go.');
    expect(textOf(host.querySelector('.kicker'))).toBe('Step 1 of 5');
    expect(textOf(host.querySelector('#intake-step-heading'))).toBe('About you');
    expect(Array.from(host.querySelectorAll('.progress .name')).map(textOf)).toEqual([
      'About you',
      'Goal',
      'Day and food',
      'Health',
      'Weight',
    ]);
    // Their name is already there from the invitation, so it is shown, not asked for again.
    expect((host.querySelector('input[name="firstName"]') as HTMLInputElement).value).toBe('Rana');
  });

  it('saves each step as the person goes, sending only that step’s answers', async () => {
    const { fixture, host, api } = await render();

    typeDate(host, '2', '4', '1996');
    fill(host, 'Height', '168');
    await settle(fixture);
    press(host, 'Continue');
    await settle(fixture);

    expect(api['updateSelfIntake']).toHaveBeenCalledTimes(1);
    expect(api['updateSelfIntake']).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: 'Rana',
        birthDate: '1996-04-02',
        heightValue: 168,
        heightUnit: 'Centimeter',
        goals: null,
        version: 4,
      }),
    );
    expect(textOf(host.querySelector('.kicker'))).toBe('Step 2 of 5');
    expect(textOf(host.querySelector('#intake-step-heading'))).toBe('Your goal');
    expect(document.activeElement).toBe(host.querySelector('#intake-step-heading'));

    fill(host, 'Goals', 'Get stronger.');
    await settle(fixture);
    press(host, 'Continue');
    await settle(fixture);

    // The second save carries the version the first one returned.
    expect(api['updateSelfIntake']).toHaveBeenLastCalledWith(
      expect.objectContaining({ goals: 'Get stronger.', version: 5 }),
    );
    expect(textOf(host.querySelector('#intake-step-heading'))).toBe('Your day and food');
  });

  it('asks for what is missing in words, and sends nothing, with focus on the first thing wrong', async () => {
    const { fixture, host, api } = await render();

    press(host, 'Continue');
    await settle(fixture);

    expect(api['updateSelfIntake']).not.toHaveBeenCalled();
    expect(textOf(host)).toContain('Enter a date of birth: day, month and year.');
    expect(textOf(host)).toContain('Enter a height.');
    expect(textOf(formSummary(host))).toBe('Check the fields marked above.');
    expect(document.activeElement).toBe(host.querySelector('input.day'));
  });

  it('keeps what was typed and says why when the server refuses a step', async () => {
    const refusal = new HttpErrorResponse({
      status: 409,
      error: { title: 'Your profile was changed elsewhere.' },
    });
    const { fixture, host } = await render(newProfile(), {
      api: { updateSelfIntake: vi.fn(() => throwError(() => refusal)) },
    });

    typeDate(host, '2', '4', '1996');
    fill(host, 'Height', '168');
    await settle(fixture);
    press(host, 'Continue');
    await settle(fixture);

    expect(textOf(formSummary(host))).toBe('Your profile was changed elsewhere.');
    expect(document.activeElement).toBe(formSummary(host));
    expect(textOf(host.querySelector('#intake-step-heading'))).toBe('About you');
    expect((host.querySelector('input[name="heightValue"]') as HTMLInputElement).value).toBe('168');
  });

  it('picks up at the first step the saved answers do not finish, and goes back without losing anything', async () => {
    const { fixture, host } = await render(halfwayProfile());

    expect(textOf(host.querySelector('.kicker'))).toBe('Step 3 of 5');
    expect(textOf(host.querySelector('#intake-step-heading'))).toBe('Your day and food');
    const done = Array.from(host.querySelectorAll('.progress .item.done .name')).map(textOf);
    expect(done).toEqual(['About you, done', 'Goal, done']);

    fill(host, 'Work (optional)', 'Teacher');
    await settle(fixture);
    press(host, 'Back');
    await settle(fixture);
    expect(textOf(host.querySelector('#intake-step-heading'))).toBe('Your goal');
    press(host, 'Continue');
    await settle(fixture);
    expect((host.querySelector('input[name="workType"]') as HTMLInputElement).value).toBe(
      'Teacher',
    );
  });

  it('names who can read the health answers', async () => {
    const { fixture, host } = await render(halfwayProfile({ workType: 'Teacher' }));

    expect(textOf(host.querySelector('#intake-step-heading'))).toBe('Your health');
    expect(textOf(host.querySelector('.privacy'))).toBe(
      // Their coach alone (N9d1a): the owner reads them only while coaching the client.
      'Only you and your coach can see these answers.',
    );
    await settle(fixture);
  });

  it('finishes setting up with the starting weight in the unit they chose, weighed on the workspace’s today', async () => {
    const { fixture, host, api } = await render(
      halfwayProfile({ workType: 'Teacher', allergies: 'None' }),
      { unit: 'Pound' },
    );

    expect(textOf(host.querySelector('#intake-step-heading'))).toBe('Where you start');
    expect((host.querySelector('input[name="weightValue"]') as HTMLInputElement).value).toBe('');
    expect(
      (host.querySelector('input[type="radio"][value="Pound"]') as HTMLInputElement).checked,
    ).toBe(true);
    expect(textOf(host.querySelector('app-date-field'))).toContain('Oct 10, 2026');

    fill(host, 'Weight', '154.5');
    await settle(fixture);
    press(host, 'Finish setting up');
    await settle(fixture);

    expect(api['completeSelfOnboarding']).toHaveBeenCalledWith({
      intake: expect.objectContaining({
        firstName: 'Rana',
        goals: 'Run a 10k in under an hour by June.',
        version: 6,
      }),
      initialBodyweightValue: 154.5,
      initialBodyweightUnit: 'Pound',
      measurementDate: '2026-10-10',
    });
    expect(api['updateSelfIntake']).not.toHaveBeenCalled();
    expect(textOf(host.querySelector('#done-heading'))).toBe('You’re all set, Rana');
    expect(host.querySelector('app-intake-steps')).toBeNull();
    expect(host.querySelector('a[href="/"]')).not.toBeNull();

    press(host, 'See my answers');
    await settle(fixture);
    expect(textOf(host.querySelector('h1'))).toBe('My profile');
    expect(host.querySelector('app-intake-profile')).not.toBeNull();
  });

  it('judges a birth date against the coaching space’s today, not the browser’s', async () => {
    const { fixture, host, api } = await render(newProfile(), { currentDate: '2030-06-15' });

    fill(host, 'Height', '168');
    typeDate(host, '16', '6', '2012');
    await settle(fixture);
    press(host, 'Continue');
    await settle(fixture);
    expect(textOf(host)).toContain('Clients have to be 18 or older.');
    expect(api['updateSelfIntake']).not.toHaveBeenCalled();

    typeDate(host, '15', '6', '2012');
    await settle(fixture);
    press(host, 'Continue');
    await settle(fixture);
    expect(api['updateSelfIntake']).toHaveBeenCalledWith(
      expect.objectContaining({ birthDate: '2012-06-15' }),
    );
  });

  it('protects completed-intake sheet edits during sign-out or switching and refresh', async () => {
    const { fixture, host } = await render(finishedProfile());
    (host.querySelector('[data-edit="about"]') as HTMLButtonElement).click();
    await settle(fixture);
    // A new number: the saved profile already holds +96170123456, and retyping it changes nothing.
    fill(dialog()!, 'Phone number (optional)', '+96171999888');
    await settle(fixture);
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    const leave = TestBed.inject(UnsavedWork).confirmLeave();
    await settle(fixture);
    press(dialog()!, 'Keep editing');
    expect(await leave).toBe(false);
    fixture.destroy();
    expect(await TestBed.inject(UnsavedWork).confirmLeave()).toBe(true);
  });

  it('shows a finished profile as cards, and saves a group from its sheet', async () => {
    const { fixture, host, api } = await render(finishedProfile());

    expect(textOf(host.querySelector('h1'))).toBe('My profile');
    expect(host.querySelector('app-intake-steps')).toBeNull();
    expect(Array.from(host.querySelectorAll('.panel-head h2')).map(textOf)).toEqual([
      'About you',
      'Your goal',
      'Your day and food',
      'Your health',
    ]);

    (host.querySelector('[data-edit="life"]') as HTMLButtonElement).click();
    await settle(fixture);
    const sheet = dialog()!;
    expect(textOf(sheet.querySelector('h2'))).toBe('Your day and food');
    fill(sheet, 'Work (optional)', 'Nurse, night shifts');
    await settle(fixture);
    press(sheet, 'Save changes');
    await settle(fixture);

    expect(api['updateSelfIntake']).toHaveBeenCalledWith(
      expect.objectContaining({
        workType: 'Nurse, night shifts',
        goals: 'Run a 10k in under an hour by June.',
        version: 9,
      }),
    );
    expect(dialog()).toBeNull();
    expect(toast()).toContain('Your details were saved.');
  });

  it('says who sees the health answers in the health sheet too, not only on the first run (CLIENT-18)', async () => {
    const { fixture, host } = await render(finishedProfile());

    (host.querySelector('[data-edit="health"]') as HTMLButtonElement).click();
    await settle(fixture);
    expect(textOf(dialog()!.querySelector('.privacy'))).toBe(
      // Their coach alone (N9d1a): the owner reads them only while coaching the client.
      'Only you and your coach can see these answers.',
    );
    press(dialog()!, 'Not now');
    await settle(fixture);

    (host.querySelector('[data-edit="about"]') as HTMLButtonElement).click();
    await settle(fixture);
    expect(dialog()!.querySelector('.privacy')).toBeNull();
  });

  it('reports a failed load and tries again', async () => {
    let failing = true;
    const { fixture, host } = await render(finishedProfile(), {
      api: {
        getSelfProfile: vi.fn(() =>
          failing
            ? throwError(() => new HttpErrorResponse({ status: 500 }))
            : of(finishedProfile()),
        ),
      },
    });

    expect(textOf(host.querySelector('[role="alert"]'))).toBe('Your profile couldn’t be loaded.');
    expect(host.querySelector('app-intake-steps')).toBeNull();
    expect(host.querySelector('app-intake-profile')).toBeNull();

    failing = false;
    press(host, 'Try again');
    await settle(fixture);
    expect(host.querySelector('app-intake-profile')).not.toBeNull();
  });

  it('asks before leaving a step with typing on it, and not otherwise', async () => {
    const { fixture, host, page } = await render(halfwayProfile());

    expect(await page.canLeave()).toBe(true);

    fill(host, 'Work (optional)', 'Teacher');
    await settle(fixture);
    const answer = page.canLeave();
    await settle(fixture);
    expect(textOf(dialog())).toContain('The answers on this step aren’t saved.');
    press(dialog()!, 'Stay');
    expect(await answer).toBe(false);

    const second = page.canLeave();
    await settle(fixture);
    press(dialog()!, 'Leave without saving');
    expect(await second).toBe(true);
  });

  it('is asked by a workspace switch or a sign-out while a step holds typing', async () => {
    const { fixture, host } = await render(halfwayProfile());

    fill(host, 'Work (optional)', 'Teacher');
    await settle(fixture);
    const pending = TestBed.inject(UnsavedWork).confirmLeave();
    await settle(fixture);
    expect(dialog()).not.toBeNull();
    press(dialog()!, 'Leave without saving');
    expect(await pending).toBe(true);
  });

  describe('a trainee of TB Gym’s own space off Max, whose Health step is closed (N9c5a)', () => {
    const offMax = { selfDirected: true, healthStepOpen: false } as const;
    const nothingSaved = { allergies: null, medications: null, previousInjuries: null };
    const closedRefusal = () =>
      new HttpErrorResponse({
        status: 409,
        error: {
          code: 'health_step_closed',
          message:
            "Health answers open on Max, TB Gym's coaching. Your other answers can still be saved.",
        },
      });
    const progressNames = (host: HTMLElement) =>
      Array.from(host.querySelectorAll('.progress .name')).map(textOf);

    it('answers four steps, without Health, each carrying the saved health answers as they are', async () => {
      const { fixture, host, api } = await render(newProfile(offMax));

      expect(textOf(host.querySelector('.kicker'))).toBe('Step 1 of 4');
      expect(progressNames(host)).toEqual(['About you', 'Goal', 'Day and food', 'Weight']);
      expect(host.querySelectorAll('.progress .item')).toHaveLength(4);

      typeDate(host, '2', '4', '1996');
      fill(host, 'Height', '168');
      await settle(fixture);
      press(host, 'Continue');
      await settle(fixture);
      expect(textOf(host.querySelector('.kicker'))).toBe('Step 2 of 4');
      fill(host, 'Goals', 'Get stronger.');
      await settle(fixture);
      press(host, 'Continue');
      await settle(fixture);
      expect(textOf(host.querySelector('#intake-step-heading'))).toBe('Your day and food');
      expect(textOf(host.querySelector('.kicker'))).toBe('Step 3 of 4');
      press(host, 'Continue');
      await settle(fixture);

      expect(textOf(host.querySelector('#intake-step-heading'))).toBe('Where you start');
      expect(textOf(host.querySelector('.kicker'))).toBe('Step 4 of 4');
      expect(host.querySelector('.privacy')).toBeNull();
      expect(api['updateSelfIntake']).toHaveBeenCalledTimes(3);
      for (const [request] of api['updateSelfIntake'].mock.calls) {
        expect(request).toMatchObject(nothingSaved);
      }

      press(host, 'Back');
      await settle(fixture);
      expect(textOf(host.querySelector('#intake-step-heading'))).toBe('Your day and food');
    });

    it('picks up on Weight once Day and food is done, and sends answers saved on Max untouched', async () => {
      const { fixture, host, api } = await render(
        halfwayProfile({ ...offMax, workType: 'Teacher', medications: 'Ventolin' }),
      );

      expect(textOf(host.querySelector('.kicker'))).toBe('Step 4 of 4');
      expect(textOf(host.querySelector('#intake-step-heading'))).toBe('Where you start');
      fill(host, 'Weight', '64');
      await settle(fixture);
      press(host, 'Finish setting up');
      await settle(fixture);

      expect(api['completeSelfOnboarding']).toHaveBeenCalledWith(
        expect.objectContaining({
          intake: expect.objectContaining({
            allergies: null,
            medications: 'Ventolin',
            previousInjuries: null,
          }),
        }),
      );
    });

    it('has all five steps again on Max', async () => {
      const { host } = await render(
        newProfile({ selfDirected: true, coachedByTheHouse: true, healthStepOpen: true }),
      );

      expect(textOf(host.querySelector('.kicker'))).toBe('Step 1 of 5');
      expect(progressNames(host)).toEqual([
        'About you',
        'Goal',
        'Day and food',
        'Health',
        'Weight',
      ]);
    });

    it('leaves the Health card out with nothing saved', async () => {
      const { host } = await render(finishedProfile({ ...offMax, ...nothingSaved }));

      expect(Array.from(host.querySelectorAll('.panel-head h2')).map(textOf)).toEqual([
        'About you',
        'Your goal',
        'Your day and food',
      ]);
      expect(host.querySelectorAll('[data-edit]')).toHaveLength(3);
      expect(host.querySelector('[data-health-closed]')).toBeNull();
    });

    it('shows saved health answers to read, with no Edit and the line on why, and saves the rest as they are', async () => {
      const { fixture, host, api } = await render(finishedProfile(offMax));

      expect(Array.from(host.querySelectorAll('.panel-head h2')).map(textOf)).toEqual([
        'About you',
        'Your goal',
        'Your day and food',
        'Your health',
      ]);
      expect(host.querySelector('[data-edit="health"]')).toBeNull();
      expect(host.querySelectorAll('[data-edit]')).toHaveLength(3);
      expect(textOf(host.querySelector('[data-health-closed]'))).toBe(
        'Health answers open on Max, TB Gym’s coaching, so these can’t be changed now.',
      );
      expect(textOf(host)).toContain('Peanuts');
      expect(textOf(host)).toContain('Left knee, 2023');

      (host.querySelector('[data-edit="goal"]') as HTMLButtonElement).click();
      await settle(fixture);
      fill(dialog()!, 'Goals', 'Squat my bodyweight.');
      await settle(fixture);
      press(dialog()!, 'Save changes');
      await settle(fixture);

      expect(api['updateSelfIntake']).toHaveBeenCalledWith(
        expect.objectContaining({
          goals: 'Squat my bodyweight.',
          allergies: 'Peanuts',
          medications: null,
          previousInjuries: 'Left knee, 2023',
        }),
      );
    });

    it('moves on to Weight and says why when Max ends under the health step, and asks nothing on leaving', async () => {
      const open = halfwayProfile({ selfDirected: true, workType: 'Teacher' });
      const closed = { ...open, healthStepOpen: false };
      const getSelfProfile = vi.fn().mockReturnValueOnce(of(open)).mockReturnValue(of(closed));
      const { fixture, host, api, page } = await render(open, {
        api: { getSelfProfile, updateSelfIntake: vi.fn(() => throwError(closedRefusal)) },
      });

      expect(textOf(host.querySelector('#intake-step-heading'))).toBe('Your health');
      fill(host, 'Allergies (optional)', 'Shellfish');
      await settle(fixture);
      press(host, 'Continue');
      await settle(fixture);

      expect(api['updateSelfIntake']).toHaveBeenCalledWith(
        expect.objectContaining({ allergies: 'Shellfish' }),
      );
      expect(getSelfProfile).toHaveBeenCalledTimes(2);
      expect(textOf(host.querySelector('#intake-step-heading'))).toBe('Where you start');
      expect(textOf(host.querySelector('.kicker'))).toBe('Step 4 of 4');
      expect(progressNames(host)).not.toContain('Health');
      expect(textOf(formSummary(host))).toBe(
        'Health answers open on Max, TB Gym’s coaching. Your other answers can still be saved.',
      );
      expect(document.activeElement).toBe(formSummary(host));
      // What was typed on the closed step can never be saved, so leaving asks nothing.
      expect(await page.canLeave()).toBe(true);
      expect(dialog()).toBeNull();

      fill(host, 'Weight', '64');
      await settle(fixture);
      press(host, 'Finish setting up');
      await settle(fixture);
      expect(api['completeSelfOnboarding']).toHaveBeenCalledWith(
        expect.objectContaining({ intake: expect.objectContaining({ allergies: null }) }),
      );
    });

    it('keeps the health sheet open with the words when Max ends under it, closes its Edit, and sends nothing more', async () => {
      const open = finishedProfile({ selfDirected: true });
      const closed = { ...open, healthStepOpen: false };
      const getSelfProfile = vi.fn().mockReturnValueOnce(of(open)).mockReturnValue(of(closed));
      const updateSelfIntake = vi.fn(() => throwError(closedRefusal));
      const { fixture, host } = await render(open, { api: { getSelfProfile, updateSelfIntake } });

      // jsdom's click does not focus: focus the Edit as a person's press would, so the sheet has it to give back.
      const editHealth = host.querySelector<HTMLButtonElement>('[data-edit="health"]')!;
      editHealth.focus();
      editHealth.click();
      await settle(fixture);
      const sheet = dialog()!;
      fill(sheet, 'Allergies (optional)', 'Shellfish');
      await settle(fixture);
      press(sheet, 'Save changes');
      await settle(fixture);

      expect(updateSelfIntake).toHaveBeenCalledTimes(1);
      expect(getSelfProfile).toHaveBeenCalledTimes(2);
      expect(dialog()).toBe(sheet);
      expect(textOf(formSummary(sheet))).toBe(
        'Health answers open on Max, TB Gym’s coaching. Your other answers can still be saved.',
      );
      expect(document.activeElement).toBe(formSummary(sheet));
      expect(host.querySelector('[data-edit="health"]')).toBeNull();
      expect(textOf(host.querySelector('[data-health-closed]'))).toContain(
        'so these can’t be changed now.',
      );

      // The read already says it is refused: Save changes says so again and sends nothing.
      press(sheet, 'Save changes');
      await settle(fixture);
      expect(updateSelfIntake).toHaveBeenCalledTimes(1);
      expect(textOf(formSummary(sheet))).toContain('Your other answers can still be saved.');

      // Nothing in it can be saved, so Not now closes it without asking.
      press(sheet, 'Not now');
      await settle(fixture);
      expect(dialog()).toBeNull();
      expect(textOf(host)).toContain('Peanuts');
      // The Edit it came from is gone: focus goes to the Health card's heading, not to the page's body.
      expect(document.activeElement).not.toBe(document.body);
      expect(document.activeElement).toBe(host.querySelector('#intake-health'));
      expect(host.querySelector('.panel-head h2:focus')).toBe(document.activeElement);
    });

    it('moves on to Weight when Max ends between Day and food and the health step, and says why', async () => {
      const onMax = halfwayProfile({ selfDirected: true, coachedByTheHouse: true });
      const offMaxNow = { ...onMax, healthStepOpen: false };
      const getSelfProfile = vi.fn().mockReturnValueOnce(of(onMax)).mockReturnValue(of(offMaxNow));
      const updateSelfIntake = vi
        .fn()
        .mockImplementationOnce((request: { version: number }) =>
          of({ ...onMax, version: request.version + 1 }),
        )
        .mockImplementation(() => throwError(closedRefusal));
      const { fixture, host } = await render(onMax, {
        api: { getSelfProfile, updateSelfIntake },
      });

      expect(textOf(host.querySelector('#intake-step-heading'))).toBe('Your day and food');
      press(host, 'Continue');
      await settle(fixture);
      expect(textOf(host.querySelector('#intake-step-heading'))).toBe('Your health');
      expect(textOf(host.querySelector('.kicker'))).toBe('Step 4 of 5');

      fill(host, 'Allergies (optional)', 'Shellfish');
      await settle(fixture);
      press(host, 'Continue');
      await settle(fixture);

      expect(updateSelfIntake).toHaveBeenCalledTimes(2);
      expect(getSelfProfile).toHaveBeenCalledTimes(2);
      expect(textOf(host.querySelector('#intake-step-heading'))).toBe('Where you start');
      expect(textOf(host.querySelector('.kicker'))).toBe('Step 4 of 4');
      expect(host.querySelectorAll('.progress .item.current')).toHaveLength(1);
      expect(progressNames(host)).not.toContain('Health');
      expect(() => field(host, 'Allergies (optional)')).toThrow('No field is labelled');
      expect(textOf(formSummary(host))).toBe(
        'Health answers open on Max, TB Gym’s coaching. Your other answers can still be saved.',
      );
    });
  });

  it('drops a late answer when the workspace changes while a step is being saved', async () => {
    const late = new Subject<ClientSelfProfile>();
    const { fixture, host, tenantId } = await render(newProfile(), {
      api: { updateSelfIntake: vi.fn(() => late) },
    });

    typeDate(host, '2', '4', '1996');
    fill(host, 'Height', '168');
    await settle(fixture);
    press(host, 'Continue');
    await settle(fixture);

    tenantId.set('tenant-2');
    await settle(fixture);
    late.next(newProfile({ firstName: 'Someone', lastName: 'Else', version: 99 }));
    await settle(fixture);

    expect(textOf(host)).not.toContain('Someone');
    expect(textOf(host.querySelector('#intake-step-heading'))).not.toBe('Your goal');
  });
});
