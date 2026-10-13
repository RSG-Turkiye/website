/**
 * Arithmetic for the social panel's cropper, kept free of the DOM so it can be
 * tested. Rectangles are in the original image's pixels. "Crop" cuts an area
 * of the target shape out of the image; "fit" keeps the whole image and pads
 * it with white to the target shape, which suits posters with text near the edges.
 */
export interface Rect { x: number; y: number; w: number; h: number }
export type PostShape = 'image' | 'carousel' | 'story';

/** The shapes Instagram accepts, as width / height (functions/_lib/social-limits.ts holds the rule). */
export const FEED_RATIOS = [
  { id: '4:5', value: 4 / 5 },
  { id: '1:1', value: 1 },
  { id: '1.91:1', value: 1.91 },
] as const;
export const STORY_RATIOS = [{ id: '9:16', value: 9 / 16 }] as const;

export function ratiosFor(type: PostShape): readonly { id: string; value: number }[] {
  return type === 'story' ? STORY_RATIOS : FEED_RATIOS;
}

/** The allowed shape closest to the image's own, so the first crop loses the least. */
export function nearestRatio(width: number, height: number, type: PostShape): { id: string; value: number } {
  const r = width / height;
  return [...ratiosFor(type)].sort((a, b) => Math.abs(Math.log(r / a.value)) - Math.abs(Math.log(r / b.value)))[0];
}

/** The largest area of the given shape, centred. */
export function centerCrop(width: number, height: number, ratio: number): Rect {
  const w = Math.min(width, Math.round(height * ratio));
  const h = Math.min(height, Math.round(w / ratio));
  return { x: Math.round((width - w) / 2), y: Math.round((height - h) / 2), w, h };
}

/** Keeps a rectangle inside the image without changing its size. */
export function clampRect(r: Rect, width: number, height: number): Rect {
  return {
    x: Math.round(Math.min(Math.max(r.x, 0), width - r.w)),
    y: Math.round(Math.min(Math.max(r.y, 0), height - r.h)),
    w: r.w,
    h: r.h,
  };
}

/** Zoom 1 is the largest area; zoom 4 a quarter of its width. The centre stays where it was. */
export function zoomCrop(current: Rect, width: number, height: number, ratio: number, zoom: number): Rect {
  const base = centerCrop(width, height, ratio);
  const z = Math.min(Math.max(zoom, 1), 4);
  const w = Math.max(1, Math.round(base.w / z));
  const h = Math.max(1, Math.round(w / ratio));
  const cx = current.x + current.w / 2;
  const cy = current.y + current.h / 2;
  return clampRect({ x: cx - w / 2, y: cy - h / 2, w, h }, width, height);
}

/** The zoom a rectangle corresponds to, for setting the slider when a saved crop is reopened. */
export function zoomOf(r: Rect, width: number, height: number, ratio: number): number {
  return Math.min(Math.max(centerCrop(width, height, ratio).w / r.w, 1), 4);
}

/** Moves the crop by a drag measured in screen pixels on a preview `stageWidth` wide (dragging right shows more of the left). */
export function panCrop(r: Rect, dx: number, dy: number, stageWidth: number, width: number, height: number): Rect {
  const scale = r.w / stageWidth;
  return clampRect({ ...r, x: r.x - dx * scale, y: r.y - dy * scale }, width, height);
}

/** The padded frame that holds the whole image at the target shape, and where the image sits in it. */
export function fitFrame(width: number, height: number, ratio: number): { w: number; h: number; ox: number; oy: number } {
  const w = width / height > ratio ? width : Math.round(height * ratio);
  const h = width / height > ratio ? Math.round(width / ratio) : height;
  return { w, h, ox: Math.round((w - width) / 2), oy: Math.round((h - height) / 2) };
}

/** Final pixel size: never larger than the source area, longest side at most `max`. */
export function outputSize(w: number, h: number, max = 2000): { w: number; h: number } {
  const s = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}
