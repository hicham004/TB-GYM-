import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import { TB_GYM_BRAND } from '../../core/theme/brand-theme';
import {
  brandChanged,
  brandSaveError,
  choiceFor,
  contrastNotes,
  logoFileProblem,
  logoUploadError,
  normalizeHex,
} from './workspace-brand.models';

describe('workspace brand models', () => {
  it('starts from the preset the saved colours match, TB Gym’s own when there are none', () => {
    expect(choiceFor(null)).toBe('forest');
    expect(choiceFor({ brand: '#15233F', accent: '#FFB48C' })).toBe('navy');
    expect(choiceFor({ brand: '#36203a', accent: '#f3b4d1' })).toBe('plum');
    expect(choiceFor({ brand: '#15233f', accent: '#ff8a4c' })).toBe('custom');
  });

  it('reads a typed colour as the one shape the server stores', () => {
    expect(normalizeHex('#15233F')).toBe('#15233f');
    expect(normalizeHex(' 15233f ')).toBe('#15233f');
    expect(normalizeHex('#f80')).toBe('#ff8800');
    for (const bad of ['', '#', 'navy', '#15233', '#15233f80', 'rgb(1,2,3)', '#gg0000']) {
      expect(normalizeHex(bad)).toBeNull();
    }
  });

  it('says when a colour is adjusted to stay readable, and only then', () => {
    expect(contrastNotes(TB_GYM_BRAND)).toEqual([]);
    expect(contrastNotes({ brand: '#7fb3ff', accent: '#ffb48c' })).toEqual([
      'Your brand colour is shown a little darker, so white text on it stays easy to read.',
    ]);
    expect(contrastNotes({ brand: '#15233f', accent: '#2a6f3f' })).toEqual([
      'Your accent is shown a little lighter, so dark text on it stays easy to read.',
    ]);
  });

  it('sees a change in either colour or the logo, comparing a missing brand with TB Gym’s', () => {
    const saved = { colors: null, logoAssetId: null };
    expect(brandChanged(saved, { colors: TB_GYM_BRAND, logoAssetId: null })).toBe(false);
    expect(
      brandChanged(saved, { colors: { ...TB_GYM_BRAND, accent: '#ffb48c' }, logoAssetId: null }),
    ).toBe(true);
    expect(brandChanged(saved, { colors: TB_GYM_BRAND, logoAssetId: 'logo-1' })).toBe(true);
    expect(
      brandChanged(
        { colors: { brand: '#15233F', accent: '#FFB48C' }, logoAssetId: 'logo-1' },
        { colors: { brand: '#15233f', accent: '#ffb48c' }, logoAssetId: 'logo-1' },
      ),
    ).toBe(false);
  });

  it('refuses a file the server would refuse, before sending it', () => {
    expect(logoFileProblem({ type: 'image/png', size: 5 * 1024 * 1024 })).toBeNull();
    expect(logoFileProblem({ type: 'image/jpeg', size: 1000 })).toBeNull();
    expect(logoFileProblem({ type: 'image/svg+xml', size: 1000 })).toBe(
      'Choose a PNG or JPEG image.',
    );
    expect(logoFileProblem({ type: 'image/png', size: 5 * 1024 * 1024 + 1 })).toBe(
      'That image is over 5\u00a0MB. Choose a smaller one.',
    );
  });

  it('puts upload and save refusals in the owner’s words, never the server’s', () => {
    const readOnly = new HttpErrorResponse({ status: 403, error: { code: 'workspace_read_only' } });
    expect(logoUploadError(new HttpErrorResponse({ status: 400 }))).toBe(
      'That image couldn’t be used. Try another PNG or JPEG.',
    );
    expect(
      logoUploadError(
        new HttpErrorResponse({ status: 409, error: { code: 'WorkspaceStorageExceeded' } }),
      ),
    ).toContain('storage is full');
    expect(logoUploadError(new HttpErrorResponse({ status: 429 }))).toContain('Another upload');
    expect(logoUploadError(readOnly)).toContain('read-only until its TB Gym bill is paid');
    expect(logoUploadError(new Error('offline'))).toBe('The logo couldn’t be uploaded. Try again.');

    expect(
      brandSaveError(
        new HttpErrorResponse({ status: 409, error: { code: 'concurrency_conflict' } }),
      ),
    ).toContain('changed in another window');
    expect(brandSaveError(readOnly)).toContain('read-only');
    expect(brandSaveError(new HttpErrorResponse({ status: 400 }))).toContain('couldn’t be saved');
    expect(brandSaveError(new HttpErrorResponse({ status: 500 }))).toBe(
      'The brand couldn’t be saved. Try again.',
    );
  });
});
