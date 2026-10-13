/**
 * The cropper: shows the image at an allowed shape, the person drags and
 * zooms (or fits it whole with white edges), and the result is drawn to a
 * canvas and encoded as the JPEG that gets uploaded. The math lives in
 * src/lib/image-crop.ts; this file only draws and listens.
 */
import { deps } from './context';
import { esc, button } from './ui';
import { canvasToSocialJpeg } from '../image-upload';
import {
  ratiosFor, nearestRatio, centerCrop, zoomCrop, zoomOf, panCrop, fitFrame, outputSize, type Rect, type PostShape,
} from '../../lib/image-crop';

export interface CropResult { blob: Blob; mode: 'crop' | 'fit'; rect: Rect }
export interface CropStart { mode: 'crop' | 'fit'; rect: Rect; ratio: number }

/** Same-origin address for an uploaded image, so drawing it does not taint the canvas (local dev serves /api/images itself). */
export function sameOrigin(url: string): string {
  const u = new URL(url, location.href);
  return u.origin === location.origin ? u.href : u.pathname;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image did not load'));
    img.src = src;
  });
}

/** Resolves with the encoded result, or null when the person cancels; rejects when the browser cannot encode. */
export async function openCropper(opts: { src: string; type: PostShape; start?: CropStart }): Promise<CropResult | null> {
  const { t } = deps();
  const img = await loadImage(opts.src);
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const ratios = ratiosFor(opts.type);
  let ratio = opts.start
    ? [...ratios].sort((a, b) => Math.abs(a.value - opts.start!.ratio) - Math.abs(b.value - opts.start!.ratio))[0].value
    : nearestRatio(W, H, opts.type).value;
  let mode: 'crop' | 'fit' = opts.start?.mode ?? 'crop';
  let rect: Rect = opts.start?.mode === 'crop' ? opts.start.rect : centerCrop(W, H, ratio);

  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 bg-black/50 overflow-y-auto p-4';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  document.body.appendChild(root);

  return new Promise<CropResult | null>((resolve, reject) => {
    const close = () => { document.removeEventListener('keydown', onKey); root.remove(); };
    const finish = (r: CropResult | null) => { close(); resolve(r); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') finish(null); };
    document.addEventListener('keydown', onKey);

    const render = () => {
      root.innerHTML = `<div class="max-w-xl mx-auto mt-6 bg-white rounded-2xl border border-border p-5 space-y-3">
        <h3 class="font-semibold text-navy">${esc(t('admin.social.crop.title'))}</h3>
        <p class="text-xs text-gray-500">${esc(t('admin.social.crop.hint'))}</p>
        <div class="flex flex-wrap gap-2 items-center">
          <div class="inline-flex rounded-lg border border-border overflow-hidden">
            ${(['crop', 'fit'] as const).map((m) => `<button type="button" data-mode="${m}" class="px-3 py-1.5 text-sm ${mode === m ? 'bg-navy-light font-semibold text-navy' : 'text-gray-500'}">${esc(t(m === 'crop' ? 'admin.social.crop.modeCrop' : 'admin.social.crop.modeFit'))}</button>`).join('')}
          </div>
          ${ratios.length > 1 ? `<div class="inline-flex rounded-lg border border-border overflow-hidden">
            ${ratios.map((r) => `<button type="button" data-ratio="${r.value}" class="px-3 py-1.5 text-sm ${Math.abs(r.value - ratio) < 1e-9 ? 'bg-navy-light font-semibold text-navy' : 'text-gray-500'}">${esc(r.id)}</button>`).join('')}
          </div>` : `<span class="text-sm text-gray-500">${esc(ratios[0].id)}</span>`}
        </div>
        <canvas data-stage tabindex="0" aria-label="${esc(t('admin.social.crop.stage'))}" class="block mx-auto rounded border border-border ${mode === 'crop' ? 'cursor-move touch-none' : ''} focus-visible:outline-2 focus-visible:outline-navy-mid"></canvas>
        ${mode === 'crop' ? `<label class="flex items-center gap-2 text-xs text-gray-500">${esc(t('admin.social.crop.zoom'))}
          <input data-zoom type="range" min="1" max="4" step="0.01" value="${zoomOf(rect, W, H, ratio)}" class="flex-1"></label>` : ''}
        <div class="flex justify-end gap-2">
          ${button(t('admin.social.crop.cancel'), 'data-cancel')}
          <button type="button" data-apply class="px-3 py-1.5 rounded-lg text-sm font-medium bg-navy text-white disabled:opacity-40">${esc(t('admin.social.crop.apply'))}</button>
        </div></div>`;
      wire();
      draw();
    };

    const stage = () => root.querySelector<HTMLCanvasElement>('[data-stage]')!;

    /** Fits the preview in the window: at most 480px wide and 60% of the window high. */
    const draw = () => {
      const c = stage();
      const cssW = Math.min(480, root.clientWidth - 72, window.innerHeight * 0.6 * ratio);
      const cssH = cssW / ratio;
      const dpr = window.devicePixelRatio || 1;
      c.style.width = `${cssW}px`;
      c.style.height = `${cssH}px`;
      c.width = Math.round(cssW * dpr);
      c.height = Math.round(cssH * dpr);
      paint(c, c.width, c.height);
    };

    /** Draws the result at any size: the preview and the final image share this. */
    const paint = (c: HTMLCanvasElement, cw: number, ch: number) => {
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cw, ch);
      if (mode === 'crop') {
        ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, cw, ch);
      } else {
        const f = fitFrame(W, H, ratio);
        const s = cw / f.w;
        ctx.drawImage(img, f.ox * s, f.oy * s, W * s, H * s);
      }
    };

    const wire = () => {
      root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.addEventListener('click', () => {
        mode = b.dataset.mode as 'crop' | 'fit';
        render();
      }));
      root.querySelectorAll<HTMLButtonElement>('[data-ratio]').forEach((b) => b.addEventListener('click', () => {
        ratio = Number(b.dataset.ratio);
        rect = centerCrop(W, H, ratio);
        render();
      }));
      root.querySelector<HTMLInputElement>('[data-zoom]')?.addEventListener('input', (e) => {
        rect = zoomCrop(rect, W, H, ratio, Number((e.target as HTMLInputElement).value));
        draw();
      });
      const c = stage();
      if (mode === 'crop') {
        let last: { x: number; y: number } | null = null;
        c.addEventListener('pointerdown', (e) => { last = { x: e.clientX, y: e.clientY }; c.setPointerCapture(e.pointerId); });
        c.addEventListener('pointermove', (e) => {
          if (!last) return;
          rect = panCrop(rect, e.clientX - last.x, e.clientY - last.y, c.clientWidth, W, H);
          last = { x: e.clientX, y: e.clientY };
          draw();
        });
        const end = () => { last = null; };
        c.addEventListener('pointerup', end);
        c.addEventListener('pointercancel', end);
        c.addEventListener('keydown', (e) => {
          const step = { ArrowLeft: [10, 0], ArrowRight: [-10, 0], ArrowUp: [0, 10], ArrowDown: [0, -10] }[e.key];
          if (!step) return;
          e.preventDefault();
          rect = panCrop(rect, step[0], step[1], c.clientWidth, W, H);
          draw();
        });
      }
      root.querySelector('[data-cancel]')!.addEventListener('click', () => finish(null));
      root.querySelector<HTMLButtonElement>('[data-apply]')!.addEventListener('click', (e) => {
        const b = e.currentTarget as HTMLButtonElement;
        b.disabled = true;
        b.textContent = t('admin.social.crop.applying');
        const area = mode === 'crop' ? rect : fitFrame(W, H, ratio);
        const size = outputSize(area.w, area.h);
        const out = document.createElement('canvas');
        out.width = size.w;
        out.height = size.h;
        paint(out, size.w, size.h);
        canvasToSocialJpeg(out)
          .then((blob) => finish({ blob, mode, rect: mode === 'crop' ? rect : { x: 0, y: 0, w: W, h: H } }))
          .catch((err) => { close(); reject(err); });
      });
    };

    render();
  });
}
