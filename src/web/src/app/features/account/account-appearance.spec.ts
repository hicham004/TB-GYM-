import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthStore } from '../../core/auth/auth.store';
import { settle } from '../../../testing/dom';
import { AccountAppearance } from './account-appearance';

describe('AccountAppearance', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('saves a personal mode through the account and reports a failed save', async () => {
    const user = signal({ id: 'member', preferredThemeMode: 'system' });
    const updateThemeMode = vi.fn(async (mode: string) => {
      user.set({ id: 'member', preferredThemeMode: mode });
    });
    await TestBed.configureTestingModule({
      imports: [AccountAppearance],
      providers: [{ provide: AuthStore, useValue: { user, updateThemeMode } }],
    }).compileComponents();
    const fixture = TestBed.createComponent(AccountAppearance);
    await settle(fixture);
    const host = fixture.nativeElement as HTMLElement;
    const dark = host.querySelector<HTMLInputElement>('input[value="dark"]')!;
    dark.click();
    await settle(fixture);
    expect(updateThemeMode).toHaveBeenCalledWith('dark');
    expect(dark.checked).toBe(true);

    updateThemeMode.mockRejectedValueOnce(new Error('save failed'));
    host.querySelector<HTMLInputElement>('input[value="light"]')!.click();
    await settle(fixture);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Couldn’t save');
    expect(dark.checked).toBe(true);
  });
});
