/**
 * Whether text can be read, measured rather than eyeballed.
 *
 * The palette is small and the failures were repetitive -- one grey used for
 * every caption, one white opacity used for every footer line -- so the
 * useful check is not "does this class look light" but "what is the ratio
 * between this text and the thing actually behind it". That needs the
 * rendered page, because the background comes from an ancestor.
 *
 * WCAG 2.1 AA: 4.5:1 for normal text, 3:1 for large text (>=24px, or >=18.66px
 * when bold).
 */

export const REQUIRED_NORMAL = 4.5;
export const REQUIRED_LARGE = 3;

/** The brand tokens, from src/styles/global.css. Both sites share them. */
export const TOKENS: Record<string, string> = {
  navy: '1a2744',
  'navy-mid': '3d5a9e',
  'navy-light': 'eef1f8',
  red: 'c0232a',
  'red-hover': 'e05555',
  'red-tint': 'fdeaea',
  neutral: 'f7f7f6',
  border: 'e5e4df',
  white: 'ffffff',
  black: '000000',
};

/** Tailwind's default greys, the only scale this site borrows. */
export const GREY: Record<string, string> = {
  '50': 'f9fafb',
  '100': 'f3f4f6',
  '200': 'e5e7eb',
  '300': 'd1d5db',
  '400': '9ca3af',
  '500': '6b7280',
  '600': '4b5563',
  '700': '374151',
  '800': '1f2937',
  '900': '111827',
};

export function relativeLuminance(hex: string): number {
  const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: string, b: string): number {
  const [x, y] = [relativeLuminance(a), relativeLuminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** `fg` drawn at `alpha` over `bg`, as an opaque hex -- what text-white/40 is. */
export function composite(fg: string, alpha: number, bg: string): string {
  const f = [0, 2, 4].map((i) => parseInt(fg.slice(i, i + 2), 16));
  const b = [0, 2, 4].map((i) => parseInt(bg.slice(i, i + 2), 16));
  return f.map((c, i) => Math.round(c * alpha + b[i] * (1 - alpha)).toString(16).padStart(2, '0')).join('');
}

/** The hex a `text-` or `bg-` class resolves to, or null when it is not a colour we know. */
export function colorOf(cls: string, prefix: 'text' | 'bg'): { hex: string; alpha: number } | null {
  const m = new RegExp(`^${prefix}-(.+)$`).exec(cls);
  if (!m) return null;
  let name = m[1];
  let alpha = 1;
  const slash = name.lastIndexOf('/');
  if (slash !== -1) {
    const pct = Number(name.slice(slash + 1));
    if (!Number.isFinite(pct)) return null;
    alpha = pct / 100;
    name = name.slice(0, slash);
  }
  const arbitrary = /^\[#([0-9a-fA-F]{6})\]$/.exec(name);
  if (arbitrary) return { hex: arbitrary[1].toLowerCase(), alpha };
  const grey = /^gray-(\d{2,3})$/.exec(name);
  if (grey && GREY[grey[1]]) return { hex: GREY[grey[1]], alpha };
  if (TOKENS[name]) return { hex: TOKENS[name], alpha };
  return null;
}

/** Tailwind's font sizes, in px, for the ones this site uses. */
const FONT_PX: Record<string, number> = {
  'text-xs': 12,
  'text-sm': 14,
  'text-base': 16,
  'text-lg': 18,
  'text-xl': 20,
  'text-2xl': 24,
  'text-3xl': 30,
  'text-4xl': 36,
  'text-5xl': 48,
  'text-6xl': 60,
  'text-7xl': 72,
  'text-8xl': 96,
};

const BOLD = /^font-(bold|semibold|extrabold|black)$/;

/**
 * WCAG's "large text": 24px, or 18.66px when bold. Inherited sizes are not
 * tracked -- an element with no size class is assumed to be body text, which
 * is the stricter assumption and therefore the safe one.
 */
export function isLargeText(classes: string[]): boolean {
  const size = classes.map((c) => FONT_PX[c]).find((n) => n !== undefined) ?? 16;
  const bold = classes.some((c) => BOLD.test(c));
  return size >= 24 || (bold && size >= 18.66);
}

export function required(classes: string[]): number {
  return isLargeText(classes) ? REQUIRED_LARGE : REQUIRED_NORMAL;
}
