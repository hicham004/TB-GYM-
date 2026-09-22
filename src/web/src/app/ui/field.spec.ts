import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  FormControl,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { describe, expect, it } from 'vitest';
import { field, fill, leave, query, settle, tick } from '../../testing/dom';
import { Checkbox } from './checkbox';
import { Control, Field } from './field';

@Component({
  imports: [Checkbox, Control, Field, FormsModule, ReactiveFormsModule],
  template: `
    <form [formGroup]="form">
      <app-field label="Exercise name" help="Up to 160 characters." [errors]="nameErrors()">
        <input appControl type="text" formControlName="name" />
      </app-field>
      <app-field label="Instructions" help="Visible to coaches only.">
        <textarea
          appControl
          id="instructions"
          formControlName="instructions"
          aria-describedby="instructions-counter instructions-help"
        ></textarea>
      </app-field>
      <p id="instructions-counter">0 of 8,000</p>
      <app-field label="Equipment" density="compact">
        <select appControl formControlName="equipment" [aria-describedby]="extraDescription()">
          <option value="">Choose equipment…</option>
          <option value="Barbell">Barbell</option>
        </select>
      </app-field>
      <app-field label="Search exercises" hideLabel>
        <input appControl type="search" formControlName="search" />
      </app-field>
      <app-checkbox
        label="Main lift: coaches may swap it only for approved alternatives in every session"
      >
        <input type="checkbox" appControl formControlName="mainLift" />
      </app-checkbox>
    </form>
    <p id="equipment-note">Chosen by the coach</p>
    <app-field label="Nickname">
      <input appControl type="text" name="nickname" [(ngModel)]="nickname" />
    </app-field>
  `,
})
class Host {
  readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    instructions: new FormControl('', { nonNullable: true }),
    equipment: new FormControl('', { nonNullable: true }),
    search: new FormControl('', { nonNullable: true }),
    mainLift: new FormControl(false, { nonNullable: true }),
  });
  readonly nameErrors = signal<string[] | null>(null);
  readonly extraDescription = signal<string | null>(null);
  nickname = '';
}

async function render() {
  await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  await settle(fixture);
  const host = fixture.nativeElement as HTMLElement;
  return { fixture, host, component: fixture.componentInstance };
}

function labelFor(host: HTMLElement, control: HTMLElement): HTMLLabelElement {
  return query<HTMLLabelElement>(host, `label[for="${control.id}"]`);
}

describe('app-field with appControl', () => {
  it('labels each control with a real label and a unique generated id', async () => {
    const { host } = await render();
    const name = field(host, 'Exercise name');
    const nickname = field(host, 'Nickname');

    expect(name.id).toMatch(/^tb-control-\d+$/);
    expect(nickname.id).toMatch(/^tb-control-\d+$/);
    expect(name.id).not.toBe(nickname.id);
    expect(labelFor(host, name).textContent?.trim()).toBe('Exercise name');
    const ids = Array.from(host.querySelectorAll('[id]')).map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps the consumer's own id", async () => {
    const { host } = await render();

    expect(field(host, 'Instructions').id).toBe('instructions');
  });

  it('describes the control with its help text while there is no error', async () => {
    const { host } = await render();
    const name = field(host, 'Exercise name');
    const help = query(host, `#${name.id}-help`);

    expect(help.textContent?.trim()).toBe('Up to 160 characters.');
    expect(name.getAttribute('aria-describedby')).toBe(help.id);
    expect(name.hasAttribute('aria-invalid')).toBe(false);
  });

  it('replaces the help with the error and marks the control invalid for exactly as long', async () => {
    const { fixture, host, component } = await render();
    const name = field(host, 'Exercise name');

    component.nameErrors.set([
      'Enter a name for this exercise.',
      'Names stay unique in this workspace.',
    ]);
    await settle(fixture);

    const error = query(host, `#${name.id}-error`);
    expect(error.querySelectorAll('span')).toHaveLength(2);
    expect(error.getAttribute('role')).toBeNull();
    expect(host.querySelector(`#${name.id}-help`)).toBeNull();
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(name.getAttribute('aria-describedby')).toBe(error.id);

    component.nameErrors.set([]);
    await settle(fixture);

    expect(host.querySelector(`#${name.id}-error`)).toBeNull();
    expect(name.hasAttribute('aria-invalid')).toBe(false);
    expect(name.getAttribute('aria-describedby')).toBe(`${name.id}-help`);
  });

  it('merges consumer descriptions after its own, without duplicates or overwriting', async () => {
    const { host } = await render();

    expect(field(host, 'Instructions').getAttribute('aria-describedby')).toBe(
      'instructions-help instructions-counter',
    );
  });

  it('follows a bound consumer description as it changes', async () => {
    const { fixture, host, component } = await render();
    const equipment = field<HTMLSelectElement>(host, 'Equipment');
    expect(equipment.hasAttribute('aria-describedby')).toBe(false);

    component.extraDescription.set('equipment-note');
    await settle(fixture);
    expect(equipment.getAttribute('aria-describedby')).toBe('equipment-note');

    component.extraDescription.set(null);
    await settle(fixture);
    expect(equipment.hasAttribute('aria-describedby')).toBe(false);
  });

  it('keeps a visually hidden label as the accessible name', async () => {
    const { host } = await render();
    const search = field(host, 'Search exercises');

    expect(labelFor(host, search).classList).toContain('tb-visually-hidden');
  });

  it('applies compact density to the field and its control', async () => {
    const { host } = await render();
    const equipment = field<HTMLSelectElement>(host, 'Equipment');

    expect(equipment.closest('app-field')?.classList).toContain('tb-field--compact');
    expect(equipment.classList).toContain('tb-control--compact');
    expect(equipment.classList).toContain('tb-select');
    expect(field(host, 'Exercise name').classList).not.toContain('tb-control--compact');
  });

  it('leaves reactive-forms binding, dirty and touched state to the native control', async () => {
    const { fixture, host, component } = await render();
    const name = component.form.controls.name;

    fill(host, 'Exercise name', 'Barbell back squat');
    leave(host, 'Exercise name');
    await settle(fixture);

    expect(name.value).toBe('Barbell back squat');
    expect(name.dirty).toBe(true);
    expect(name.touched).toBe(true);
    expect(name.valid).toBe(true);
  });

  it('reflects FormControl.disable() on the native element', async () => {
    const { fixture, host, component } = await render();

    component.form.controls.name.disable();
    await settle(fixture);

    expect(field(host, 'Exercise name').disabled).toBe(true);
  });

  it('works with template-driven ngModel too', async () => {
    const { fixture, host, component } = await render();

    fill(host, 'Nickname', 'Coach S');
    await settle(fixture);

    expect(component.nickname).toBe('Coach S');
  });
});

describe('app-checkbox', () => {
  it('labels the projected checkbox and toggles it from the label text', async () => {
    const { fixture, host, component } = await render();
    const label = 'Main lift: coaches may swap it only for approved alternatives in every session';
    const box = field(host, label);

    expect(box.type).toBe('checkbox');
    expect(box.classList).toContain('tb-checkbox-input');
    expect(box.classList).not.toContain('tb-control');

    labelFor(host, box).click();
    await settle(fixture);
    expect(component.form.controls.mainLift.value).toBe(true);

    tick(host, label, false);
    await settle(fixture);
    expect(component.form.controls.mainLift.value).toBe(false);
  });
});
