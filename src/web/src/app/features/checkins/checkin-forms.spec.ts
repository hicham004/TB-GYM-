import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type {
  CheckInFormDetails,
  CheckInFormVersionView,
  CheckInFormVersionStatus,
} from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import {
  announced,
  leave,
  leaveAt,
  press,
  query,
  submitForm,
  fill,
  settle as settleDom,
} from '../../../testing/dom';
import { CheckInForms } from './checkin-forms';

const QUESTION_KEY = 'a'.repeat(32);

function version(
  id: string,
  versionNumber: number,
  status: CheckInFormVersionStatus,
): CheckInFormVersionView {
  return {
    id,
    formId: 'form-1',
    formTitle: 'Weekly check-in',
    formDescription: null,
    versionNumber,
    status,
    derivedFromVersionId: null,
    publishedAtUtc: status === 'Published' ? '2026-08-22T09:00:00Z' : null,
    publishedByUserId: status === 'Published' ? 'coach-1' : null,
    version: 3,
    questions: [
      {
        id: 'question-1',
        questionKey: QUESTION_KEY,
        order: 1,
        questionType: 'ShortText',
        prompt: 'How is your body feeling?',
        helpText: null,
        isRequired: true,
        scaleMinimum: null,
        scaleMaximum: null,
        scaleStep: null,
        options: [],
      },
    ],
  };
}

function details(...versions: CheckInFormVersionView[]): CheckInFormDetails {
  const published = versions.filter((item) => item.status === 'Published');
  const latest = published.at(-1) ?? null;
  return {
    form: {
      id: 'form-1',
      title: 'Weekly check-in',
      description: null,
      status: latest === null ? 'Draft' : 'Published',
      isArchived: false,
      currentVersionNumber: versions.length,
      draftVersionId: versions.find((item) => item.status === 'Draft')?.id ?? null,
      latestPublishedVersionId: latest?.id ?? null,
      latestPublishedVersionNumber: latest?.versionNumber ?? null,
      version: 2,
    },
    versions: versions.map((item) => ({
      id: item.id,
      versionNumber: item.versionNumber,
      status: item.status,
      derivedFromVersionId: item.derivedFromVersionId,
      publishedAtUtc: item.publishedAtUtc,
      publishedByUserId: item.publishedByUserId,
      questionCount: item.questions.length,
      version: item.version,
    })),
  };
}

/**
 * ngModel writes its value to the DOM through the forms pipeline rather than synchronously, so a
 * single change-detection pass is not enough to observe a rendered value or a disabled control.
 */
async function settle(fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

interface Harness {
  openForm(formId: string): Promise<void>;
  editVersion(versionId: string): Promise<void>;
  startNewForm(): void;
  addQuestion(): void;
  setPrompt(index: number, prompt: string): void;
  setTitle(title: string): void;
  validation(): { isValid: boolean };
}

async function render(api: Partial<ApiClient> = {}) {
  await TestBed.configureTestingModule({
    imports: [CheckInForms],
    providers: [
      {
        provide: ApiClient,
        useValue: {
          listCheckInForms: vi.fn(() =>
            of({ total: 1, items: [details(version('v1', 1, 'Draft')).form] }),
          ),
          ...api,
        },
      },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(CheckInForms);
  await settle(fixture);
  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    component: fixture.componentInstance as unknown as Harness,
  };
}

describe('CheckInForms', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('lists the library and asks for a selection first', async () => {
    const { host } = await render();

    expect(host.textContent).toContain('Weekly check-in');
    expect(host.textContent).toContain('Select a form to see its versions');
  });

  it('offers publish on a draft and a new draft only from the latest published version', async () => {
    const draft = version('v2', 2, 'Draft');
    const published = version('v1', 1, 'Published');
    const { fixture, host, component } = await render({
      getCheckInForm: vi.fn(() => of(details(published, draft))),
    });

    await component.openForm('form-1');
    fixture.detectChanges();

    const text = host.textContent ?? '';
    expect(text).toContain('Publish');
    // A draft is already open, so deriving another is not offered: only one may exist.
    expect(text).not.toContain('New draft from this');

    expect(text).toContain('Publishing freezes a version permanently');
  });

  it('offers a new draft once the lineage has no open draft', async () => {
    const published = version('v1', 1, 'Published');
    const { fixture, host, component } = await render({
      getCheckInForm: vi.fn(() => of(details(published))),
    });

    await component.openForm('form-1');
    await settle(fixture);

    expect(host.textContent).toContain('New draft from this');
  });

  it('renders a published version read-only, with no save and no editable prompt', async () => {
    const published = version('v1', 1, 'Published');
    const { fixture, host, component } = await render({
      getCheckInForm: vi.fn(() => of(details(published))),
      getCheckInFormVersion: vi.fn(() => of(published)),
    });

    await component.openForm('form-1');
    await component.editVersion('v1');
    await settle(fixture);

    expect(host.textContent).toContain('published, read-only');
    expect(host.textContent).toContain('Create a new draft from it to change anything.');
    expect(host.querySelector('button[type="submit"]')).toBeNull();
    expect(host.querySelector<HTMLInputElement>('input[type="text"]')?.disabled).toBe(true);
  });

  it('keeps a draft editable and blocks saving until it is valid', async () => {
    const draft = version('v2', 2, 'Draft');
    const { fixture, host, component } = await render({
      getCheckInForm: vi.fn(() => of(details(draft))),
      getCheckInFormVersion: vi.fn(() => of(draft)),
    });

    await component.openForm('form-1');
    await component.editVersion('v2');
    await settle(fixture);

    expect(component.validation().isValid).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);

    // A question without a prompt is not saveable, and the button says so.
    component.addQuestion();
    await settle(fixture);
    expect(component.validation().isValid).toBe(false);
    expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);

    component.setPrompt(1, 'Anything else?');
    await settle(fixture);
    expect(component.validation().isValid).toBe(true);
  });

  it('requires a title on a brand new form', async () => {
    const { fixture, component } = await render();

    component.startNewForm();
    component.setPrompt(0, 'How is your body feeling?');
    await settle(fixture);
    expect(component.validation().isValid).toBe(false);

    component.setTitle('Weekly check-in');
    await settle(fixture);
    expect(component.validation().isValid).toBe(true);
  });
});

/** The reason rendered against one control, found by the id that control points at. */
function reasonAt(host: HTMLElement, id: string): string {
  return (host.querySelector(`#${id}-reason`)?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * The id of the nth question's prompt input, so a question can be addressed without knowing its
 * local key. Addressed by id rather than by name because `[name]` on an `ngModel` control binds the
 * directive's own input and never reaches the DOM at all.
 */
function questionId(host: HTMLElement, index: number): string {
  return Array.from(host.querySelectorAll<HTMLInputElement>('input[id^="q-"]'))[index].id;
}

/**
 * The builder under the ratified validation convention. Two of the four in-scope sites live here:
 * the form-level reasons above the question list, and the per-question reasons under each question.
 */
describe('CheckInForms validation display', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  async function newForm() {
    const rendered = await render();
    rendered.component.startNewForm();
    await settleDom(rendered.fixture);
    return rendered;
  }

  it('announces nothing and shows no reason on a form nobody has touched', async () => {
    const { host } = await newForm();

    expect(announced(host)).toBe('');
    expect(host.textContent).not.toContain('A title is required.');
    expect(host.textContent).not.toContain('A question needs a prompt.');
  });

  it('reveals the title’s reason when the title is left, and only the title’s', async () => {
    const { fixture, host } = await newForm();

    leave(host, 'Title');
    await settleDom(fixture);

    expect(reasonAt(host, 'builder-title')).toContain('A title is required.');
    expect(host.textContent).not.toContain('A question needs a prompt.');
    expect(announced(host)).toBe('');
  });

  it('reveals one question’s reason when that question is left, and not its neighbour’s', async () => {
    const { fixture, host } = await newForm();

    press(host, 'Add question');
    await settleDom(fixture);

    const first = questionId(host, 0);
    const second = questionId(host, 1);
    leaveAt(host, `#${first}`);
    await settleDom(fixture);

    expect(reasonAt(host, first)).toContain('A question needs a prompt.');
    expect(reasonAt(host, second)).toBe('');
    expect(announced(host)).toBe('');
  });

  it('names every outstanding reason at once when a blocked submit is attempted', async () => {
    const { fixture, host } = await newForm();

    submitForm(host, 'form.builder-form');
    await settleDom(fixture);

    const summary = announced(host);
    expect(summary).toContain('A title is required.');
    expect(summary).toContain('A question needs a prompt.');
    expect(reasonAt(host, 'builder-title')).toContain('A title is required.');
    expect(reasonAt(host, questionId(host, 0))).toContain('A question needs a prompt.');
  });

  it('clears a corrected field’s reason and leaves the question’s standing', async () => {
    const { fixture, host } = await newForm();

    submitForm(host, 'form.builder-form');
    await settleDom(fixture);

    fill(host, 'Title', 'Weekly check-in');
    await settleDom(fixture);

    expect(reasonAt(host, 'builder-title')).toBe('');
    expect(reasonAt(host, questionId(host, 0))).toContain('A question needs a prompt.');
  });

  it('carries aria-invalid and aria-describedby exactly while the reason is showing', async () => {
    const { fixture, host } = await newForm();
    const control = () => query<HTMLInputElement>(host, 'input[name="title"]');

    expect(control().getAttribute('aria-invalid')).toBeNull();
    expect(control().getAttribute('aria-describedby')).toBeNull();

    leave(host, 'Title');
    await settleDom(fixture);

    expect(control().getAttribute('aria-invalid')).toBe('true');
    expect(control().getAttribute('aria-describedby')).toBe('builder-title-reason');

    fill(host, 'Title', 'Weekly check-in');
    await settleDom(fixture);

    expect(control().getAttribute('aria-invalid')).toBeNull();
    expect(control().getAttribute('aria-describedby')).toBeNull();
  });

  it('points the disabled submit at the summary region so its state is explicable', async () => {
    const { host } = await newForm();
    const submit = query<HTMLButtonElement>(host, 'form.builder-form button[type="submit"]');

    expect(submit.disabled).toBe(true);
    expect(submit.getAttribute('aria-describedby')).toBe('builder-summary');
  });
});
