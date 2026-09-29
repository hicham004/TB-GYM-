import { contrast, isHexColor, mix } from './color';

/**
 * A coaching brand: the two colours a coach picks (plan §3.1). The brand colour fills the sidebar,
 * hero cards and dark surfaces; the accent marks buttons on dark surfaces, rings and achievements.
 */
export interface BrandColors {
  readonly brand: string;
  readonly accent: string;
}

export type BrandPresetId = 'forest' | 'navy' | 'charcoal' | 'plum';

export interface BrandPreset extends BrandColors {
  readonly id: BrandPresetId;
  readonly label: string;
}

/** TB Gym's own brand, the homepage's forest and lime. Everyone sees it until a coach picks one. */
export const TB_GYM_BRAND: BrandColors = { brand: '#153d33', accent: '#d9ed94' };

/** The prototype's four coach brands, in its order (docs/design/prototype). */
export const BRAND_PRESETS: readonly BrandPreset[] = [
  { id: 'forest', label: $localize`Forest and lime`, ...TB_GYM_BRAND },
  { id: 'navy', label: $localize`Navy and coral`, brand: '#15233f', accent: '#ffb48c' },
  { id: 'charcoal', label: $localize`Charcoal and orange`, brand: '#221b18', accent: '#ff8a4c' },
  { id: 'plum', label: $localize`Plum and pink`, brand: '#36203a', accent: '#f3b4d1' },
];

export function brandPreset(id: string | null | undefined): BrandPreset | null {
  return BRAND_PRESETS.find((preset) => preset.id === id) ?? null;
}

/** The brand-dependent custom properties, in the order they are written. */
export const BRAND_TOKEN_NAMES = [
  '--tb-brand',
  '--tb-brand-strong',
  '--tb-on-brand',
  '--tb-on-brand-soft',
  '--tb-on-brand-muted',
  '--tb-accent',
  '--tb-on-accent',
  '--tb-accent-bright',
  '--tb-night',
] as const;

export type BrandTokenName = (typeof BRAND_TOKEN_NAMES)[number];
export type BrandTokens = Readonly<Record<BrandTokenName, string>>;

/** WCAG AA for normal-size text. */
export const AA_TEXT = 4.5;

const WHITE = '#ffffff';
/** Text on the accent, the prototype's green-black. The accent is always light enough for it. */
export const DARK_INK = '#11201b';
/** What the brand is darkened toward: near-black with a green cast. */
const NEAR_BLACK = '#0a100e';
/** The base of the always-dark workout player, as in the prototype. */
const NIGHT_BASE = '#050807';
/**
 * The dark-mode page, surface and raised surface (`_tokens.scss`). Accent text in dark mode must
 * read on all three, so a change to those values has to be repeated here.
 */
export const DARK_SURFACES = ['#0f1513', '#161e1b', '#1d2724'] as const;
/**
 * White on the brand keeps at least this ratio (AAA), so the dimmed sidebar text, which is white
 * with some brand mixed in, still reaches AA.
 */
const BRAND_FLOOR = 7;
const STEP = 0.02;

/**
 * Every brand-dependent token for a pair of colours, with AA contrast guaranteed for each text
 * pairing the screens use. A colour that already passes comes back unchanged (lower-case). One
 * that cannot is moved in small steps, just far enough: the brand toward near-black until white
 * text reads on it, the accent toward white until dark text does. The brand stays a dark surface
 * and the accent a light highlight, as the prototype's custom colour does. Success, warning and
 * danger never derive from the brand, so their meaning never changes.
 */
export function brandTokens(colors: BrandColors): BrandTokens {
  const brand = shiftUntil(colors.brand, NEAR_BLACK, (c) => contrast(c, WHITE) >= BRAND_FLOOR);
  const accent = shiftUntil(colors.accent, WHITE, (c) => contrast(c, DARK_INK) >= AA_TEXT);
  const night = mix(brand, NIGHT_BASE, 0.58);
  // The accent as text or an icon on anything dark: the brand, the player and dark mode.
  const grounds = [brand, night, ...DARK_SURFACES];
  const bright = shiftUntil(accent, WHITE, (c) =>
    grounds.every((ground) => contrast(c, ground) >= AA_TEXT),
  );

  return {
    '--tb-brand': brand,
    '--tb-brand-strong': mix(brand, NEAR_BLACK, 0.35),
    '--tb-on-brand': WHITE,
    '--tb-on-brand-soft': tintedWhite(brand, 0.16),
    '--tb-on-brand-muted': tintedWhite(brand, 0.36),
    '--tb-accent': accent,
    // Lighter than the accent, so dark ink reads on it too.
    '--tb-on-accent': DARK_INK,
    '--tb-accent-bright': bright,
    '--tb-night': night,
  };
}

/** Accepts only two `#rrggbb` colours; anything else falls back to TB Gym's brand. */
export function safeBrand(colors: BrandColors | null | undefined): BrandColors {
  return colors && isHexColor(colors.brand) && isHexColor(colors.accent)
    ? { brand: colors.brand.toLowerCase(), accent: colors.accent.toLowerCase() }
    : TB_GYM_BRAND;
}

/** Mixes `toward` into `color` until `ok` holds. `toward` itself always satisfies `ok` here. */
function shiftUntil(color: string, toward: string, ok: (candidate: string) => boolean): string {
  for (let step = 0; step * STEP < 1; step++) {
    const candidate = mix(color, toward, step * STEP);
    if (ok(candidate)) return candidate;
  }
  return toward;
}

/** White with as much of the brand mixed in as `share` allows while it still reads at AA. */
function tintedWhite(brand: string, share: number): string {
  for (let amount = share; amount > 0; amount -= 0.04) {
    const candidate = mix(WHITE, brand, amount);
    if (contrast(candidate, brand) >= AA_TEXT) return candidate;
  }
  return WHITE;
}
