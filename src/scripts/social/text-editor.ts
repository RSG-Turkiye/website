/**
 * The text editor: put text on a social image. The person drags a text by
 * hand, resizes it with a pinch or a slider, and picks colour, background
 * and alignment. The preview is drawn by the same code as the final image
 * (drawOverlays), in image pixels, so what is shown is what gets published.
 * The layout math lives in src/lib/text-overlay.ts; this file draws and listens.
 */
import { deps } from './context';
import { esc, button } from './ui';
import { canvasToSocialJpeg } from '../image-upload';
import type { TextOverlay } from './api';
import {
  wrapLines, layoutBox, clampCenter, hitTest, pinchSize, boxFill, OVERLAY_COLORS, MAX_LINE_FRACTION, MIN_SIZE, MAX_SIZE, type Box,
} from '../../lib/text-overlay';

const MAX_OVERLAYS = 5;
const FONT_FAMILY = 'Inter, system-ui, sans-serif';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image did not load'));
    img.src = src;
  });
}

function roundRect(ctx: CanvasRenderingContext2D, b: Box, r: number): void {
  ctx.beginPath();
  ctx.moveTo(b.x + r, b.y);
  ctx.arcTo(b.x + b.w, b.y, b.x + b.w, b.y + b.h, r);
  ctx.arcTo(b.x + b.w, b.y + b.h, b.x, b.y + b.h, r);
  ctx.arcTo(b.x, b.y + b.h, b.x, b.y, r);
  ctx.arcTo(b.x, b.y, b.x + b.w, b.y, r);
  ctx.closePath();
}

/**
 * Draws every text in image pixels (the context may be scaled, so W x H is the
 * image's own size). Clamps each text inside the image and writes the clamped
 * centre back. The selection outline is drawn only when `selected` is given.
 * Returns each text's box.
 */
export function drawOverlays(ctx: CanvasRenderingContext2D, overlays: TextOverlay[], W: number, H: number, selected?: number): Box[] {
  const boxes: Box[] = [];
  overlays.forEach((o) => {
    ctx.save();
    ctx.font = `700 ${o.size * W}px ${FONT_FAMILY}`;
    ctx.textBaseline = 'top';
    const measure = (s: string) => ctx.measureText(s).width;
    const pad0 = Math.round(o.size * W * 0.3);
    const lines = wrapLines(o.text, MAX_LINE_FRACTION * W - 2 * pad0, measure);
    let laid = layoutBox(o, lines, measure, W, H);
    const c = clampCenter(laid.box.x + laid.box.w / 2, laid.box.y + laid.box.h / 2, laid.box.w, laid.box.h, W, H);
    o.x = c.x;
    o.y = c.y;
    laid = layoutBox(o, lines, measure, W, H);
    const { box, lineHeight, pad } = laid;
    boxes.push(box);

    if (lines.length) {
      const fill = boxFill(o);
      if (fill) {
        ctx.fillStyle = fill;
        roundRect(ctx, box, pad);
        ctx.fill();
      }
      if (o.box === 'none') {
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 0.08 * o.size * W * (ctx.getTransform().a || 1); // shadowBlur ignores the transform
      }
      ctx.fillStyle = OVERLAY_COLORS[o.color];
      ctx.textAlign = o.align;
      const lx = o.align === 'left' ? box.x + pad : o.align === 'right' ? box.x + box.w - pad : box.x + box.w / 2;
      lines.forEach((line, i) => ctx.fillText(line, lx, box.y + pad + i * lineHeight));
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  });

  if (selected !== undefined && boxes[selected]) {
    const b = boxes[selected];
    const scale = ctx.getTransform().a || 1; // image pixels to device pixels
    ctx.save();
    ctx.strokeStyle = '#C8102E';
    ctx.lineWidth = 2 / scale;
    ctx.setLineDash([6 / scale, 4 / scale]);
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.restore();
  }
  return boxes;
}

/** The base image and its text at the image's own size, as the JPEG that gets uploaded. */
export async function renderWithText(img: HTMLImageElement, overlays: TextOverlay[]): Promise<Blob> {
  try { await document.fonts.load('700 40px Inter'); } catch { /* draw with the fallback font */ }
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(img, 0, 0, W, H);
  drawOverlays(ctx, overlays.map((o) => ({ ...o })), W, H);
  return canvasToSocialJpeg(canvas);
}

const COLOR_KEYS = [['white', 'colorWhite'], ['black', 'colorBlack'], ['navy', 'colorNavy'], ['red', 'colorRed']] as const;
const BOX_KEYS = [['none', 'boxNone'], ['solid', 'boxSolid'], ['shade', 'boxShade']] as const;
const ALIGN_KEYS = [['left', 'alignLeft'], ['center', 'alignCenter'], ['right', 'alignRight']] as const;

/** Resolves with the edited list (possibly empty), or null when the person cancels. Rejects when the image does not load. */
export async function openTextEditor(opts: { src: string; overlays: TextOverlay[] }): Promise<{ overlays: TextOverlay[] } | null> {
  const { t } = deps();
  const img = await loadImage(opts.src);
  try { await document.fonts.load('700 40px Inter'); } catch { /* draw with the fallback font */ }
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const overlays: TextOverlay[] = opts.overlays.map((o) => ({ ...o }));
  let selected = -1;
  let boxes: Box[] = [];

  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 bg-black/50 overflow-y-auto p-4';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  document.body.appendChild(root);

  return new Promise<{ overlays: TextOverlay[] } | null>((resolve) => {
    const close = () => { document.removeEventListener('keydown', onKey); window.removeEventListener('resize', sizeStage); root.remove(); };
    const finish = (r: { overlays: TextOverlay[] } | null) => { close(); resolve(r); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') finish(null); };
    document.addEventListener('keydown', onKey);

    const stage = () => root.querySelector<HTMLCanvasElement>('[data-stage]')!;
    const toggle = (on: boolean) => (on ? 'bg-navy-light font-semibold text-navy' : 'text-gray-500');
    const group = (label: string, items: string) => `<div class="space-y-1"><div class="text-xs font-medium text-gray-500">${esc(label)}</div>
      <div class="inline-flex flex-wrap rounded-lg border border-border overflow-hidden">${items}</div></div>`;

    const panelHtml = () => {
      const o = overlays[selected];
      const full = overlays.length >= MAX_OVERLAYS;
      const add = `<div class="flex flex-wrap items-center gap-2">${button(t('admin.social.text.add'), `data-add${full ? ' disabled' : ''}`)}
        ${full ? `<span class="text-xs text-gray-500">${esc(t('admin.social.text.max'))}</span>` : ''}</div>`;
      if (!o) return add;
      const opt = <K extends string>(attr: string, pairs: readonly (readonly [K, string])[], current: K, swatch = false) => pairs.map(([v, key]) =>
        `<button type="button" ${attr}="${v}" aria-pressed="${current === v}" class="px-3 py-1.5 text-sm ${toggle(current === v)} focus-visible:outline-2 focus-visible:outline-navy-mid">${swatch ? `<span aria-hidden="true" class="inline-block w-3 h-3 rounded-full border border-border mr-1 align-middle" style="background:${OVERLAY_COLORS[v as keyof typeof OVERLAY_COLORS]}"></span>` : ''}${esc(t(`admin.social.text.${key}`))}</button>`).join('');
      return `${add}
        <textarea data-text maxlength="200" rows="3" class="w-full rounded-lg border border-border p-2 text-sm text-navy focus-visible:outline-2 focus-visible:outline-navy-mid"></textarea>
        <label class="flex items-center gap-2 text-xs text-gray-500">${esc(t('admin.social.text.size'))}
          <input data-size type="range" min="${MIN_SIZE}" max="${MAX_SIZE}" step="0.005" value="${o.size}" class="flex-1"></label>
        ${group(t('admin.social.text.color'), opt('data-color', COLOR_KEYS, o.color, true))}
        ${group(t('admin.social.text.box'), opt('data-box', BOX_KEYS, o.box))}
        ${group(t('admin.social.text.align'), opt('data-align', ALIGN_KEYS, o.align))}
        <div>${button(t('admin.social.text.remove'), 'data-remove', 'danger')}</div>`;
    };

    const renderPanel = (focusText = false, focusSel = '') => {
      const panel = root.querySelector<HTMLElement>('[data-panel]')!;
      panel.innerHTML = panelHtml();
      const o = overlays[selected];
      const ta = panel.querySelector<HTMLTextAreaElement>('[data-text]');
      if (ta && o) { ta.value = o.text; if (focusText) { ta.focus(); ta.select(); } }
      wirePanel(panel);
      if (focusSel) panel.querySelector<HTMLElement>(focusSel)?.focus();
    };

    const select = (i: number) => { selected = i; renderPanel(); draw(); };

    const wirePanel = (panel: HTMLElement) => {
      const o = overlays[selected];
      panel.querySelector('[data-add]')?.addEventListener('click', () => {
        if (overlays.length >= MAX_OVERLAYS) return;
        overlays.push({ text: t('admin.social.text.placeholder'), x: 0.5, y: 0.5, size: 0.06, color: 'white', box: 'shade', align: 'center' });
        selected = overlays.length - 1;
        renderPanel(true);
        draw();
      });
      if (!o) return;
      panel.querySelector<HTMLTextAreaElement>('[data-text]')!.addEventListener('input', (e) => { o.text = (e.target as HTMLTextAreaElement).value; draw(); });
      panel.querySelector<HTMLInputElement>('[data-size]')!.addEventListener('input', (e) => { o.size = Number((e.target as HTMLInputElement).value); draw(); });
      panel.querySelectorAll<HTMLButtonElement>('[data-color]').forEach((b) => b.addEventListener('click', () => { o.color = b.dataset.color as TextOverlay['color']; renderPanel(false, `[data-color="${o.color}"]`); draw(); }));
      panel.querySelectorAll<HTMLButtonElement>('[data-box]').forEach((b) => b.addEventListener('click', () => { o.box = b.dataset.box as TextOverlay['box']; renderPanel(false, `[data-box="${o.box}"]`); draw(); }));
      panel.querySelectorAll<HTMLButtonElement>('[data-align]').forEach((b) => b.addEventListener('click', () => { o.align = b.dataset.align as TextOverlay['align']; renderPanel(false, `[data-align="${o.align}"]`); draw(); }));
      panel.querySelector('[data-remove]')!.addEventListener('click', removeSelected);
    };

    const removeSelected = () => {
      if (selected < 0) return;
      overlays.splice(selected, 1);
      selected = -1;
      renderPanel();
      draw();
      (overlays.length ? stage() : root.querySelector<HTMLElement>('[data-add]') ?? stage()).focus();
    };

    /** Fits the preview in the window: at most 480px wide and 60% of the window high. */
    function sizeStage(): void {
      const c = stage();
      const cssW = Math.max(120, Math.min(480, root.clientWidth - 72, window.innerHeight * 0.6 * W / H));
      const cssH = cssW * H / W;
      const dpr = window.devicePixelRatio || 1;
      c.style.width = `${cssW}px`;
      c.style.height = `${cssH}px`;
      c.width = Math.round(cssW * dpr);
      c.height = Math.round(cssH * dpr);
      draw();
    }

    function draw(): void {
      const c = stage();
      if (!c || !c.width) return;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      ctx.save();
      ctx.scale(c.width / W, c.height / H);
      boxes = drawOverlays(ctx, overlays, W, H, selected >= 0 ? selected : undefined);
      ctx.restore();
    }

    const wireStage = () => {
      const c = stage();
      const pointers = new Map<number, { x: number; y: number }>();
      let grab: { dx: number; dy: number } | null = null;
      let pinch: { size: number; dist: number } | null = null;
      const toImage = (e: PointerEvent) => {
        const r = c.getBoundingClientRect();
        return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
      };
      const syncSlider = () => {
        const s = root.querySelector<HTMLInputElement>('[data-size]');
        if (s && overlays[selected]) s.value = String(overlays[selected].size);
      };
      const spread = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };

      c.addEventListener('pointerdown', (e) => {
        c.setPointerCapture(e.pointerId);
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.size === 2 && selected >= 0) {
          pinch = { size: overlays[selected].size, dist: spread() };
          grab = null;
          return;
        }
        if (pointers.size > 1) return;
        const p = toImage(e);
        const hit = hitTest(boxes, p.x, p.y);
        if (hit !== selected) select(hit);
        if (hit >= 0) {
          const b = boxes[hit];
          grab = { dx: p.x - (b.x + b.w / 2), dy: p.y - (b.y + b.h / 2) };
        } else {
          grab = null;
        }
        draw();
      });
      c.addEventListener('pointermove', (e) => {
        if (!pointers.has(e.pointerId)) return;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const o = overlays[selected];
        if (!o) return;
        if (pointers.size === 2 && pinch) {
          o.size = pinchSize(pinch.size, pinch.dist, spread());
          syncSlider();
          draw();
        } else if (pointers.size === 1 && grab) {
          const p = toImage(e);
          const b = boxes[selected];
          const cc = clampCenter(p.x - grab.dx, p.y - grab.dy, b.w, b.h, W, H);
          o.x = cc.x;
          o.y = cc.y;
          draw();
        }
      });
      const end = (e: PointerEvent) => {
        pointers.delete(e.pointerId);
        if (pointers.size < 2) pinch = null;
        // After a pinch, the remaining finger must not jump the text.
        if (pointers.size === 0 || pinch === null) grab = null;
      };
      c.addEventListener('pointerup', end);
      c.addEventListener('pointercancel', end);

      c.addEventListener('keydown', (e) => {
        if (e.key === 'Tab' && overlays.length) {
          e.preventDefault();
          select((selected + (e.shiftKey ? -1 : 1) + overlays.length) % overlays.length);
          return;
        }
        if (selected < 0) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          root.querySelector<HTMLTextAreaElement>('[data-text]')?.focus();
          return;
        }
        if ((e.key === 'Delete' || e.key === 'Backspace') && document.activeElement === c) {
          e.preventDefault();
          removeSelected();
          return;
        }
        const step = { ArrowLeft: [-0.01, 0], ArrowRight: [0.01, 0], ArrowUp: [0, -0.01], ArrowDown: [0, 0.01] }[e.key];
        if (!step) return;
        e.preventDefault();
        const o = overlays[selected];
        const b = boxes[selected];
        const cc = clampCenter((o.x + step[0]) * W, (o.y + step[1]) * H, b.w, b.h, W, H);
        o.x = cc.x;
        o.y = cc.y;
        draw();
      });
    };

    root.innerHTML = `<div class="max-w-3xl mx-auto mt-6 bg-white rounded-2xl border border-border p-5 space-y-3">
      <h3 class="font-semibold text-navy">${esc(t('admin.social.text.title'))}</h3>
      <p class="text-xs text-gray-500">${esc(t('admin.social.text.hint'))}</p>
      <div class="flex flex-col md:flex-row gap-4 items-start">
        <canvas data-stage tabindex="0" aria-label="${esc(t('admin.social.text.stage'))}" class="block mx-auto md:mx-0 shrink-0 rounded ring-1 ring-border cursor-move touch-none focus-visible:outline-2 focus-visible:outline-navy-mid"></canvas>
        <div data-panel class="flex-1 min-w-0 w-full space-y-3"></div>
      </div>
      <div class="flex justify-end gap-2">
        ${button(t('admin.social.text.cancel'), 'data-cancel')}
        <button type="button" data-apply class="px-3 py-1.5 rounded-lg text-sm font-medium bg-navy text-white disabled:opacity-40">${esc(t('admin.social.text.apply'))}</button>
      </div></div>`;
    root.querySelector('[data-cancel]')!.addEventListener('click', () => finish(null));
    root.querySelector('[data-apply]')!.addEventListener('click', () => {
      const out = overlays.map((o) => ({ ...o, text: o.text.trim() })).filter((o) => o.text.length > 0);
      finish({ overlays: out });
    });
    window.addEventListener('resize', sizeStage);
    wireStage();
    selected = overlays.length ? 0 : -1;
    renderPanel();
    sizeStage();
    stage().focus();
  });
}
