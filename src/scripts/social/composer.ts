/**
 * The post editor. One state object, rendered on every change. The
 * checklist calls the server's own readinessProblems, so the panel and the
 * server cannot disagree about whether a post may go out (spec §2).
 */
import { api, ApiError, type DraftBody, type MediaItem, type Plan, type Platform, type PostStatus, type PostType } from './api';
import { deps, changed } from './context';
import { errorText, problemText } from './messages';
import { esc, button, overlay, closeOverlay } from './ui';
import { AutosaveQueue } from './autosave';
import { renderPreview, bgImage, type PreviewKind } from './preview';
import { uploadSocialImage, uploadSocialBlob, SOCIAL_IMAGE_TYPES, UnsupportedImageType, type SocialUpload } from '../image-upload';
import { readinessProblems, linkOk } from '../../../functions/_lib/social-posts';
import {
  captionFor, countChars, countHashtags, ratioOk, CAPTION_LIMITS, INSTAGRAM_MAX_HASHTAGS, ENABLED_PLATFORMS, CAROUSEL_MAX_ITEMS,
} from '../../../functions/_lib/social-limits';
import { DEFAULT_TIME, dayKey, timeOf, epochAt } from '../../lib/social-calendar';
import { nearestRatio } from '../../lib/image-crop';
import { openCropper, sameOrigin, type CropResult, type CropStart } from './cropper';

export interface ComposerState {
  id: string | null;
  revision: number;
  status: PostStatus;
  planId: string | null;
  planTitle: string | null;
  type: PostType;
  platforms: Platform[];
  media: MediaItem[];
  caption: string;
  overrides: Partial<Record<Platform, string>>;
  link: string;
  date: string;
  time: string;
}

const LOCKED: PostStatus[] = ['published', 'partially_published', 'cancelled'];
const OVERRIDE_ORDER: Platform[] = ['instagram', 'linkedin'];

/** Pure: what the API receives. Overrides in a fixed order and only when written, so autosave logs no phantom changes. */
export function toDraftBody(s: ComposerState, creating = false): DraftBody {
  const captionOverrides: Partial<Record<Platform, string>> = {};
  for (const p of OVERRIDE_ORDER) {
    const v = s.overrides[p];
    if (v !== undefined && v.trim() !== '') captionOverrides[p] = v;
  }
  const body: DraftBody = {
    type: s.type,
    caption: s.caption,
    captionOverrides,
    link: s.link.trim() || null,
    media: s.media.map((m) => (m.source ? { key: m.key, alt: m.alt.trim(), source: m.source } : { key: m.key, alt: m.alt.trim() })),
    platforms: s.platforms,
    scheduledAt: s.date ? epochAt(s.date, s.time || DEFAULT_TIME) : null,
  };
  if (creating && s.planId) body.planId = s.planId;
  return body;
}

let state: ComposerState;
let editable = true;
let capTab: 'shared' | Platform = 'shared';
let previewKind: PreviewKind = 'instagram';
let dirty = false;
let autosave: AutosaveQueue | null = null;
let savedAt = '';
let stopped = false;
let lastSaveError: unknown = null;
/** True while an explicit save or submit runs; Save and Submit are disabled and a second click is ignored. */
let busy = false;

/** Existing media carry no size; measure them in the browser for the preview checklist (the server re-checks). */
function measure(m: MediaItem): Promise<void> {
  if (m.width && m.height) return Promise.resolve();
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { m.width = img.naturalWidth; m.height = img.naturalHeight; resolve(); };
    img.onerror = () => resolve();
    img.src = m.url;
  });
}

export async function openComposer(opts: { postId?: string; plan?: Plan; date?: string }): Promise<void> {
  const { me, showToast } = deps();
  stopped = false;
  lastSaveError = null;
  busy = false;
  dirty = false;
  savedAt = '';
  capTab = 'shared';
  previewKind = 'instagram';
  autosave?.stop();
  autosave = null;
  if (opts.postId) {
    let post;
    try { post = await api.post(opts.postId); } catch (err) { showToast(errorText(err), true); return; }
    state = {
      id: post.id, revision: post.revision, status: post.status, planId: post.planId, planTitle: post.planTitle, type: post.type,
      platforms: post.platforms, media: post.media, caption: post.caption, overrides: { ...post.captionOverrides },
      link: post.link ?? '', date: post.scheduledAt ? dayKey(post.scheduledAt) : '', time: post.scheduledAt ? timeOf(post.scheduledAt) : DEFAULT_TIME,
    };
    editable = !LOCKED.includes(post.status) && (me.isPublisher || post.createdBy === me.id);
    await Promise.all(state.media.map(measure));
  } else {
    const p = opts.plan;
    state = {
      id: null, revision: 0, status: 'draft', planId: p?.id ?? null, planTitle: p?.title ?? null,
      // The API does not copy the plan's type into a new draft; the composer sends it.
      type: p?.postType ?? 'image', platforms: p?.platforms ?? ['instagram'], media: [], caption: '', overrides: {}, link: '',
      date: p ? dayKey(p.scheduledAt) : opts.date ?? '', time: p ? timeOf(p.scheduledAt) : DEFAULT_TIME,
    };
    editable = true;
  }
  if (editable && state.status === 'draft') autosave = new AutosaveQueue(saveDraft, 3000);
  overlay().classList.remove('hidden');
  render();
}

/** Create on first save, PATCH afterwards; always take the new revision. */
async function saveDraft(): Promise<void> {
  try {
    if (!state.id) {
      // A new draft with nothing in it is not worth a post.
      if (!state.media.length && !state.caption.trim() && !state.link.trim() && !state.date) { dirty = false; return; }
      const r = await api.createPost(toDraftBody(state, true));
      state.id = r.id;
      state.revision = r.revision;
    } else {
      const r = await api.updatePost(state.id, { ...toDraftBody(state), revision: state.revision });
      state.revision = r.revision;
      state.status = r.status;
    }
    dirty = false;
    lastSaveError = null;
    savedAt = timeOf(Math.floor(Date.now() / 1000));
    renderStatusLine();
  } catch (err) {
    if (err instanceof ApiError && !state.id && state.planId && (err.code === 'plan_taken' || err.code === 'invalid_plan')) {
      // Someone filled the slot first, or it was deleted: keep the work as a plain draft.
      deps().showToast(deps().t('admin.social.composer.planTakenNow'), true);
      state.planId = null;
      state.planTitle = null;
      overlay().querySelector('[data-plan]')?.remove();
      return saveDraft();
    }
    // Only a revision clash is final; anything else (network, 5xx) is remembered and reported honestly.
    lastSaveError = err;
    if (err instanceof ApiError && err.code === 'post_changed') stopped = true;
    renderStatusLine();
    renderActions();
    throw err;
  }
}

/** A link being typed is not saved half-way: the server would refuse it. */
const linkValid = () => !state.link.trim() || linkOk(state.link.trim());

/**
 * Every edit asks for a save through here. A queue that died on a refused or
 * dropped request is replaced, so one bad save does not end autosave; only a
 * revision clash (stopped) does.
 */
function queueSave(): void {
  dirty = true;
  if (!linkValid()) return;
  if (autosave && autosave.stopped && !stopped) autosave = new AutosaveQueue(saveDraft, 3000);
  autosave?.touch();
}

function touch(): void {
  queueSave();
  renderChecks();
  renderPreviewPane();
}

function problems() {
  const dims = new Map(state.media.filter((m) => m.width && m.height).map((m) => [m.key, { width: m.width!, height: m.height! }]));
  return readinessProblems(toDraftBody(state), dims, Math.floor(Date.now() / 1000));
}

function render(): void {
  const { t, tf, me } = deps();
  const title = !editable ? 'admin.social.composer.viewTitle' : state.id ? 'admin.social.composer.editTitle' : 'admin.social.composer.newTitle';
  const dis = editable ? '' : 'disabled';
  const field = 'mt-1 w-full px-3 py-2 rounded-xl border border-border text-sm text-navy';
  const warn = editable && state.status === 'scheduled' && !me.isPublisher
    ? `<p class="mb-3 p-2 rounded-lg bg-amber-50 text-amber-900 text-sm">${esc(t('admin.social.composer.backToApproval'))}</p>` : '';
  overlay().innerHTML = `<div class="max-w-6xl mx-auto my-6 bg-white rounded-2xl border border-border p-5">
    <div class="flex justify-between items-start gap-3 mb-3">
      <div><h3 class="text-lg font-semibold text-navy">${esc(t(title))}</h3>
        ${state.planTitle ? `<p data-plan class="text-sm text-gray-500">${esc(tf('admin.social.composer.fromPlan', { title: state.planTitle }))}</p>` : ''}</div>
      ${button(t('admin.social.composer.close'), 'data-close')}
    </div>
    ${warn}
    <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-5">
      <div class="space-y-4">
        <div><p class="text-xs font-semibold text-navy">${esc(t('admin.social.composer.type'))}</p>
          <div class="inline-flex mt-1 rounded-lg border border-border overflow-hidden">
            ${(['image', 'carousel', 'story'] as const).map((x) => `<button type="button" data-type="${x}" ${dis} class="px-3 py-1.5 text-sm ${state.type === x ? 'bg-navy-light font-semibold text-navy' : 'text-gray-500'}">${esc(t(`admin.social.type.${x}`))}</button>`).join('')}
          </div></div>
        <div><p class="text-xs font-semibold text-navy">${esc(t('admin.social.composer.platforms'))}</p>
          <div class="flex flex-wrap gap-4 mt-1 text-sm">
            ${ENABLED_PLATFORMS.map((p) => `<label><input type="checkbox" data-platform="${p}" ${dis} ${state.platforms.includes(p) ? 'checked' : ''}> ${esc(t(`admin.connections.platform.${p}`))}</label>`).join('')}
            <label class="text-gray-500"><input type="checkbox" disabled> ${esc(t('admin.social.composer.xLater'))}</label>
          </div></div>
        <div><p class="text-xs font-semibold text-navy">${esc(t('admin.social.composer.images'))} <span class="font-normal text-gray-500">${esc(t('admin.social.composer.imagesHint'))}</span></p>
          <div data-media class="flex flex-wrap gap-3 mt-2"></div></div>
        <div data-caption></div>
        <label class="block text-xs font-semibold text-navy">${esc(t('admin.social.composer.link'))}
          <input data-link type="url" ${dis} class="${field}" value="${esc(state.link)}" placeholder="https://"></label>
        <p data-link-error class="hidden text-xs text-red -mt-2">${esc(t('admin.social.error.invalid_link'))}</p>
        <p class="text-xs text-gray-500 -mt-2">${esc(t('admin.social.composer.linkHint'))}</p>
        <div><p class="text-xs font-semibold text-navy">${esc(t('admin.social.composer.when'))} <span class="font-normal text-gray-500">${esc(t('admin.social.composer.timeHint'))}</span></p>
          <div class="flex gap-2 mt-1"><input data-date type="date" ${dis} class="px-3 py-2 rounded-xl border border-border text-sm" value="${esc(state.date)}">
            <input data-time type="time" ${dis} class="px-3 py-2 rounded-xl border border-border text-sm" value="${esc(state.time)}"></div></div>
        <div data-checks class="border-t border-border pt-3"></div>
        <div data-actions class="flex flex-wrap gap-2 items-center"></div>
      </div>
      <div class="lg:sticky lg:top-4 self-start">
        <p class="text-xs font-semibold text-navy mb-2">${esc(t('admin.social.composer.preview'))}</p>
        <div class="flex gap-1 mb-2">${(['instagram', 'story', 'linkedin'] as const).map((k) => `<button type="button" data-pv="${k}" class="flex-1 px-2 py-1 rounded-lg border text-xs ${previewKind === k ? 'border-navy text-navy font-semibold' : 'border-border text-gray-500'}">${esc(t(`admin.social.composer.preview${k === 'instagram' ? 'Instagram' : k === 'story' ? 'Story' : 'Linkedin'}`))}</button>`).join('')}</div>
        <div data-preview></div>
      </div>
    </div></div>`;
  wireForm();
  renderLinkError();
  renderMedia();
  renderCaption();
  renderChecks();
  renderPreviewPane();
  renderActions();
}

function wireForm(): void {
  const o = overlay();
  const { t } = deps();
  o.querySelector('[data-close]')!.addEventListener('click', (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    const arm = () => { b.dataset.armed = '1'; b.textContent = t('admin.social.composer.closeConfirm'); };
    if (b.dataset.armed === '1') { autosave?.stop(); closeOverlay(); changed(); return; }
    if (dirty && !autosave && editable) { arm(); return; }
    void (async () => {
      await autosave?.flush();
      // Edits the queue could not save: say so and ask again instead of closing on them silently.
      if (editable && dirty && (autosave?.stopped || lastSaveError !== null || !linkValid())) {
        deps().showToast(stopped ? t('admin.social.composer.autosaveStopped')
          : !linkValid() ? t('admin.social.error.invalid_link') : errorText(lastSaveError), true);
        arm();
        return;
      }
      autosave?.stop(); closeOverlay(); changed();
    })();
  });
  // Preview tabs work in the read-only view too.
  o.querySelectorAll<HTMLButtonElement>('[data-pv]').forEach((b) => b.addEventListener('click', () => { previewKind = b.dataset.pv as PreviewKind; render(); }));
  if (!editable) return;
  o.querySelectorAll<HTMLButtonElement>('[data-type]').forEach((b) => b.addEventListener('click', () => {
    state.type = b.dataset.type as PostType;
    if (state.type === 'story') state.platforms = ['instagram'];
    queueSave(); render();
  }));
  o.querySelectorAll<HTMLInputElement>('[data-platform]').forEach((c) => c.addEventListener('change', () => {
    const p = c.dataset.platform as Platform;
    state.platforms = c.checked ? [...new Set([...state.platforms, p])] : state.platforms.filter((x) => x !== p);
    touch();
  }));
  o.querySelector<HTMLInputElement>('[data-link]')!.addEventListener('input', (e) => {
    state.link = (e.target as HTMLInputElement).value;
    renderLinkError();
    touch();
  });
  o.querySelector<HTMLInputElement>('[data-date]')!.addEventListener('input', (e) => { state.date = (e.target as HTMLInputElement).value; touch(); });
  o.querySelector<HTMLInputElement>('[data-time]')!.addEventListener('input', (e) => { state.time = (e.target as HTMLInputElement).value; touch(); });
}

function renderLinkError(): void {
  overlay().querySelector('[data-link-error]')?.classList.toggle('hidden', linkValid());
}

/** Opens the cropper on an uploaded image and uploads the result. Null when the person cancels. */
async function cropAndUpload(src: string, type: PostType, start?: CropStart): Promise<{ result: CropResult; up: SocialUpload } | null> {
  const result = await openCropper({ src: sameOrigin(src), type, start });
  if (!result) return null;
  return { result, up: await uploadSocialBlob(result.blob) };
}

function renderMedia(): void {
  const { t, tf, showToast } = deps();
  const box = overlay().querySelector<HTMLElement>('[data-media]')!;
  const dis = editable ? '' : 'disabled';
  box.innerHTML = state.media.map((m, i) => `<div class="w-40 border border-border rounded-lg p-1.5 text-xs">
      <div class="h-32 rounded bg-gray-200 bg-center bg-cover" style="${bgImage(m.url)}"></div>
      <p class="text-gray-500 mt-1">${m.width && m.height ? `${m.width}x${m.height}` : ''}</p>
      <textarea data-alt="${i}" ${dis} rows="3" maxlength="1000" class="w-full mt-1 px-1.5 py-1 rounded border ${m.alt.trim() ? 'border-border' : 'border-red bg-red-tint'}" placeholder="${esc(t('admin.social.composer.alt'))}">${esc(m.alt)}</textarea>
      ${editable ? `<div class="flex gap-1 mt-1">
        <button type="button" data-up="${i}" aria-label="${esc(t('admin.social.composer.moveUp'))}" class="px-1.5 border rounded">‹</button>
        <button type="button" data-down="${i}" aria-label="${esc(t('admin.social.composer.moveDown'))}" class="px-1.5 border rounded">›</button>
        <button type="button" data-crop="${i}" class="px-1.5 border rounded ${m.width && m.height && !ratioOk(state.type, m.width, m.height) ? 'border-red text-red font-semibold' : ''}">${esc(t('admin.social.crop.edit'))}</button>
        <button type="button" data-remove="${i}" class="ml-auto px-1.5 border rounded text-red">${esc(t('admin.social.composer.remove'))}</button></div>` : ''}
    </div>`).join('')
    + (editable && state.media.length < CAROUSEL_MAX_ITEMS
      ? `<label class="w-40 min-h-40 border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center text-xs text-gray-500 cursor-pointer text-center p-2">
          <span data-upload-label>${esc(t('admin.social.composer.addImages'))}</span><input data-files type="file" accept="${SOCIAL_IMAGE_TYPES.join(',')}" ${state.type === 'carousel' ? 'multiple' : ''} class="sr-only"></label>` : '');
  if (!editable) return;
  box.querySelectorAll<HTMLTextAreaElement>('[data-alt]').forEach((a) => a.addEventListener('input', () => {
    state.media[Number(a.dataset.alt)].alt = a.value;
    a.classList.toggle('border-red', !a.value.trim()); a.classList.toggle('bg-red-tint', !a.value.trim());
    touch();
  }));
  const move = (i: number, d: number) => {
    const j = i + d; if (j < 0 || j >= state.media.length) return;
    [state.media[i], state.media[j]] = [state.media[j], state.media[i]];
    queueSave(); renderMedia(); renderChecks(); renderPreviewPane();
  };
  box.querySelectorAll<HTMLButtonElement>('[data-up]').forEach((b) => b.addEventListener('click', () => move(Number(b.dataset.up), -1)));
  box.querySelectorAll<HTMLButtonElement>('[data-down]').forEach((b) => b.addEventListener('click', () => move(Number(b.dataset.down), 1)));
  box.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach((b) => b.addEventListener('click', () => {
    state.media.splice(Number(b.dataset.remove), 1); queueSave(); renderMedia(); renderChecks(); renderPreviewPane();
  }));
  box.querySelectorAll<HTMLButtonElement>('[data-crop]').forEach((b) => b.addEventListener('click', () => {
    const i = Number(b.dataset.crop);
    const m = state.media[i];
    const s = state;
    // Always start from the original, so a tighter crop can be undone.
    const start: CropStart | undefined = m.source && m.width && m.height
      ? { mode: m.source.mode, rect: { x: m.source.x, y: m.source.y, w: m.source.w, h: m.source.h }, ratio: nearestRatio(m.width, m.height, s.type).value }
      : undefined;
    void (async () => {
      try {
        const done = await cropAndUpload(m.sourceUrl ?? m.url, s.type, start);
        if (!done || state !== s || s.media[i] !== m) return;
        const { result, up } = done;
        s.media[i] = {
          key: up.key, url: up.url, alt: m.alt, width: up.width, height: up.height,
          source: { key: m.source?.key ?? m.key, mode: result.mode, ...result.rect }, sourceUrl: m.sourceUrl ?? m.url,
        };
        queueSave(); renderMedia(); renderChecks(); renderPreviewPane();
      } catch (err) {
        showToast(tf('admin.social.crop.failed', { detail: err instanceof Error ? err.message : '' }), true);
      }
    })();
  }));
  box.querySelector<HTMLInputElement>('[data-files]')?.addEventListener('change', (e) => {
    const files = [...((e.target as HTMLInputElement).files ?? [])].slice(0, CAROUSEL_MAX_ITEMS - state.media.length);
    const label = box.querySelector<HTMLElement>('[data-upload-label]');
    if (label) label.textContent = t('admin.social.composer.uploading');
    const s = state;
    void (async () => {
      for (const file of files) {
        try {
          const up = await uploadSocialImage(file);
          const original: MediaItem = { key: up.key, url: up.url, alt: '', width: up.width, height: up.height };
          // The original goes in first, so a cancelled or failed crop still keeps the upload (to crop later).
          s.media.push(original);
          if (!ratioOk(s.type, up.width, up.height)) {
            const done = await cropAndUpload(up.url, s.type);
            const at = s.media.indexOf(original);
            if (done && at !== -1) {
              s.media[at] = {
                key: done.up.key, url: done.up.url, alt: original.alt, width: done.up.width, height: done.up.height,
                source: { key: up.key, mode: done.result.mode, ...done.result.rect }, sourceUrl: up.url,
              };
            }
          }
        } catch (err) {
          showToast(err instanceof UnsupportedImageType
            ? tf('admin.social.composer.wrongType', { name: file.name })
            : tf('admin.social.composer.uploadFailed', { detail: err instanceof Error ? err.message : '' }), true);
        }
      }
      // The composer may have re-rendered during the upload; the render functions re-query the current DOM.
      if (state !== s) return;
      queueSave(); renderMedia(); renderChecks(); renderPreviewPane();
    })();
  });
}

function renderCaption(): void {
  const { t, tf } = deps();
  const box = overlay().querySelector<HTMLElement>('[data-caption]')!;
  const dis = editable ? '' : 'disabled';
  if (state.type === 'story') {
    box.innerHTML = `<p class="text-xs text-gray-500">${esc(t('admin.social.composer.storyNoCaption'))}</p>`;
    return;
  }
  const tabs: ('shared' | Platform)[] = ['shared', ...state.platforms.filter((p) => ENABLED_PLATFORMS.includes(p))];
  if (!tabs.includes(capTab)) capTab = 'shared';
  const value = capTab === 'shared' ? state.caption : state.overrides[capTab] ?? '';
  box.innerHTML = `<p class="text-xs font-semibold text-navy">${esc(t('admin.social.composer.caption'))}</p>
    <div class="flex gap-1 mt-1 border-b border-border">${tabs.map((k) => `<button type="button" data-cap="${k}" class="px-2 py-1 text-xs ${capTab === k ? 'border-b-2 border-red text-navy font-semibold' : 'text-gray-500'}">${esc(k === 'shared' ? t('admin.social.composer.captionShared') : tf('admin.social.composer.captionFor', { platform: t(`admin.connections.platform.${k}`) }))}</button>`).join('')}</div>
    <textarea data-captext ${dis} rows="7" class="w-full px-3 py-2 border border-border border-t-0 rounded-b-xl text-sm" placeholder="${esc(capTab === 'shared' ? '' : t('admin.social.composer.overrideHint'))}">${esc(value)}</textarea>
    <div data-counts class="flex flex-wrap gap-4 mt-1 text-xs text-gray-500"></div>`;
  box.querySelectorAll<HTMLButtonElement>('[data-cap]').forEach((b) => b.addEventListener('click', () => { capTab = b.dataset.cap as 'shared' | Platform; renderCaption(); }));
  box.querySelector<HTMLTextAreaElement>('[data-captext]')!.addEventListener('input', (e) => {
    const v = (e.target as HTMLTextAreaElement).value;
    if (capTab === 'shared') state.caption = v; else state.overrides[capTab] = v;
    renderCounts();
    touch();
  });
  renderCounts();
}

function renderCounts(): void {
  const { t, tf } = deps();
  const box = overlay().querySelector<HTMLElement>('[data-counts]');
  if (!box) return;
  const src = { caption: state.caption, captionOverrides: state.overrides, link: state.link.trim() || null };
  box.innerHTML = state.platforms.filter((p) => ENABLED_PLATFORMS.includes(p)).map((p) => {
    const text = captionFor(src, p);
    const chars = countChars(text);
    const over = chars > CAPTION_LIMITS[p];
    const tags = p === 'instagram' ? countHashtags(text) : 0;
    return `<span class="${over ? 'text-red font-semibold' : ''}">${esc(tf('admin.social.composer.count', { platform: t(`admin.connections.platform.${p}`), chars, limit: CAPTION_LIMITS[p] }))}</span>`
      + (p === 'instagram' ? `<span class="${tags > INSTAGRAM_MAX_HASHTAGS ? 'text-red font-semibold' : ''}">${esc(tf('admin.social.composer.hashtags', { count: tags, limit: INSTAGRAM_MAX_HASHTAGS }))}</span>` : '');
  }).join('');
}

function renderChecks(): void {
  const { t } = deps();
  const box = overlay().querySelector<HTMLElement>('[data-checks]');
  if (!box) return;
  const list = problems();
  box.innerHTML = `<p class="text-xs font-semibold text-navy mb-1">${esc(t('admin.social.composer.checklist'))}</p>` + (list.length
    ? `<ul class="text-sm text-red space-y-0.5">${list.map((p) => `<li>✕ ${esc(problemText(p))}</li>`).join('')}</ul>`
    : `<p class="text-sm text-green-700">✓ ${esc(t('admin.social.composer.ready'))}</p>`);
  renderActions();
}

function renderPreviewPane(): void {
  const box = overlay().querySelector<HTMLElement>('[data-preview]');
  if (box) box.innerHTML = renderPreview(state, previewKind);
}

function renderStatusLine(): void {
  const { t, tf } = deps();
  const line = overlay().querySelector<HTMLElement>('[data-saved]');
  if (!line) return;
  const failed = !stopped && lastSaveError !== null;
  line.textContent = stopped ? t('admin.social.composer.autosaveStopped')
    : failed ? errorText(lastSaveError)
    : savedAt ? tf('admin.social.composer.autosaved', { time: savedAt }) : '';
  line.classList.toggle('text-red', stopped || failed);
}

function renderActions(): void {
  const { t, me } = deps();
  const box = overlay().querySelector<HTMLElement>('[data-actions]');
  if (!box) return;
  if (!editable) { box.innerHTML = ''; return; }
  const ready = problems().length === 0;
  const isDraftish = state.status === 'draft' || state.status === 'rejected';
  box.innerHTML = (isDraftish
    ? button(t('admin.social.composer.saveDraft'), `data-save ${stopped || busy ? 'disabled' : ''}`)
      + `<button type="button" data-submit ${ready && !stopped && !busy ? '' : 'disabled'} class="px-3 py-1.5 rounded-lg text-sm font-medium bg-navy text-white disabled:opacity-40">${esc(t(me.isPublisher ? 'admin.social.action.schedule' : 'admin.social.action.submit'))}</button>`
    : `<button type="button" data-save ${stopped || busy ? 'disabled' : ''} class="px-3 py-1.5 rounded-lg text-sm font-medium bg-navy text-white disabled:opacity-40">${esc(t('admin.social.composer.save'))}</button>`)
    + `<span data-saved class="text-xs text-gray-500"></span>`;
  renderStatusLine();
  box.querySelector('[data-save]')?.addEventListener('click', () => void saveExplicit());
  box.querySelector('[data-submit]')?.addEventListener('click', () => void submit());
}

/**
 * Bring the server up to date with the form. Drafts go through the autosave
 * queue (one save in flight). A queue that died on a transient error is
 * replaced with a fresh one, so one dropped request does not end saving.
 */
async function persist(force: boolean): Promise<void> {
  if (!linkValid()) throw new ApiError(400, 'invalid_link');
  if (autosave && autosave.stopped && !stopped) {
    autosave = new AutosaveQueue(saveDraft, 3000);
  }
  if (autosave) {
    autosave.touch();
    await autosave.flush();
    if (autosave.stopped) throw lastSaveError ?? new ApiError(409, 'post_changed');
    return;
  }
  if (force || dirty || !state.id) await saveDraft();
}

const STALE = ['post_changed', 'not_found', 'not_pending', 'plan_has_post'];
/** After a stale-state error the form stays open (the person may want to copy their text) but cannot save again. */
function noteStale(err: unknown): void {
  if (err instanceof ApiError && STALE.includes(err.code)) {
    stopped = true;
    autosave?.stop();
    renderStatusLine();
    renderActions();
  }
}

function setBusy(v: boolean): void { busy = v; renderActions(); }

async function saveExplicit(): Promise<void> {
  if (busy) return;
  const { t, showToast } = deps();
  setBusy(true);
  try {
    await persist(true);
    showToast(t('admin.social.done.saved'));
    if (state.status !== 'draft') { closeOverlay(); changed(); }
  } catch (err) {
    noteStale(err);
    showToast(errorText(err), true);
  } finally {
    setBusy(false);
  }
}

async function submit(): Promise<void> {
  if (busy) return;
  const { t, showToast } = deps();
  setBusy(true);
  try {
    await persist(false);
    const r = await api.action(state.id!, 'submit', { revision: state.revision });
    autosave?.stop();
    showToast(t(r.status === 'scheduled' ? 'admin.social.done.scheduled' : 'admin.social.done.submitted'));
    closeOverlay();
    changed();
  } catch (err) {
    if (err instanceof ApiError && err.code === 'not_ready') {
      showToast(err.problems.map(problemText).join(' ') || errorText(err), true);
      return;
    }
    noteStale(err);
    showToast(errorText(err), true);
  } finally {
    setBusy(false);
  }
}
