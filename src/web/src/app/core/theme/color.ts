/**
 * sRGB colour arithmetic for the theme: parsing `#rrggbb`, mixing, and the WCAG 2 contrast ratio.
 * Everything works on six-digit hex strings, the only form a brand colour is accepted in, so a
 * derived colour can be written straight into a CSS custom property.
 */

const HEX = /^#[0-9a-f]{6}$/i;

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export function isHexColor(value: string): boolean {
  return HEX.test(value);
}

function parse(hex: string): Rgb {
  if (!HEX.test(hex)) throw new Error(`Expected a #rrggbb colour, got "${hex}".`);
  const value = Number.parseInt(hex.slice(1), 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

function format({ r, g, b }: Rgb): string {
  const channel = (value: number) =>
    Math.round(Math.min(255, Math.max(0, value)))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** `amount` (0 to 1) of `other` mixed into `color`, like CSS `color-mix(in srgb, ...)`. */
export function mix(color: string, other: string, amount: number): string {
  const from = parse(color);
  const to = parse(other);
  const blend = (a: number, b: number) => a + (b - a) * amount;
  return format({ r: blend(from.r, to.r), g: blend(from.g, to.g), b: blend(from.b, to.b) });
}

/** WCAG 2 relative luminance, 0 for black to 1 for white. */
export function luminance(hex: string): number {
  const { r, g, b } = parse(hex);
  const linear = (value: number) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG 2 contrast ratio, from 1 (same colour) to 21 (black on white). Order does not matter. */
export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}
