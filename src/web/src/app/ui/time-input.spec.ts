import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { afterEach, describe, expect, it } from 'vitest';
import { query, settle } from '../../testing/dom';
import { Control } from './field';
import { parseTime, TimeInput } from './time-input';

describe('parseTime', () => {
  it.each([
    ['22:00', '22:00'],
    ['07:30', '07:30'],
    ['22.00', '22:00'],
    ['22,00', '22:00'],
    ['22h', '22:00'],
    ['22h15', '22:15'],
    ['2200', '22:00'],
    ['730', '07:30'],
    ['0730', '07:30'],
    ['7', '07:00'],
    ['0', '00:00'],
    [' 23:59 ', '23:59'],
    ['10pm', '22:00'],
    ['10 PM', '22:00'],
    ['7.30 a.m.', '07:30'],
    ['12am', '00:00'],
    ['12pm', '12:00'],
    ['1230pm', '12:30'],
    ['11p', '23:00'],
    // A number pad in another script: Arabic-Indic, Persian and full-width digits, the Arabic separator.
    ['\u0662\u0662\u0660\u0660', '22:00'],
    ['\u0662\u0662\u066b\u0663\u0660', '22:30'],
    ['\u06f7', '07:00'],
    ['\uff12\uff12\uff1a\uff10\uff10', '22:00'],
  ])('reads %j as %s', (typed, time) => {
    expect(parseTime(typed)).toBe(time);
  });

  it.each(['', 'soon', '24:00', '23:60', '7:5', '123:45', '12345', '0pm', '13pm', '22::00', '-1'])(
    'cannot read %j',
    (typed) => {
      expect(parseTime(typed)).toBeNull();
    },
  );
});

@Component({
  imports: [Control, ReactiveFormsModule, TimeInput],
  template: `<form (submit)="$event.preventDefault(); sent = time.value">
    <input type="text" appControl appTimeInput [formControl]="time" />
  </form>`,
})
class Host {
  readonly time = new FormControl('22:00', { nonNullable: true });
  sent: string | null = null;
}

describe('TimeInput', () => {
  afterEach(() => TestBed.resetTestingModule());

  async function render() {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    await settle(fixture);
    const host = fixture.nativeElement as HTMLElement;
    return {
      fixture,
      input: query<HTMLInputElement>(host, 'input'),
      host: fixture.componentInstance,
    };
  }

  async function type(
    fixture: Parameters<typeof settle>[0],
    input: HTMLInputElement,
    text: string,
  ) {
    input.value = text;
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    await settle(fixture);
  }

  it('is a typed box for a number pad, never the browser’s time picker', async () => {
    const { input } = await render();
    expect(input.type).toBe('text');
    expect(input.getAttribute('inputmode')).toBe('decimal');
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.value).toBe('22:00');
  });

  it('writes a time it can read as HH:MM, for the box and its binding, once it is left', async () => {
    const { fixture, input, host } = await render();

    await type(fixture, input, '730');
    expect(input.value).toBe('07:30');
    expect(host.time.value).toBe('07:30');

    await type(fixture, input, '10pm');
    expect(host.time.value).toBe('22:00');
    expect(host.time.touched).toBe(true);
  });

  it('writes it before Enter submits the form, which happens without leaving the box', async () => {
    const { fixture, input, host } = await render();
    input.value = '2230';
    input.dispatchEvent(new Event('input'));
    // A browser's Enter: the key, then the form's implicit submission, with no blur between.
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    input.form!.requestSubmit();
    await settle(fixture);

    expect(input.value).toBe('22:30');
    expect(host.sent).toBe('22:30');
  });

  it('writes it on change, before a form that commits on blur reads it', async () => {
    const { fixture, input, host } = await render();
    input.value = '6.15';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('change'));
    await settle(fixture);
    expect(host.time.value).toBe('06:15');
  });

  it('leaves what it cannot read as typed, for the page to say why', async () => {
    const { fixture, input, host } = await render();
    await type(fixture, input, '25:00');
    expect(input.value).toBe('25:00');
    expect(host.time.value).toBe('25:00');
  });
});
