// Coin-medallion badge rendering: Growth rank (seed/sprout/sapling/legacy_tree)
// and Pipeline achievement badges. Design settled through iteration in
// https://claude.ai/code/artifact/639aefa6-a07b-4132-861f-1fb48e664f66 --
// reeded edge, TR legend on the top half of the rim, EN on the bottom half,
// same font/size for both, small seam dots where they meet. 48px is the
// floor for legibility; don't render smaller.

export type Rank = 'seed' | 'sprout' | 'sapling' | 'legacy_tree';
export type AchievementCode = 'variant_analysis' | 'read_qc' | 'read_alignment' | 'genome_assembly';

const RANK_LABELS: Record<Rank, { tr: string; en: string }> = {
  seed: { tr: 'TOHUM', en: 'SEED' },
  sprout: { tr: 'FİLİZ', en: 'SPROUT' },
  sapling: { tr: 'FİDAN', en: 'SAPLING' },
  legacy_tree: { tr: 'ÇINAR', en: 'LEGACY TREE' },
};

const ACHIEVEMENT_LABELS: Record<AchievementCode, { tr: string; en: string }> = {
  variant_analysis: { tr: 'VARYANT ANALİZİ', en: 'VARIANT ANALYSIS' },
  read_qc: { tr: 'OKUMA QC', en: 'READ QC' },
  read_alignment: { tr: 'OKUMA HİZALAMA', en: 'READ ALIGNMENT' },
  genome_assembly: { tr: 'GENOM MONTAJI', en: 'GENOME ASSEMBLY' },
};

const RANK_ICONS: Record<Rank, string> = {
  seed: `
    <ellipse cx="50" cy="55" rx="12" ry="15" fill="#8a6a45"/>
    <path d="M50 41 C52 46 52 51 50 56" stroke="#5c4229" stroke-width="1.4" stroke-linecap="round" fill="none"/>
    <ellipse cx="45.5" cy="50" rx="3.2" ry="4.6" fill="#a9855c" opacity="0.6"/>`,
  sprout: `
    <path d="M50 70 V52" stroke="#4f9d5c" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M50 55 C41 55 37 48 35 40 C45 40 50 46 50 55Z" fill="#5cb56a"/>
    <path d="M50 50 C59 50 63 43 65 35 C55 35 50 42 50 50Z" fill="#4f9d5c"/>
    <ellipse cx="50" cy="71" rx="7.5" ry="2.2" fill="#2f3d2c" opacity="0.4"/>`,
  sapling: `
    <path d="M50 72 V54" stroke="#6b4a2c" stroke-width="3.4" stroke-linecap="round"/>
    <circle cx="50" cy="42" r="14" fill="#4f9d5c"/>
    <circle cx="40" cy="47" r="7.6" fill="#5cb56a"/>
    <circle cx="60" cy="47" r="7.6" fill="#458750"/>
    <ellipse cx="50" cy="73" rx="9" ry="2.3" fill="#2f3d2c" opacity="0.4"/>`,
  legacy_tree: `
    <path d="M50 74 V56" stroke="#8a6a45" stroke-width="4.6" stroke-linecap="round"/>
    <path d="M50 65 L42 71 M50 65 L58 71" stroke="#8a6a45" stroke-width="2.4" stroke-linecap="round"/>
    <circle cx="50" cy="41" r="15.5" fill="#d1a13a"/>
    <circle cx="37" cy="47" r="9" fill="#c99a37"/>
    <circle cx="63" cy="47" r="9" fill="#b98d34"/>
    <circle cx="50" cy="32" r="8.5" fill="#dcae45"/>
    <ellipse cx="50" cy="75" rx="11" ry="2.4" fill="#2f3d2c" opacity="0.45"/>`,
};

const ACHIEVEMENT_ICONS: Record<AchievementCode, string> = {
  variant_analysis: `
    <rect x="26" y="43" width="48" height="5" rx="2" fill="#3fa7ad"/>
    <rect x="26" y="53" width="48" height="5" rx="2" fill="#3fa7ad"/>
    <rect x="26" y="63" width="48" height="5" rx="2" fill="#3fa7ad"/>
    <rect x="52" y="40" width="4" height="30" rx="1" fill="#e0503f"/>`,
  read_qc: `
    <line x1="32" y1="50" x2="68" y2="50" stroke="#3fa7ad" stroke-width="2.2" stroke-linecap="round"/>
    <line x1="32" y1="42" x2="32" y2="58" stroke="#8fa0ba" stroke-width="1.8" stroke-linecap="round"/>
    <line x1="68" y1="42" x2="68" y2="58" stroke="#8fa0ba" stroke-width="1.8" stroke-linecap="round"/>
    <line x1="23" y1="41" x2="29" y2="47" stroke="#e0503f" stroke-width="2" stroke-linecap="round"/>
    <line x1="23" y1="47" x2="29" y2="41" stroke="#e0503f" stroke-width="2" stroke-linecap="round"/>
    <line x1="71" y1="41" x2="77" y2="47" stroke="#e0503f" stroke-width="2" stroke-linecap="round"/>
    <line x1="71" y1="47" x2="77" y2="41" stroke="#e0503f" stroke-width="2" stroke-linecap="round"/>`,
  read_alignment: `
    <rect x="26" y="43" width="48" height="5" rx="2" fill="#3fa7ad"/>
    <rect x="32" y="53" width="36" height="5" rx="2" fill="#3fa7ad"/>
    <rect x="26" y="63" width="48" height="5" rx="2" fill="#3fa7ad"/>`,
  genome_assembly: `
    <path d="M40 34 C40 42 60 42 60 50 C60 58 40 58 40 66" stroke="#8b6fd1" stroke-width="2.1" fill="none"/>
    <path d="M60 34 C60 42 40 42 40 50 C40 58 60 58 60 66" stroke="#8b6fd1" stroke-width="2.1" fill="none" opacity="0.55"/>
    <line x1="42" y1="38" x2="58" y2="38" stroke="#8fa0ba" stroke-width="1.5"/>
    <line x1="40.5" y1="46" x2="59.5" y2="46" stroke="#8fa0ba" stroke-width="1.5"/>
    <line x1="40.5" y1="54" x2="59.5" y2="54" stroke="#8fa0ba" stroke-width="1.5"/>
    <line x1="42" y1="62" x2="58" y2="62" stroke="#8fa0ba" stroke-width="1.5"/>`,
};

const SURFACE = '#16233a';
const SURFACE_PEAK = '#1c2c47';
const RING_GROWTH = '#4f9d5c';
const RING_GROWTH_PEAK = '#d1a13a';
const RING_PIPELINE = '#3fa7ad';

let reedTicksCache = '';
function reedTicks(): string {
  if (reedTicksCache) return reedTicksCache;
  const TICKS = 60, R_IN = 40, R_OUT = 44;
  const parts: string[] = [];
  for (let i = 0; i < TICKS; i++) {
    const a = (i / TICKS) * Math.PI * 2;
    const cos = Math.cos(a), sin = Math.sin(a);
    const x1 = (50 + R_IN * cos).toFixed(2), y1 = (50 + R_IN * sin).toFixed(2);
    const x2 = (50 + R_OUT * cos).toFixed(2), y2 = (50 + R_OUT * sin).toFixed(2);
    parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="currentColor" stroke-width="1" opacity="0.75"/>`);
  }
  reedTicksCache = parts.join('');
  return reedTicksCache;
}

let uidCounter = 0;

function medallionSvg(opts: {
  size: number;
  ring: string;
  surface: string;
  tr: string;
  en: string;
  icon: string;
  title: string;
}): string {
  const uid = `bdg-${uidCounter++}`;
  return `
    <svg viewBox="0 0 100 100" width="${opts.size}" height="${opts.size}" style="color:${opts.ring}; overflow:visible; flex-shrink:0;" role="img" aria-label="${opts.title}">
      <circle cx="50" cy="50" r="45" fill="${opts.surface}" stroke="${opts.ring}" stroke-width="1"/>
      <g>${reedTicks()}</g>
      <circle cx="17" cy="50" r="1.3" fill="${opts.ring}" opacity="0.85"/>
      <circle cx="83" cy="50" r="1.3" fill="${opts.ring}" opacity="0.85"/>
      <path id="${uid}t" d="M 17,50 A 33,33 0 0 1 83,50" fill="none"/>
      <text font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-weight="600" font-size="7.2" letter-spacing="0.02em" fill="#eef3f8"><textPath href="#${uid}t" startOffset="50%" text-anchor="middle">${opts.tr}</textPath></text>
      <path id="${uid}b" d="M 83,50 A 33,33 0 0 1 17,50" fill="none"/>
      <text font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-weight="600" font-size="7.2" letter-spacing="0.02em" fill="#eef3f8"><textPath href="#${uid}b" startOffset="50%" text-anchor="middle">${opts.en}</textPath></text>
      ${opts.icon}
    </svg>`;
}

/** Minimum legible size -- smaller was tested and rejected (see the design artifact). */
export const MIN_BADGE_SIZE = 48;

export function rankBadgeSvg(rank: string, size: number = MIN_BADGE_SIZE): string {
  const key = (rank as Rank) in RANK_LABELS ? (rank as Rank) : 'seed';
  const label = RANK_LABELS[key];
  const isPeak = key === 'legacy_tree';
  return medallionSvg({
    size,
    ring: isPeak ? RING_GROWTH_PEAK : RING_GROWTH,
    surface: isPeak ? SURFACE_PEAK : SURFACE,
    tr: label.tr,
    en: label.en,
    icon: RANK_ICONS[key],
    title: `${label.en} rank`,
  });
}

export function achievementBadgeSvg(code: string, size: number = MIN_BADGE_SIZE): string | null {
  if (!(code in ACHIEVEMENT_LABELS)) return null;
  const key = code as AchievementCode;
  const label = ACHIEVEMENT_LABELS[key];
  return medallionSvg({
    size,
    ring: RING_PIPELINE,
    surface: SURFACE,
    tr: label.tr,
    en: label.en,
    icon: ACHIEVEMENT_ICONS[key],
    title: `${label.en} badge`,
  });
}

export function achievementLabel(code: string): string {
  return (ACHIEVEMENT_LABELS as Record<string, { en: string }>)[code]?.en ?? code;
}
