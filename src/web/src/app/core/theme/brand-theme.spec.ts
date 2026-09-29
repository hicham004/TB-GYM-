import { describe, expect, it } from 'vitest';
import {
  BRAND_PRESETS,
  brandTokens,
  DARK_INK,
  DARK_SURFACES,
  safeBrand,
  TB_GYM_BRAND,
} from './brand-theme';
import { contrast } from './color';

describe('coach brand tokens', () => {
  it('matches the CSS defaults before the theme store starts', () => {
    expect(brandTokens(TB_GYM_BRAND)).toEqual({
      '--tb-brand': '#153d33',
      '--tb-brand-strong': '#112d26',
      '--tb-on-brand': '#ffffff',
      '--tb-on-brand-soft': '#dae0de',
      '--tb-on-brand-muted': '#abb9b6',
      '--tb-accent': '#d9ed94',
      '--tb-on-accent': '#11201b',
      '--tb-accent-bright': '#d9ed94',
      '--tb-night': '#0c1e19',
    });
  });

  it('keeps every prototype brand readable on the brand, accent and dark surfaces', () => {
    for (const preset of BRAND_PRESETS) {
      const tokens = brandTokens(preset);
      const brand = tokens['--tb-brand'];
      const accent = tokens['--tb-accent'];
      const bright = tokens['--tb-accent-bright'];

      expect(contrast(brand, tokens['--tb-on-brand']), preset.id).toBeGreaterThanOrEqual(7);
      expect(contrast(brand, tokens['--tb-on-brand-muted']), preset.id).toBeGreaterThanOrEqual(4.5);
      expect(contrast(accent, tokens['--tb-on-accent']), preset.id).toBeGreaterThanOrEqual(4.5);
      for (const surface of [brand, tokens['--tb-night'], ...DARK_SURFACES]) {
        expect(contrast(bright, surface), `${preset.id} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('adjusts extreme custom colours and rejects values outside six-digit hex', () => {
    for (const colors of [
      { brand: '#ffffff', accent: '#000000' },
      { brand: '#ffff00', accent: '#ff0000' },
    ]) {
      const tokens = brandTokens(colors);
      expect(contrast(tokens['--tb-brand'], '#ffffff')).toBeGreaterThanOrEqual(7);
      expect(contrast(tokens['--tb-accent'], DARK_INK)).toBeGreaterThanOrEqual(4.5);
    }
    expect(safeBrand({ brand: 'red', accent: '#d9ed94' })).toEqual(TB_GYM_BRAND);
    expect(safeBrand({ brand: '#153d33', accent: 'url(x)' })).toEqual(TB_GYM_BRAND);
  });
});
