import { Location } from '@angular/common';
import { provideLocationMocks } from '@angular/common/testing';
import { Component, TemplateRef, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, expect, it } from 'vitest';
import { press, settle } from '../../../testing/dom';
import { UiConfirm } from '../../ui/confirm';
import { GuardedSheets } from './guarded-sheets';
import { confirmSheetLeave } from './leave-guard';
import { UnsavedWork } from './unsaved-work';

@Component({ template: '<p>Other page</p>' })
class OtherPage {}

@Component({
  imports: [UiConfirm],
  template: `
    <button (click)="openEditor()">Open</button>
    <ng-template #editor><input aria-label="Draft" (input)="dirty = true" /></ng-template>
    <ng-template #question let-ref>
      <app-confirm
        message="Discard the draft?"
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        (answer)="ref.close($event)"
      />
    </ng-template>
  `,
})
class SheetPage extends GuardedSheets {
  private readonly editor = viewChild.required<TemplateRef<unknown>>('editor');
  private readonly question = viewChild.required<TemplateRef<unknown>>('question');
  protected confirmDialog() {
    return this.question();
  }
  openEditor() {
    this.show(this.editor(), 'Editor');
  }
}

afterEach(() => {
  TestBed.resetTestingModule();
  document.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());
});

/**
 * The dialog a leave guard opens, found by one of its buttons. `settle` cannot wait for it: it waits
 * for the navigation, which is held until the question is answered.
 */
async function question(harness: RouterTestingHarness, answer: string): Promise<HTMLElement> {
  for (let round = 0; round < 100; round += 1) {
    harness.fixture.detectChanges();
    const asking = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find((dialog) =>
      [...dialog.querySelectorAll('button')].some((item) => item.textContent?.trim() === answer),
    );
    if (asking) return asking;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`No question offered "${answer}".`);
}

it('keeps the sheet and its draft through Browser Back until the person decides', async () => {
  TestBed.configureTestingModule({
    providers: [
      provideLocationMocks(),
      provideRouter([
        { path: 'other', component: OtherPage },
        { path: 'edit', component: SheetPage, canDeactivate: [confirmSheetLeave] },
      ]),
    ],
  });
  const harness = await RouterTestingHarness.create('/other');
  // An app's bootstrap starts the router listening to Back and Forward; a test has to do it.
  TestBed.inject(Router).setUpLocationChangeListener();
  await harness.navigateByUrl('/edit', SheetPage);
  press(harness.routeNativeElement!, 'Open');
  await settle(harness.fixture);
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Draft"]')!;
  input.value = 'Keep this';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await settle(harness.fixture);
  TestBed.inject(Location).back();
  const kept = await question(harness, 'Keep editing');
  expect(document.querySelector('input[aria-label="Draft"]')).toBe(input);
  press(kept, 'Keep editing');
  await settle(harness.fixture);
  expect(TestBed.inject(Router).url).toBe('/edit');
  // The address comes back to the page the person stayed on.
  expect(TestBed.inject(Location).path()).toBe('/edit');
  expect(input.value).toBe('Keep this');
  const leaving = TestBed.inject(Router).navigateByUrl('/other');
  press(await question(harness, 'Discard'), 'Discard');
  expect(await leaving).toBe(true);
  await settle(harness.fixture);
  expect(document.querySelector('input[aria-label="Draft"]')).toBeNull();
  expect(await TestBed.inject(UnsavedWork).confirmLeave()).toBe(true);
});
