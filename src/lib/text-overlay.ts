/**
 * Layout for text drawn onto social images, free of the DOM so it can be
 * tested. Positions are fractions of the image (the box centre); sizes are
 * fractions of the image width. The editor and the final render share this,
 * so what the preview shows is what gets published.
 */
import type { OverlayColor } from '../../functions/_lib/social-posts';

// Defined once, next to the server rules; re-exported for the editor.
export type { OverlayColor };
export type Measure = (text: string) => number;
export interface Box { x: number; y: number; w: number; h: number }

export const OVERLAY_COLORS: Record<OverlayColor, string> = { white: '#ffffff', black: '#111111', navy: '#1B2A4A', red: '#C8102E' };
export const MIN_SIZE = 0.02;
export const MAX_SIZE = 0.2;
/** Lines wrap at 90% of the image width. */
export const MAX_LINE_FRACTION = 0.9;

export function wrapLines(text: string, maxWidth: number, measure: Measure): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (measure(next) <= maxWidth) { line = next; continue; }
      if (line) out.push(line);
      // A single word wider than the line is split by characters.
      let rest = word;
      while (measure(rest) > maxWidth) {
        let n = 1;
        while (n < rest.length && measure(rest.slice(0, n + 1)) <= maxWidth) n++;
        out.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      line = rest;
    }
    if (line) out.push(line);
  }
  return out;
}

export function layoutBox(o: { x: number; y: number; size: number }, lines: string[], measure: Measure, W: number, H: number): { box: Box; lineHeight: number; pad: number } {
  const px = o.size * W;
  const lineHeight = Math.round(px * 1.2);
  const pad = Math.round(px * 0.3);
  const w = Math.max(0, ...lines.map(measure)) + 2 * pad;
  const h = lines.length * lineHeight + 2 * pad;
  return { box: { x: o.x * W - w / 2, y: o.y * H - h / 2, w, h }, lineHeight, pad };
}

/** The centre, as fractions, that keeps a w x h box inside a W x H image. */
export function clampCenter(cx: number, cy: number, w: number, h: number, W: number, H: number): { x: number; y: number } {
  const fx = w >= W ? W / 2 : Math.min(Math.max(cx, w / 2), W - w / 2);
  const fy = h >= H ? H / 2 : Math.min(Math.max(cy, h / 2), H - h / 2);
  return { x: Math.round((fx / W) * 1e4) / 1e4, y: Math.round((fy / H) * 1e4) / 1e4 };
}

export function hitTest(boxes: Box[], px: number, py: number): number {
  for (let i = boxes.length - 1; i >= 0; i--) {
    const b = boxes[i];
    if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) return i;
  }
  return -1;
}

export function pinchSize(start: number, startDist: number, dist: number): number {
  const s = startDist > 0 ? start * (dist / startDist) : start;
  return Math.round(Math.min(Math.max(s, MIN_SIZE), MAX_SIZE) * 1e4) / 1e4;
}

export function boxFill(o: { color: OverlayColor; box: 'none' | 'solid' | 'shade' }): string | null {
  if (o.box === 'shade') return 'rgba(0,0,0,0.45)';
  if (o.box === 'solid') return o.color === 'white' ? OVERLAY_COLORS.navy : '#ffffff';
  return null;
}
