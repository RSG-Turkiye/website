/**
 * The Etkinlikler section: published events, workshops and webinars, the
 * drafts that change them, and the approval queue. Every change is a draft
 * (functions/api/cms); an approved draft becomes a pull request that the PR
 * shepherd merges, and the site shows it a few minutes later. Nothing here
 * writes to the site directly.
 *
 * Addresses: `#icerik-etkinlikler/<type>` lists a type, `/<type>/<id>` opens
 * a published entry (`_new` for a new one), `/taslaklar/<draft>` a draft
 * (the link a pull request's body carries), `/onay/<draft>` the approver's
 * view of one.
 *
 * Not losing work: one form, filled per entry, with guardUnsaved for leaving
 * it; an autosave 20 s after the last edit, one save at a time; and a copy in
 * this browser's storage until a save lands, so a closed tab or an expired
 * session costs nothing. Nothing is stored on the server until the first
 * save: opening an entry only reads it.
 */
import { escapeHtml } from '../../escape-html';
import { renderBody } from '../../../../functions/_lib/markdown';
import { uploadImage } from '../../image-upload';
import { AutosaveQueue } from '../../social/autosave';
import { BTN, armConfirm, chip, emptyState, guardUnsaved, row, revealInPanel } from '../ui-kit';
import { dateLocale, lang, t, tf } from '../context';
import { refreshCounts, noteAddress } from '../shell';
import {
  MODELS, TYPE_KEYS, applyValues, emptyData, errorKey, formValues, halfTranslated, livePath, messageKey, modelFor, modelForSub,
  placeOf, previewHtml, same, statusView, suggestedId, visibleFields, withId,
  backupChoice, backupStorageKey, offeredKey, othersBackupKeys, parseBackup, sameData, uploadErrorKey,
  type Backup, type DraftSummary, type FieldDef, type ImageObject, type StatusView, type TypeKey, type TypeModel, type Values,
} from '../cms-form';
import { diffEntry } from '../cms-diff';
import { readField, readValues, renderAll, renderDiff, renderField, show } from '../cms-render';

const SECTION = '#icerik-etkinlikler';
const PAGE = 20;
const AUTOSAVE_MS = 20_000;
const tk = (k: string, vars?: Record<string, string | number>) => (vars ? tf(k as never, vars) : t(k as never)) as string;
const esc = (v: unknown) => escapeHtml(String(v ?? ''));
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;

// ── The API ──────────────────────────────────────────────────────────────────

interface Entry { id: string; title: string; date?: string; paths?: { en: string | null; tr: string | null }; shas?: Record<string, string> }
interface Draft extends DraftSummary {
  pr_url: string | null; created_at: number; write_nonce?: string | null;
  data?: unknown; base_shas?: Record<string, string | null>;
}
type Answer<T> = { ok: true; status: number; body: T } | { ok: false; status: number; code: string; body: Record<string, any> };

async function api<T = Record<string, any>>(method: string, path: string, body?: unknown): Promise<Answer<T>> {
  let res: Response;
  try {
    res = await fetch(path, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    return { ok: false, status: 0, code: 'network', body: {} };
  }
  const json = await res.json().catch(() => ({})) as Record<string, any>;
  if (res.ok) return { ok: true, status: res.status, body: json as T };
  return { ok: false, status: res.status, code: res.status === 401 ? 'unauthenticated' : String(json.code ?? 'unknown'), body: json };
}

// ── State ────────────────────────────────────────────────────────────────────

let approver = false;
/** The signed-in person: backups in this browser are theirs only. */
let userId = '';
/** Why the last list load failed (an API code), for the message in its place. */
let loadError: string | null = null;
let queueMore = false;
const entries: Partial<Record<TypeKey, Entry[]>> = {};
const shown: Partial<Record<TypeKey, number>> = {};
let lists: { mine: Draft[]; queue: Draft[]; live: { type: string; entry_id: string; status: string }[] } | null = null;

interface Editor {
  model: TypeModel;
  route: string;
  /** The draft, once one exists on the server. */
  draft: Draft | null;
  /** The published entry an update starts from, and the shas it was read at. */
  entryId: string | null;
  baseShas: Record<string, string | null> | null;
  /** What the form writes onto: the data it was opened with, then each save's. */
  base: unknown;
  readOnly: boolean;
  backupKey: string;
  edits: number;
  uploads: Set<Promise<void>>;
  autosave: AutosaveQueue | null;
  /** The entry as the site has it now, when it changed since the draft began. */
  fresh: { data: unknown; base_shas: Record<string, string | null> } | null;
  halfOk: boolean;
  /** Saved elsewhere since this was loaded: no more saves from here until reloaded. */
  conflict: boolean;
  /** The "session ended" notice is already up. */
  signedOutShown: boolean;
  /** What the last save sent when its answer never came (it may have landed). */
  lostSave: { data: unknown } | null;
}
let editor: Editor | null = null;
let guard: { reset(): void } | null = null;
/** What happened, shown once the draft it is about has opened. */
let pendingNotice: { html: string; tone: 'info' | 'warn' | 'error' } | null = null;

const now = () => Math.floor(Date.now() / 1000);
const sv = (d: DraftSummary): StatusView => statusView(d, { approver, now: now() });

// ── Setup and routing ────────────────────────────────────────────────────────

const PHONE = typeof matchMedia === 'function' ? matchMedia('(max-width: 1023px)') : null;

/**
 * On a phone the action bars stick to the bottom of the window, where the
 * podcast bar sits when it is shown: lift them above it. From lg up they
 * stick inside the section's own scroll box and need nothing.
 */
function liftBars(): void {
  const strip = document.getElementById('podcastStrip');
  const h = PHONE?.matches && strip && !strip.hidden ? strip.offsetHeight : 0;
  document.querySelectorAll<HTMLElement>('[data-cms-sticky]').forEach((b) => { b.style.bottom = h ? `${h}px` : ''; });
}

export function setupCms(opts: { approver: boolean; userId: string }): void {
  approver = opts.approver;
  userId = opts.userId;
  pruneBackups();
  PHONE?.addEventListener('change', liftBars);
  const strip = document.getElementById('podcastStrip');
  if (strip) new MutationObserver(liftBars).observe(strip, { attributes: true, attributeFilter: ['hidden'] });
  const form = $<HTMLFormElement>('cmsForm');
  if (!form || guard) return;
  // exact: any move away from the form's own address asks first, within the
  // section too (Geri, a type tab, Taslaklarım).
  guard = guardUnsaved(form, SECTION, () => {
    // Leaving discards: the copy in this browser goes too.
    if (editor) dropBackups(editor.backupKey);
    closeEditor();
  }, { exact: true });
  form.addEventListener('submit', (e) => e.preventDefault());
  form.addEventListener('input', onInput);
  form.addEventListener('change', (e) => {
    const file = (e.target as HTMLElement).closest<HTMLInputElement>('input[data-image-file]');
    if (file) void onImageFile(file);
  });
  form.addEventListener('click', onFormClick);
}

/** The shell calls this for every address in the section. Idempotent for the editor already open. */
export function showCms(sub: string, item: string | null): void {
  const hash = `${SECTION}/${sub}${item ? `/${item}` : ''}`;
  if (editor && editor.route === hash) return;
  closeEditor();
  const model = modelForSub(sub);
  if (model && !item) void showList(model);
  else if (model && item) void openEntry(model, item === '_new' ? null : item, hash);
  else if (sub === 'taslaklar' && !item) void showDrafts();
  else if (sub === 'taslaklar' && item) void openDraft(item, hash);
  else if (sub === 'onay' && !item) void showQueue();
  else if (sub === 'onay' && item) void openReview(item, hash);
}

function subHost(sub: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-section="icerik-etkinlikler"] [data-sub="${sub}"]`);
}

/** Shows the list part of a sub-page and hides the editor. */
function listHost(sub: string): HTMLElement | null {
  const host = subHost(sub);
  const body = host?.querySelector<HTMLElement>('[data-cms-body]') ?? null;
  body?.classList.remove('hidden');
  $('cmsEditor')?.classList.add('hidden');
  return body;
}

/**
 * Moves the editor into the sub-page on screen (or `sub`) and shows it. The
 * sub-page on screen, because a first save moves the address to the new
 * draft's without the shell showing another sub-page.
 */
function editorHost(sub: string): void {
  const host = document.querySelector<HTMLElement>('[data-section="icerik-etkinlikler"] [data-sub]:not(.hidden)') ?? subHost(sub);
  const ed = $('cmsEditor');
  if (!host || !ed) return;
  host.querySelector('[data-cms-body]')?.classList.add('hidden');
  if (ed.parentElement !== host) host.appendChild(ed);
  ed.classList.remove('hidden');
}

function closeEditor(): void {
  if (!editor) return;
  editor.autosave?.stop();
  editor = null;
  guard?.reset();
  $('cmsEditor')?.classList.add('hidden');
  const fields = $('cmsFields');
  if (fields) fields.innerHTML = '';
}

/** The address, without the shell showing the route again (the editor stays as it is). */
function replaceAddress(hash: string): void {
  history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
  // The shell's idea of where it is, so a refused move comes back here.
  noteAddress(hash);
  if (editor) editor.route = hash;
}

// ── Data ─────────────────────────────────────────────────────────────────────

async function loadEntries(model: TypeModel, fresh = false): Promise<Entry[] | null> {
  if (!fresh && entries[model.key]) return entries[model.key]!;
  const r = await api<{ entries: Entry[] }>('GET', `/api/cms/entries?type=${model.key}`);
  if (!r.ok) { loadError = r.code; return null; }
  entries[model.key] = r.body.entries;
  return r.body.entries;
}

async function loadLists(): Promise<typeof lists> {
  // Fresh each time: whether an entry is busy must be what it is now.
  const r = await api<{ mine: Draft[]; queue: Draft[]; more?: boolean; live?: { type: string; entry_id: string; status: string }[] }>('GET', '/api/cms/drafts');
  if (!r.ok) { loadError = r.code; lists = null; return null; }
  lists = { mine: r.body.mine ?? [], queue: r.body.queue ?? [], live: r.body.live ?? [] };
  queueMore = r.body.more === true;
  return lists;
}

/** A list that could not be loaded says so (and how to sign in), never "nothing here". */
function loadFailed(host: HTMLElement): void {
  host.innerHTML = loadError === 'unauthenticated'
    ? `<p class="text-sm text-[#8a1c1c]" data-cms-load-failed>${esc(tk('admin.cms.error.unauthenticated'))} <a href="/auth/login?next=${encodeURIComponent(location.pathname + location.hash)}" class="underline">${esc(tk('admin.cms.signIn'))}</a></p>`
    : `<p class="text-sm text-[#8a1c1c]" data-cms-load-failed>${esc(tk(loadError === 'index_unavailable' ? 'admin.cms.error.index_unavailable' : 'admin.cms.listFailed'))}</p>`;
}

/** The files of a published entry, for its live page (a webinar's Turkish name may differ). */
function entryPaths(type: string, entryId: string, fallback: Record<string, unknown> | undefined): string[] {
  const e = entries[type as TypeKey]?.find((x) => x.id === entryId);
  return e?.paths ? [e.paths.en, e.paths.tr].filter((p): p is string => !!p) : Object.keys(fallback ?? {});
}

const titleOf = (type: string, entryId: string, action?: string): string => {
  const e = entries[type as TypeKey]?.find((x) => x.id === entryId);
  return e?.title ?? (action === 'create' ? tk('admin.cms.newTitle', { id: entryId }) : entryId);
};

function dateText(model: TypeModel, d?: string): string {
  if (!d) return '';
  if (/^\d{4}$/.test(d)) return d;
  const at = new Date(`${d.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(at.getTime()) ? d : at.toLocaleDateString(dateLocale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

const clock = (ts: number) => new Date(ts * 1000).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' });
const when = (ts: number) => new Date(ts * 1000).toLocaleString(dateLocale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' });

function statusLine(d: DraftSummary): string {
  const v = sv(d);
  const vars: Record<string, string> = { ...v.vars };
  if (vars.reason) vars.reason = tk(vars.reason, { name: vars.name ?? '' });
  if (d.status === 'rejected' && !vars.note) return tk('admin.cms.status.rejectedNoNote');
  return tk(v.line, vars);
}

const statusChip = (d: DraftSummary) => { const v = sv(d); return chip(tk(v.chip), v.tone); };

// ── Lists ────────────────────────────────────────────────────────────────────

/** The compact "Taslaklarım (n)" row above every list, those that need me first. */
function myDraftsRow(): string {
  const active = (lists?.mine ?? []).filter((d) => d.status !== 'published');
  const mine = active.filter((d) => sv(d).needsMe).length;
  return `<a href="${SECTION}/taslaklar" data-cms-mine class="block mb-3">${row({
    title: tk('admin.cms.myDrafts', { n: active.length }),
    chips: mine ? chip(tk('admin.cms.forYou', { n: mine }), 'red') : '',
    trailing: '<span aria-hidden="true">›</span>',
  })}</a>`;
}

async function showList(model: TypeModel): Promise<void> {
  const host = listHost(model.sub);
  if (!host) return;
  if (!host.innerHTML.trim()) host.innerHTML = `<p class="text-sm text-gray-500">${esc(tk('admin.cms.loading'))}</p>`;
  loadError = null;
  const [list, got] = await Promise.all([loadEntries(model, true), loadLists()]);
  if (!list || !got) { loadFailed(host); return; }
  const n = shown[model.key] ?? PAGE;
  const draftFor = (id: string) => (lists?.mine ?? []).find((d) => d.type === model.key && d.entry_id === id && sv(d).editable);
  const liveFor = (id: string) => (lists?.live ?? []).find((d) => d.type === model.key && d.entry_id === id);
  const rows = list.slice(0, n).map((e) => {
    const live = liveFor(e.id);
    const mine = draftFor(e.id);
    let chips = '';
    let trailing = `<a href="${SECTION}/${model.sub}/${esc(e.id)}" data-cms-edit class="${BTN.secondary}">${esc(tk('admin.cms.edit'))}</a>`;
    if (live) {
      // Read-only: a second draft would be refused (entry_busy) until this one is done.
      chips = chip(tk(live.status === 'submitted' ? 'admin.cms.chip.submitted' : 'admin.cms.chip.goingLive'), live.status === 'submitted' ? 'amber' : 'navy');
      trailing = '';
    } else if (mine) {
      chips = statusChip(mine);
      trailing = `<a href="${SECTION}/taslaklar/${mine.id}" class="${BTN.secondary}">${esc(tk('admin.cms.continue'))}</a>`;
    }
    return row({ title: e.title, subtitle: dateText(model, e.date), chips, trailing, attrs: `data-cms-entry="${esc(e.id)}"`, stack: true });
  }).join('');
  const more = list.length > n ? `<button type="button" data-cms-more class="${BTN.secondary} mt-3">${esc(tk('admin.cms.more'))}</button>` : '';
  host.innerHTML = `${myDraftsRow()}
    <div class="flex items-center justify-between gap-3 mb-3 lg:mb-2">
      <h2 class="text-sm font-semibold text-navy">${esc(tk('admin.cms.published', { type: tk(model.label) }))}</h2>
      <a href="${SECTION}/${model.sub}/_new" data-cms-new class="${BTN.primary}">${esc(tk('admin.cms.new'))}</a>
    </div>
    <div class="flex flex-col gap-2">${rows || emptyState(tk('admin.cms.noEntries'))}</div>${more}`;
  host.querySelector('[data-cms-more]')?.addEventListener('click', () => { shown[model.key] = n + PAGE; void showList(model); });
}

function draftRow(d: Draft, href: string): string {
  const model = modelFor(d.type);
  const v = sv(d);
  const next: Record<string, string> = { continue: 'admin.cms.continue', fix: 'admin.cms.fix', retry: 'admin.cms.retry', openSite: 'admin.cms.openSite', discard: 'admin.cms.open' };
  const trailing = v.next === 'openSite'
    ? `<a href="${livePath(d.type, d.entry_id, entryPaths(d.type, d.entry_id, d.base_shas), lang)}" target="_blank" rel="noopener" data-cms-open-site class="${BTN.secondary}">${esc(tk('admin.cms.openSite'))}</a>`
    : `<a href="${href}" class="${BTN.secondary}">${esc(tk(v.next ? next[v.next] : 'admin.cms.open'))}</a>`;
  const action = d.action === 'delete' ? ` · ${tk('admin.cms.action.delete')}` : '';
  return row({
    title: titleOf(d.type, d.entry_id, d.action),
    subtitle: `${model ? tk(model.label) : d.type}${action} · ${statusLine(d)}`,
    chips: statusChip(d), trailing, attrs: `data-cms-draft="${esc(d.id)}"`, stack: true,
  });
}

async function showDrafts(): Promise<void> {
  const host = listHost('taslaklar');
  if (!host) return;
  if (!host.innerHTML.trim()) host.innerHTML = `<p class="text-sm text-gray-500">${esc(tk('admin.cms.loading'))}</p>`;
  loadError = null;
  const [got] = await Promise.all([loadLists(), ...TYPE_KEYS.map((k) => loadEntries(MODELS[k]))]);
  if (!got) { loadFailed(host); return; }
  const mine = (lists?.mine ?? []);
  const forMe = mine.filter((d) => sv(d).needsMe);
  const rest = mine.filter((d) => !sv(d).needsMe);
  const block = (title: string, items: Draft[]) => items.length
    ? `<h2 class="text-sm font-semibold text-navy mb-2">${esc(title)}</h2><div class="flex flex-col gap-2 mb-5 lg:mb-4">${items.map((d) => draftRow(d, `${SECTION}/taslaklar/${d.id}`)).join('')}</div>` : '';
  host.innerHTML = mine.length
    ? `${block(tk('admin.cms.forMeHeading'), forMe)}${block(tk('admin.cms.otherDrafts'), rest)}`
    : `<h2 class="text-sm font-semibold text-navy mb-2">${esc(tk('admin.cms.nav.drafts'))}</h2>${emptyState(tk('admin.cms.noDrafts'))}`;
}

async function showQueue(): Promise<void> {
  const host = listHost('onay');
  if (!host) return;
  if (!host.innerHTML.trim()) host.innerHTML = `<p class="text-sm text-gray-500">${esc(tk('admin.cms.loading'))}</p>`;
  loadError = null;
  const [got] = await Promise.all([loadLists(), ...TYPE_KEYS.map((k) => loadEntries(MODELS[k]))]);
  if (!got) { loadFailed(host); return; }
  const queue = lists?.queue ?? [];
  // More than the list holds: how many more, from the menu's own count.
  let more = '';
  if (queueMore) {
    const c = await api<Record<string, number>>('GET', '/api/admin/counts');
    const n = c.ok ? (c.body.cmsQueue ?? 0) - queue.length : 0;
    if (n > 0) more = `<p data-cms-queue-more class="mt-3 text-sm text-gray-600">${esc(tk('admin.cms.queueMore', { n }))}</p>`;
  }
  host.innerHTML = `${myDraftsRow()}<h2 class="text-sm font-semibold text-navy mb-2">${esc(tk('admin.cms.queueHeading'))}</h2>
    <div class="flex flex-col gap-2">${queue.map((d) => row({
      title: titleOf(d.type, d.entry_id, d.action),
      subtitle: `${tk(modelFor(d.type)?.label ?? d.type)} · ${tk(`admin.cms.action.${d.action}`)} · ${d.status === 'approved' ? statusLine(d) : tk('admin.cms.sentBy', { name: d.author_name || tk('admin.cms.anEditor'), time: when(d.updated_at) })}`,
      chips: statusChip(d), trailing: `<a href="${SECTION}/onay/${d.id}" class="${BTN.primary}">${esc(tk('admin.cms.review'))}</a>`,
      attrs: `data-cms-queue="${esc(d.id)}"`, stack: true,
    })).join('') || emptyState(tk('admin.cms.queueEmpty'))}</div>${more}`;
}

// ── The editor ───────────────────────────────────────────────────────────────

/** This person's copy, or null; anything that is not a backup is deleted. */
function backupGet(key: string): Backup | null {
  try {
    const raw = localStorage.getItem(backupStorageKey(userId, key));
    const b = parseBackup(raw);
    if (raw !== null && !b) localStorage.removeItem(backupStorageKey(userId, key));
    return b;
  } catch { return null; }
}
/** Keeps the form's data in this browser, with the version it was made on. */
function backupPut(ed: Editor, data: unknown): boolean {
  const b: Backup = { data, at: now(), updated_at: ed.draft?.updated_at ?? null, write_nonce: ed.draft?.write_nonce ?? null, base_shas: ed.draft ? (ed.draft.base_shas ?? null) : ed.baseShas };
  try { localStorage.setItem(backupStorageKey(userId, ed.backupKey), JSON.stringify(b)); return true; } catch { return false; }
}
/** The form is done with (sent, deleted, saved as a draft, left): its copy and any copy on offer go. */
function dropBackups(key: string): void {
  dropBackup(key);
  dropBackup(offeredKey(key));
}
function dropBackup(key: string): void {
  try { localStorage.removeItem(backupStorageKey(userId, key)); } catch { /* private mode: nothing stored */ }
}

/**
 * Someone else's copies (another person signed in on this browser before)
 * go, and so do this person's that are too old to trust.
 */
function pruneBackups(): void {
  try {
    const keys = Object.keys(localStorage);
    for (const k of othersBackupKeys(keys, userId)) localStorage.removeItem(k);
    for (const k of keys.filter((x) => x.startsWith(backupStorageKey(userId, '')))) {
      const b = parseBackup(localStorage.getItem(k));
      if (!b || backupChoice(b, { write_nonce: null, base_shas: null }, now()) === 'expired') localStorage.removeItem(k);
    }
  } catch { /* storage blocked: nothing kept */ }
}

function head(opts: { title: string; back: string; chipHtml?: string; line?: string; banner?: boolean }): void {
  const el = $('cmsHead');
  if (!el) return;
  el.innerHTML = `<div class="flex items-start gap-2 mb-2">
      <a href="${opts.back}" data-cms-back class="${BTN.ghost} px-2 shrink-0" aria-label="${esc(tk('admin.nav.back'))}">‹ ${esc(tk('admin.cms.back'))}</a>
      <div class="flex-1 min-w-0 pt-1.5 lg:pt-1">
        <h2 id="cmsTitle" class="text-base font-semibold text-navy [overflow-wrap:anywhere]">${esc(opts.title)}</h2>
        <div class="flex flex-wrap items-center gap-2 mt-0.5">${opts.chipHtml ?? ''}<p id="cmsStatus" class="min-w-0 text-sm text-gray-600 [overflow-wrap:anywhere]">${esc(opts.line ?? '')}</p></div>
      </div>
    </div>
    ${opts.banner ? `<p id="cmsBanner" class="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">${esc(tk('admin.cms.notLiveBanner'))}</p>` : ''}
    <div id="cmsNotice" class="hidden mb-3 rounded-xl border px-3 py-2 text-sm"></div>`;
}

/** A message above the form: info (navy), warn (amber) or error (red). Markup is trusted, built here. */
function notice(html: string | null, tone: 'info' | 'warn' | 'error' = 'error'): void {
  const el = $('cmsNotice');
  if (!el) return;
  el.className = `mb-3 rounded-xl border px-3 py-2 text-sm ${tone === 'error' ? 'border-red-200 bg-red-tint text-[#8a1c1c]' : tone === 'warn' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-border bg-navy-light text-navy'}`;
  el.classList.toggle('hidden', !html);
  el.innerHTML = html ?? '';
  if (html) revealInPanel(el);
}

function errorText(r: { code: string; body: Record<string, any> }): string {
  if (r.code === 'invalid') return tk('admin.cms.error.invalid');
  return tk(errorKey(r.code));
}

function setSaveState(text: string): void {
  const el = $('cmsSaveState');
  if (el) el.textContent = text;
}

function fieldsFor(model: TypeModel): FieldDef[] {
  return visibleFields(model, approver);
}

function renderForm(ed: Editor, values: Values): void {
  const fields = fieldsFor(ed.model);
  const main = fields.filter((f) => f.group === 'main');
  const more = fields.filter((f) => f.group === 'more');
  const draw = (f: FieldDef) => renderField(ed.model, f, values[f.key] ?? formValues(ed.model, ed.base)[f.key], { readOnly: ed.readOnly });
  const box = $('cmsFields')!;
  box.innerHTML = `
    <div id="cmsErrors" class="hidden mb-3 rounded-xl border border-red-200 bg-red-tint px-3 py-2 text-sm text-[#8a1c1c]" role="alert"></div>
    <div id="cmsBackup" class="hidden mb-3"></div>
    <div id="cmsChanged" class="hidden mb-3"></div>
    <div class="bg-white rounded-2xl border border-border p-4 lg:p-3 grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-3">
      <h3 class="lg:col-span-3 text-sm font-semibold text-navy">${esc(tk('admin.cms.group.main'))}</h3>
      ${main.map(draw).join('')}
      <p class="lg:col-span-3 text-xs text-gray-500">${esc(tk('admin.cms.fileName'))}: <span id="cmsFileName" class="font-mono text-gray-600 [overflow-wrap:anywhere]"></span></p>
    </div>
    ${more.length ? `<details id="cmsMore" class="mt-3 bg-white rounded-2xl border border-border p-4 lg:p-3">
      <summary class="cursor-pointer min-h-11 lg:min-h-8 flex items-center text-sm font-semibold text-navy">${esc(tk('admin.cms.group.more'))}</summary>
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-3 mt-3">${more.map(draw).join('')}</div></details>` : ''}`;
  renderBar(ed);
  updateFileName(ed, values);
}

function updateFileName(ed: Editor, values: Values): void {
  const el = $('cmsFileName');
  if (!el) return;
  const isNew = !ed.draft ? ed.entryId === null : ed.draft.action === 'create';
  const id = isNew ? suggestedId(ed.model, values) : (ed.draft?.entry_id ?? ed.entryId ?? '');
  el.textContent = id || tk('admin.cms.fileNameFromTitle');
  el.classList.toggle('font-mono', !!id);
}

function renderBar(ed: Editor): void {
  const bar = $('cmsBar');
  if (!bar) return;
  const status = ed.draft ? sv(ed.draft) : null;
  const menu: string[] = [];
  if (ed.draft && (status?.editable || ed.draft.status === 'submitted') && ed.draft.status !== 'merged') menu.push(`<button type="button" data-cms-discard class="${BTN.danger}">${esc(tk('admin.cms.discard'))}</button>`);
  if (approver && ed.draft?.status === 'pr_open') menu.push(`<button type="button" data-cms-cancel class="${BTN.danger}">${esc(tk('admin.cms.cancelPr'))}</button>`);
  if (approver && ed.draft && status?.next === 'discard') menu.push(`<button type="button" data-cms-discard class="${BTN.danger}">${esc(tk('admin.cms.discardMerged'))}</button>`);
  if (approver && !ed.draft && ed.entryId) menu.push(`<button type="button" data-cms-delete-entry class="${BTN.danger}">${esc(tk('admin.cms.deleteEntry'))}</button>`);
  const editable = !ed.readOnly;
  const live = ed.draft?.status === 'published'
    ? `<a href="${livePath(ed.model.key, ed.draft.entry_id, entryPaths(ed.model.key, ed.draft.entry_id, ed.draft.base_shas ?? undefined), lang)}" target="_blank" rel="noopener" data-cms-live class="${BTN.primary}">${esc(tk('admin.cms.openSite'))}</a>` : '';
  bar.innerHTML = `<div class="flex flex-wrap items-center gap-2">
      ${editable ? `<button type="button" id="cmsSave" class="${BTN.secondary}">${esc(tk('admin.cms.save'))}</button>
      <button type="button" id="cmsSubmit" class="${BTN.primary}">${esc(tk(ed.draft?.status === 'rejected' ? 'admin.cms.resubmit' : ed.draft?.status === 'pr_failed' ? 'admin.cms.retry' : 'admin.cms.submit'))}</button>` : ''}
      ${live}
      <p id="cmsSaveState" class="flex-1 min-w-0 text-xs text-gray-500" aria-live="polite"></p>
      ${menu.length ? `<details class="relative" data-cms-menu><summary class="${BTN.ghost} list-none cursor-pointer" aria-label="${esc(tk('admin.cms.more.menu'))}">…</summary>
        <div class="absolute right-0 bottom-full mb-2 z-10 flex flex-col gap-2 p-2 bg-white rounded-xl border border-border shadow-lg min-w-48">${menu.join('')}</div></details>` : ''}
    </div>`;
  wireBar(ed);
  liftBars();
}

function wireBar(ed: Editor): void {
  $('cmsSave')?.addEventListener('click', () => void saveNow());
  $('cmsSubmit')?.addEventListener('click', () => void submit());
  const bar = $('cmsBar')!;
  bar.querySelectorAll<HTMLButtonElement>('[data-cms-discard]').forEach((b) => armConfirm(b, tk('admin.cms.confirm'), () => discard(ed)));
  const cancel = bar.querySelector<HTMLButtonElement>('[data-cms-cancel]');
  if (cancel) armConfirm(cancel, tk('admin.cms.confirm'), () => cancelPr(ed));
  const del = bar.querySelector<HTMLButtonElement>('[data-cms-delete-entry]');
  if (del) armConfirm(del, tk('admin.cms.confirmDelete'), () => deleteEntry(ed));
}

function newEditor(model: TypeModel, route: string, base: unknown, extra: Partial<Editor>): Editor {
  return {
    model, route, draft: null, entryId: null, baseShas: null, base, readOnly: false, backupKey: `new:${model.key}`,
    edits: 0, uploads: new Set(), autosave: null, fresh: null, halfOk: false, conflict: false, signedOutShown: false, lostSave: null, ...extra,
  };
}

/** Fills the form, restores this browser's unsaved copy if there is one, and starts autosave. */
function start(ed: Editor): void {
  editor = ed;
  let values = formValues(ed.model, ed.base);
  // A copy offered earlier and not yet decided on is offered again, as it was.
  let toOffer = ed.readOnly ? null : backupGet(offeredKey(ed.backupKey));
  let backup = ed.readOnly ? null : backupGet(ed.backupKey);
  if (backup && same(backup.data, ed.base)) { dropBackup(ed.backupKey); backup = null; }
  const choice = backup ? backupChoice(backup, { write_nonce: ed.draft?.write_nonce ?? null, base_shas: ed.draft ? null : ed.baseShas }, now()) : null;
  if (choice === 'expired') dropBackup(ed.backupKey);
  if (choice === 'ask') {
    // Moved to a key of its own, which typing never writes, until the person
    // chooses (Karşılaştır / Sil). An older copy already on offer stays.
    if (!toOffer) {
      toOffer = backup;
      try { localStorage.setItem(backupStorageKey(userId, offeredKey(ed.backupKey)), JSON.stringify(backup)); } catch { /* not kept */ }
    }
    dropBackup(ed.backupKey);
  }
  // Restored on its own only when it cannot be older than what was saved;
  // otherwise the person compares the two and chooses.
  const restored = choice === 'restore';
  if (restored) values = formValues(ed.model, backup!.data);
  renderForm(ed, values);
  guard?.reset();
  if (!ed.readOnly) ed.autosave = autosaveFor(ed);
  if (toOffer) offerBackup(ed, toOffer);
  if (restored) {
    notice(esc(tk('admin.cms.restored')), 'info');
    ed.edits++;
    // Counts as unsaved: guardUnsaved and autosave both hear it.
    $<HTMLFormElement>('cmsForm')!.dispatchEvent(new Event('input'));
  }
}

function autosaveFor(ed: Editor): AutosaveQueue {
  // Bound to this editor: a save it scheduled never sends another form's data.
  return new AutosaveQueue(async () => { await save(ed, true); }, AUTOSAVE_MS);
}

/**
 * Side by side, per field that differs: another version (the site's, or the
 * copy in this browser) and the form, with a button that copies the other
 * version's value into the form. Never a merge on its own.
 */
function drawCompare(ed: Editor, box: HTMLElement, o: {
  other: () => Values; title: string; sub?: string; otherLabel: string; formLabel: string; take: string; none: string; footer: string; footerId: string; onFooter: () => void;
}): void {
  const draw = () => {
    const form = currentValues(ed);
    const other = o.other();
    const fields = fieldsFor(ed.model).filter((f) => !f.readOnly && !f.approverOnly && !same(other[f.key], form[f.key]));
    const text = (f: FieldDef, v: unknown) => esc(show(f, ed.model.format === 'markdown-pair' ? pairText(v) : v));
    box.innerHTML = `<div class="rounded-2xl border border-amber-200 bg-amber-50 p-4 lg:p-3">
      <p class="text-sm font-semibold text-amber-900">${esc(o.title)}</p>
      ${o.sub ? `<p class="text-xs text-amber-800 mt-0.5 break-all">${esc(o.sub)}</p>` : ''}
      <div class="flex flex-col gap-2 mt-3">${fields.map((f) => `<div data-changed-field="${f.key}" class="bg-white rounded-xl border border-border p-3 lg:p-2">
        <div class="flex flex-wrap items-center justify-between gap-2"><p class="text-sm font-medium text-navy">${esc(tk(f.label))}</p>
          <button type="button" data-take="${f.key}" class="${BTN.secondary}">${esc(o.take)}</button></div>
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-2 mt-2">
          <div class="min-w-0 rounded-lg bg-[#F7F7F6] px-3 py-2"><p class="text-[11px] font-semibold uppercase text-gray-500">${esc(o.otherLabel)}</p><p class="text-sm text-navy whitespace-pre-wrap [overflow-wrap:anywhere]">${text(f, other[f.key])}</p></div>
          <div class="min-w-0 rounded-lg bg-white border border-border px-3 py-2"><p class="text-[11px] font-semibold uppercase text-gray-500">${esc(o.formLabel)}</p><p class="text-sm text-navy whitespace-pre-wrap [overflow-wrap:anywhere]">${text(f, form[f.key])}</p></div>
        </div></div>`).join('') || `<p class="text-sm text-amber-800">${esc(o.none)}</p>`}</div>
      <div class="mt-3"><button type="button" id="${o.footerId}" data-compare-footer class="${BTN.primary}">${esc(o.footer)}</button></div></div>`;
    box.querySelectorAll<HTMLButtonElement>('[data-take]').forEach((b) => b.addEventListener('click', () => {
      const f = ed.model.fields.find((x) => x.key === b.dataset.take)!;
      redraw(ed, f, other[f.key]);
      draw();
    }));
    box.querySelector('[data-compare-footer]')?.addEventListener('click', o.onFooter);
  };
  box.classList.remove('hidden');
  draw();
}

/** An older copy in this browser: say so, and offer to compare or delete it. */
function offerBackup(ed: Editor, backup: Backup): void {
  const box = $('cmsBackup');
  if (!box) return;
  const drop = () => { dropBackup(offeredKey(ed.backupKey)); box.classList.add('hidden'); box.innerHTML = ''; };
  box.classList.remove('hidden');
  box.innerHTML = `<div class="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
    <span class="flex-1 min-w-0">${esc(tk('admin.cms.backup.ask'))}</span>
    <button type="button" data-backup-compare class="${BTN.secondary}">${esc(tk('admin.cms.backup.compare'))}</button>
    <button type="button" data-backup-drop class="${BTN.danger}">${esc(tk('admin.cms.backup.drop'))}</button></div>`;
  box.querySelector('[data-backup-drop]')!.addEventListener('click', drop);
  box.querySelector('[data-backup-compare]')!.addEventListener('click', () => drawCompare(ed, box, {
    other: () => formValues(ed.model, backup.data), title: tk('admin.cms.backup.ask'),
    otherLabel: tk('admin.cms.backup.device'), formLabel: tk('admin.cms.backup.saved'), take: tk('admin.cms.backup.take'),
    none: tk('admin.cms.backup.none'), footer: tk('admin.cms.backup.drop'), footerId: 'cmsBackupDrop', onFooter: drop,
  }));
}

function currentValues(ed: Editor): Values {
  return readValues(ed.model, $('cmsFields')!);
}

/** The data the form holds now, as the server will store it. */
function currentData(ed: Editor): unknown {
  const values = currentValues(ed);
  const data = applyValues(ed.model, ed.base, values);
  const isNew = ed.draft ? ed.draft.action === 'create' : ed.entryId === null;
  return isNew ? withId(ed.model, data, suggestedId(ed.model, values)) : data;
}

function onInput(e: Event): void {
  const ed = editor;
  if (!ed || ed.readOnly) return;
  ed.edits++;
  const values = currentValues(ed);
  if ((e.target as HTMLElement | null)?.closest?.('[data-field-wrap="title"]')) {
    const title = $('cmsTitle');
    if (title) title.textContent = titleFrom(ed.model, values) || tk('admin.cms.untitled');
  }
  updateFileName(ed, values);
  // Editing what is on the site: from the first change on, this is a draft.
  if (!$('cmsBanner')) $('cmsNotice')?.insertAdjacentHTML('beforebegin', `<p id="cmsBanner" class="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">${esc(tk('admin.cms.notLiveBanner'))}</p>`);
  backupPut(ed, currentData(ed));
  ed.autosave?.touch();
}

/** Redraws one field with a new value (list rows, images, "take the site's value"). */
function redraw(ed: Editor, f: FieldDef, value: unknown): void {
  const wrap = $('cmsFields')?.querySelector(`[data-field-wrap="${f.key}"]`);
  if (!wrap) return;
  wrap.outerHTML = renderField(ed.model, f, value, { readOnly: ed.readOnly });
  $<HTMLFormElement>('cmsForm')!.dispatchEvent(new Event('input'));
}

function onFormClick(e: Event): void {
  const ed = editor;
  const target = e.target as HTMLElement;
  if (!ed) return;
  const preview = target.closest<HTMLButtonElement>('[data-preview]');
  if (preview) { togglePreview(ed, preview); return; }
  if (ed.readOnly) return;
  const wrap = target.closest<HTMLElement>('[data-field-wrap]');
  const f = wrap ? ed.model.fields.find((x) => x.key === wrap.dataset.fieldWrap) : undefined;
  if (!wrap || !f) return;
  const listLang = target.closest<HTMLElement>('[data-list-lang]')?.dataset.listLang as 'en' | 'tr' | 'both' | undefined;
  const value = readField(ed.model, f, wrap);
  const edit = (fn: (list: unknown[]) => unknown[]) => {
    if (ed.model.format === 'markdown-pair') {
      const v = value as { en: unknown[]; tr: unknown[] };
      if (listLang === 'both') { const l = fn([...v.en]); redraw(ed, f, { en: l, tr: [...l] }); } else if (listLang) redraw(ed, f, { ...v, [listLang]: fn([...v[listLang]]) });
      return;
    }
    redraw(ed, f, fn([...(value as unknown[])]));
  };
  const i = Number(target.closest<HTMLElement>('[data-row-i]')?.dataset.rowI ?? -1);
  if (target.closest('[data-add]')) edit((l) => [...l, f.kind === 'links' ? { label: { en: '', tr: '' }, url: '' } : '']);
  else if (target.closest('[data-remove]')) edit((l) => l.filter((_, j) => j !== i));
  else if (target.closest('[data-move]')) {
    const d = Number(target.closest<HTMLElement>('[data-move]')!.dataset.move);
    edit((l) => { const j = i + d; if (j < 0 || j >= l.length) return l; [l[i], l[j]] = [l[j], l[i]]; return l; });
  } else if (target.closest('[data-image-remove]')) {
    redraw(ed, f, ed.model.format === 'markdown-pair' ? { en: '', tr: '' } : f.image === 'url' ? '' : null);
  }
}

function togglePreview(ed: Editor, button: HTMLButtonElement): void {
  const key = button.dataset.preview!;
  const box = $('cmsFields')?.querySelector<HTMLElement>(`[data-preview-box="${key}"]`);
  if (!box) return;
  const open = box.classList.toggle('hidden') === false;
  button.setAttribute('aria-expanded', String(open));
  button.textContent = tk(open ? 'admin.cms.preview.hide' : 'admin.cms.preview.show');
  if (!open) return;
  const f = ed.model.fields.find((x) => x.key === key)!;
  const v = readField(ed.model, f, button.closest('[data-field-wrap]')!) as { en: string; tr: string };
  box.innerHTML = (['en', 'tr'] as const).map((l) => `<div class="min-w-0 rounded-lg border border-border p-3 text-sm text-navy [&_p]:mb-2 [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5">
    <p class="text-[11px] font-semibold uppercase text-gray-500">${l}</p>${previewHtml(renderBody(v[l]).html)}</div>`).join('');
}

/** Uploads a chosen image; saving waits for it. No cropper: the site shows it as uploaded. */
async function onImageFile(input: HTMLInputElement): Promise<void> {
  const ed = editor;
  const file = input.files?.[0];
  if (!ed || !file) return;
  const f = ed.model.fields.find((x) => x.key === input.dataset.imageFile)!;
  const status = $('cmsFields')?.querySelector<HTMLElement>(`[data-image-status="${f.key}"]`);
  if (status) status.textContent = tk('admin.cms.image.uploading');
  input.disabled = true;
  const job = (async () => {
    try {
      const url = await uploadImage(file);
      if (editor !== ed) return;
      const wrap = $('cmsFields')!.querySelector(`[data-field-wrap="${f.key}"]`)!;
      const before = readField(ed.model, f, wrap);
      if (ed.model.format === 'markdown-pair') redraw(ed, f, { en: url, tr: url });
      else if (f.image === 'url') redraw(ed, f, url);
      // One upload for both sizes in this release: the card and the click show the same file.
      else redraw(ed, f, { ...(before as ImageObject | null ?? { alt: { en: '', tr: '' } }), thumb: url, full: url, alt: (before as ImageObject | null)?.alt ?? { en: '', tr: '' } });
      const st = $('cmsFields')?.querySelector<HTMLElement>(`[data-image-status="${f.key}"]`);
      if (st) st.textContent = tk('admin.cms.image.uploaded');
    } catch (err) {
      if (status) status.textContent = tk(uploadErrorKey(err instanceof Error ? err.message : ''));
    } finally {
      input.disabled = false;
      input.value = '';
    }
  })();
  ed.uploads.add(job);
  await job;
  ed.uploads.delete(job);
}

// ── Opening ──────────────────────────────────────────────────────────────────

function loadingEditor(sub: string, back: string): void {
  editorHost(sub);
  head({ title: tk('admin.cms.loading'), back });
  $('cmsFields')!.innerHTML = '';
  $('cmsBar')!.innerHTML = '';
  $('cmsReview')!.innerHTML = '';
  $('cmsForm')!.classList.remove('hidden');
}

async function openEntry(model: TypeModel, entryId: string | null, route: string): Promise<void> {
  const back = `${SECTION}/${model.sub}`;
  loadingEditor(model.sub, back);
  const placeholder = newEditor(model, route, emptyData(model), {});
  editor = placeholder;
  if (!entryId) {
    head({ title: tk('admin.cms.newOf', { type: tk(model.label) }), back, chipHtml: chip(tk('admin.cms.chip.draft'), 'neutral'), line: tk('admin.cms.status.draft'), banner: true });
    start(newEditor(model, route, emptyData(model), { backupKey: `new:${model.key}` }));
    return;
  }
  const [r] = await Promise.all([api<{ data: unknown; base_shas: Record<string, string | null> }>('GET', `/api/cms/entry?type=${model.key}&id=${encodeURIComponent(entryId)}`), loadLists()]);
  if (editor !== placeholder) return;
  if (!r.ok) {
    head({ title: tk('admin.cms.notFoundTitle'), back });
    notice(esc(errorText(r)));
    return;
  }
  // My own draft of this entry: continue that one, never start a second.
  const mine = (lists?.mine ?? []).find((d) => d.type === model.key && d.entry_id === entryId && sv(d).editable);
  if (mine) { location.replace(`${SECTION}/taslaklar/${mine.id}`); return; }
  const live = (lists?.live ?? []).find((d) => d.type === model.key && d.entry_id === entryId);
  const values = formValues(model, r.body.data);
  const title = titleFrom(model, values) || entryId;
  const ed = newEditor(model, route, r.body.data, { entryId, baseShas: r.body.base_shas, backupKey: `edit:${model.key}:${entryId}`, readOnly: !!live });
  head({ title, back, line: live ? tk(live.status === 'submitted' ? 'admin.cms.busySubmitted' : 'admin.cms.busyGoingLive') : tk('admin.cms.editingLive') });
  start(ed);
}

function titleFrom(model: TypeModel, values: Values): string {
  const v = values.title as { en?: unknown; tr?: unknown } | string | undefined;
  if (typeof v === 'string') return v;
  const pick = (x: unknown) => (typeof x === 'string' ? x : '');
  return (lang === 'tr' ? pick(v?.tr) || pick(v?.en) : pick(v?.en) || pick(v?.tr));
}

async function openDraft(id: string, route: string): Promise<void> {
  const back = `${SECTION}/taslaklar`;
  loadingEditor('taslaklar', back);
  const placeholder = newEditor(MODELS.events, route, {}, { readOnly: true });
  editor = placeholder;
  const r = await api<{ draft: Draft }>('GET', `/api/cms/drafts/${encodeURIComponent(id)}`);
  if (editor !== placeholder) return;
  if (!r.ok) {
    head({ title: tk('admin.cms.goneTitle'), back });
    notice(r.code === 'unauthenticated' ? esc(tk('admin.cms.error.unauthenticated'))
      : `<p>${esc(tk('admin.cms.gone'))} <a href="${back}" data-cms-to-drafts class="underline">${esc(tk('admin.cms.toMyDrafts'))}</a></p>`);
    return;
  }
  const draft = r.body.draft;
  const model = modelFor(draft.type);
  if (!model) return;
  await loadEntries(model);
  if (editor !== placeholder) return;
  const v = sv(draft);
  const ed = newEditor(model, route, draft.data ?? emptyData(model), {
    draft, entryId: draft.action === 'create' ? null : draft.entry_id, backupKey: draft.id, readOnly: !v.editable || draft.action === 'delete',
  });
  const values = formValues(model, ed.base);
  head({
    title: titleFrom(model, values) || titleOf(draft.type, draft.entry_id, draft.action), back, chipHtml: statusChip(draft), line: statusLine(draft),
    banner: draft.status !== 'published' && draft.status !== 'discarded',
  });
  if (draft.action === 'delete') {
    $('cmsFields')!.innerHTML = `<p class="bg-white rounded-2xl border border-border p-4 lg:p-3 text-sm text-navy">${esc(tk('admin.cms.deleteDraft', { title: titleOf(draft.type, draft.entry_id) }))}</p>`;
    editor = ed;
    renderBar(ed);
    if (pendingNotice) { notice(pendingNotice.html, pendingNotice.tone); pendingNotice = null; }
    return;
  }
  start(ed);
  if (draft.status === 'pr_failed' && draft.failure && v.next === 'retry') {
    notice(esc(tk('admin.cms.retryHint')), 'warn');
  }
  if (pendingNotice) { notice(pendingNotice.html, pendingNotice.tone); pendingNotice = null; }
  if (!ed.readOnly && draft.action === 'update') await checkChanged(ed);
}

/**
 * Has the entry changed on the site since this draft began? The deployed
 * index carries each file's sha, so asking costs no GitHub call; only when
 * it says yes is the entry read, for the side-by-side view.
 */
async function checkChanged(ed: Editor): Promise<void> {
  const entry = entries[ed.model.key]?.find((e) => e.id === ed.draft!.entry_id);
  const base = ed.draft!.base_shas ?? {};
  if (!entry?.shas || Object.keys(base).every((p) => (entry.shas![p] ?? null) === base[p])) return;
  const r = await api<{ data: unknown; base_shas: Record<string, string | null> }>('GET', `/api/cms/entry?type=${ed.model.key}&id=${encodeURIComponent(ed.draft!.entry_id)}`);
  if (editor !== ed || !r.ok) return;
  if (Object.keys(base).every((p) => (r.body.base_shas[p] ?? null) === base[p])) return;
  showChanged(ed, r.body);
}

/**
 * The entry changed on the site since the draft began: per field, what the
 * site has now and what the draft has, with "take the site's value". No
 * automatic merge. Continuing moves the draft onto the site's version (a
 * fresh draft with these values; the old one is discarded), which is what
 * lets it be approved.
 */
function showChanged(ed: Editor, fresh: { data: unknown; base_shas: Record<string, string | null> }): void {
  ed.fresh = fresh;
  const box = $('cmsChanged');
  if (!box) return;
  const files = Object.keys(fresh.base_shas).filter((p) => (ed.draft?.base_shas?.[p] ?? ed.baseShas?.[p] ?? null) !== fresh.base_shas[p]);
  drawCompare(ed, box, {
    other: () => formValues(ed.model, fresh.data), title: tk('admin.cms.changed.title'), sub: tk('admin.cms.changed.files', { files: files.join(', ') }),
    otherLabel: tk('admin.cms.changed.site'), formLabel: tk('admin.cms.changed.draft'), take: tk('admin.cms.changed.take'),
    none: tk('admin.cms.changed.none'), footer: tk('admin.cms.changed.continue'), footerId: 'cmsRebase', onFooter: () => void rebase(ed),
  });
  const submitBtn = $<HTMLButtonElement>('cmsSubmit');
  if (submitBtn) submitBtn.disabled = true;
  revealInPanel(box, 'start');
}

const pairText = (v: unknown) => {
  const b = v as { en: unknown; tr: unknown };
  return same(b.en, b.tr) ? b.en : { en: Array.isArray(b.en) ? b.en.join(', ') : b.en, tr: Array.isArray(b.tr) ? b.tr.join(', ') : b.tr };
};

async function rebase(ed: Editor): Promise<void> {
  if (!ed.fresh) return;
  const values = currentValues(ed);
  const data = applyValues(ed.model, ed.fresh.data, values);
  if (!ed.draft) {
    // Not saved yet: carry on from the site's version.
    ed.base = ed.fresh.data;
    ed.baseShas = ed.fresh.base_shas;
    ed.fresh = null;
    $('cmsChanged')?.classList.add('hidden');
    const s = $<HTMLButtonElement>('cmsSubmit');
    if (s) s.disabled = false;
    await saveNow();
    return;
  }
  const made = await api<{ draft: Draft }>('POST', '/api/cms/drafts', { type: ed.model.key, action: 'update', entry_id: ed.draft.entry_id, data, base_shas: ed.fresh.base_shas });
  if (!made.ok) { notice(esc(errorText(made))); return; }
  const gone = await api('DELETE', `/api/cms/drafts/${ed.draft.id}`);
  // Said on the new draft: whether the old one is gone, and the note it was sent back with.
  const note = ed.draft.status === 'rejected' && ed.draft.review_note ? ` ${esc(tk('admin.cms.rebase.note', { note: ed.draft.review_note }))}` : '';
  pendingNotice = gone.ok
    ? { html: `${esc(tk('admin.cms.rebase.done'))}${note}`, tone: 'info' }
    : { html: `${esc(tk('admin.cms.rebase.discardFailed'))}${note}`, tone: 'error' };
  dropBackups(ed.backupKey);
  guard?.reset();
  closeEditor();
  location.replace(`${SECTION}/taslaklar/${made.body.draft.id}`);
}

// ── Saving ───────────────────────────────────────────────────────────────────

let saving: Promise<boolean> | null = null;

/** Kaydet: save now (after any upload in flight), one save at a time. */
async function saveNow(): Promise<boolean> {
  const ed = editor;
  if (!ed || ed.readOnly) return true;
  ed.autosave?.stop();
  const ok = await save(ed, false);
  if (editor === ed && !ed.readOnly && !ed.conflict) ed.autosave = autosaveFor(ed);
  return ok;
}

/**
 * Saves the form of `ed`, the editor that asked. One at a time: a save
 * asked for while one runs waits for it, then saves what is there. If
 * another form has been opened meanwhile, it sends nothing; its copy in
 * this browser stays.
 */
function save(ed: Editor, auto: boolean): Promise<boolean> {
  const run = (saving ?? Promise.resolve(true)).then(() => doSave(ed, auto));
  saving = run.finally(() => { if (saving === run) saving = null; }) as Promise<boolean>;
  return run;
}

async function doSave(ed: Editor, auto: boolean): Promise<boolean> {
  if (editor !== ed || ed.readOnly || ed.conflict) return false;
  if (ed.uploads.size) { setSaveState(tk('admin.cms.image.waiting')); await Promise.all([...ed.uploads]); }
  if (editor !== ed) return false;
  const values = currentValues(ed);
  const data = currentData(ed);
  const editsAtStart = ed.edits;
  setSaveState(tk('admin.cms.saving'));
  clearErrors();
  let r: Answer<{ draft: Draft }>;
  if (!ed.draft) {
    if (!ed.entryId && !suggestedId(ed.model, values)) {
      // A new entry is named after its title (or repo): nothing to store it under yet.
      setSaveState(tk('admin.cms.needTitle'));
      if (!auto) showErrors({ [ed.model.key === 'workshops' ? 'repo' : ed.model.key === 'events' ? 'id' : 'en.frontmatter.title']: 'Missing' }, true);
      return false;
    }
    r = await api<{ draft: Draft }>('POST', '/api/cms/drafts', ed.entryId
      ? { type: ed.model.key, action: 'update', entry_id: ed.entryId, data, base_shas: ed.baseShas }
      : { type: ed.model.key, action: 'create', data });
  } else {
    // The version this form was made on: a save from an older one is refused.
    r = await api<{ draft: Draft }>('PATCH', `/api/cms/drafts/${ed.draft.id}`, { data, write_nonce: ed.draft.write_nonce });
    if (!r.ok && r.code === 'network') ed.lostSave = { data };
    else if (!r.ok && r.code === 'draft_changed' && ed.lostSave && editor === ed) {
      // The earlier save whose answer was lost may be what changed the
      // version. If the draft holds exactly what it sent, that was this tab:
      // take the new version and save again. Asked once.
      const lost = ed.lostSave;
      ed.lostSave = null;
      const now2 = await api<{ draft: Draft }>('GET', `/api/cms/drafts/${ed.draft.id}`);
      if (editor !== ed) return false;
      if (now2.ok && sameData(now2.body.draft.data, lost.data)) {
        ed.draft = { ...ed.draft, ...now2.body.draft };
        r = await api<{ draft: Draft }>('PATCH', `/api/cms/drafts/${ed.draft.id}`, { data, write_nonce: ed.draft.write_nonce });
      }
    }
    if (r.ok) ed.lostSave = null;
  }
  if (editor !== ed) return r.ok;
  if (!r.ok) return saveFailed(ed, r, auto, data);
  const wasNew = !ed.draft;
  ed.draft = { ...r.body.draft };
  ed.base = r.body.draft.data;
  if (wasNew) {
    dropBackups(ed.backupKey);
    ed.backupKey = ed.draft.id;
    // The draft's own address from now on (the link a pull request carries).
    replaceAddress(`${SECTION}/taslaklar/${ed.draft.id}`);
    lists = null;
    head({ title: titleFrom(ed.model, values) || ed.draft.entry_id, back: `${SECTION}/taslaklar`, chipHtml: statusChip(ed.draft), line: statusLine(ed.draft), banner: true });
    renderBar(ed);
  }
  if (ed.edits === editsAtStart) {
    dropBackup(ed.backupKey);
    guard?.reset();
  } else {
    backupPut(ed, currentData(ed));
  }
  ed.signedOutShown = false;
  setSaveState(tk('admin.cms.saved', { time: clock(now()) }));
  return true;
}

function saveFailed(ed: Editor, r: { status: number; code: string; body: Record<string, any> }, auto: boolean, data: unknown): boolean {
  backupPut(ed, data);
  if (r.code === 'unauthenticated') {
    // The form stays as it is; the copy in this browser keeps it after signing in.
    setSaveState(tk('admin.cms.notSavedBackedUp'));
    // Once: an autosave that fails again does not scroll the page to it again.
    if (!ed.signedOutShown) {
      ed.signedOutShown = true;
      notice(`<p>${esc(tk('admin.cms.error.unauthenticated'))} <a href="/auth/login?next=${encodeURIComponent(location.pathname + location.hash)}" target="_blank" rel="noopener" class="underline">${esc(tk('admin.cms.signIn'))}</a></p>`);
    }
    return false;
  }
  if (r.code === 'draft_changed') {
    // Saved from another tab or device since this was loaded. No more saves
    // from here; the copy in this browser stays, and a reload offers it.
    ed.conflict = true;
    ed.autosave?.stop();
    ed.autosave = null;
    setSaveState(tk('admin.cms.notSavedBackedUp'));
    notice(`<p>${esc(tk('admin.cms.error.draft_changed'))}</p><div class="mt-2"><button type="button" id="cmsReload" class="${BTN.secondary}">${esc(tk('admin.cms.reload'))}</button></div>`, 'warn');
    $('cmsReload')?.addEventListener('click', () => {
      const id = ed.draft!.id;
      guard?.reset();
      closeEditor();
      void openDraft(id, `${SECTION}/taslaklar/${id}`);
    });
    const s = $<HTMLButtonElement>('cmsSubmit');
    if (s) s.disabled = true;
    return false;
  }
  if (r.code === 'invalid') {
    setSaveState(tk('admin.cms.notSavedFix'));
    showErrors(r.body.errors ?? {}, !auto);
    return false;
  }
  if (r.code === 'changed_since' && !ed.draft && ed.entryId) {
    setSaveState(tk('admin.cms.notSavedBackedUp'));
    void api<{ data: unknown; base_shas: Record<string, string | null> }>('GET', `/api/cms/entry?type=${ed.model.key}&id=${encodeURIComponent(ed.entryId)}`)
      .then((fresh) => { if (fresh.ok && editor === ed) showChanged(ed, fresh.body); });
    return false;
  }
  setSaveState(tk('admin.cms.notSavedBackedUp'));
  if (!auto || r.code !== 'network') notice(esc(errorText(r)));
  return false;
}

// ── Errors next to the fields ────────────────────────────────────────────────

function clearErrors(): void {
  $('cmsErrors')?.classList.add('hidden');
  $('cmsFields')?.querySelectorAll<HTMLElement>('[data-error]').forEach((p) => { p.classList.add('hidden'); p.textContent = ''; });
  $('cmsFields')?.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
}

/** A label for an error path: "Bağlantılar › Bağlantı 2 › Adres (EN)". */
function placeLabel(model: TypeModel, path: string): { key: string | null; label: string; lang?: string } {
  const p = placeOf(model, path);
  const f = model.fields.find((x) => x.key === p.key);
  const parts = [f ? tk(f.approverOnly ? 'admin.cms.f.note' : f.label) : tk('admin.cms.wholeEntry')];
  if (p.row !== undefined) parts.push(tk('admin.cms.list.link', { n: p.row + 1 }));
  if (p.part === 'url') parts.push(tk('admin.cms.f.url'));
  if (p.part === 'label') parts.push(tk('admin.cms.f.linkLabel'));
  if (p.part === 'alt') parts.push(tk('admin.cms.f.alt'));
  return { key: p.key, label: `${parts.join(' › ')}${p.lang ? ` (${p.lang.toUpperCase()})` : ''}`, lang: p.lang };
}

function showErrors(errors: Record<string, string>, focus: boolean): void {
  const ed = editor;
  if (!ed) return;
  const items = Object.entries(errors).map(([path, msg]) => ({ ...placeLabel(ed.model, path), msg: tk(messageKey(msg)) }));
  if (!items.length) return;
  const box = $('cmsErrors');
  if (!box) return;
  box.innerHTML = `<p class="font-semibold">${esc(tk('admin.cms.errors.count', { n: items.length }))}</p>
    <ul class="mt-1 flex flex-col gap-0.5">${items.map((it, i) => `<li><button type="button" data-goto="${i}" class="text-left underline min-h-11 lg:min-h-0">${esc(it.label)}: ${esc(it.msg)}</button></li>`).join('')}</ul>`;
  box.classList.remove('hidden');
  const controlFor = (it: typeof items[number]) => {
    const wrap = it.key ? $('cmsFields')!.querySelector<HTMLElement>(`[data-field-wrap="${it.key}"]`) : null;
    if (!wrap) return null;
    return wrap.querySelector<HTMLElement>(`${it.lang ? `[data-lang="${it.lang}"], [data-lang="both"]` : '[data-field]:not([type=hidden])'}`) ?? wrap.querySelector<HTMLElement>('[data-field]:not([type=hidden]), input[type=file]');
  };
  for (const it of items) {
    const wrap = it.key ? $('cmsFields')!.querySelector<HTMLElement>(`[data-field-wrap="${it.key}"]`) : null;
    const line = wrap?.querySelector<HTMLElement>('[data-error]');
    if (line) { line.textContent = [line.textContent, `${it.label}: ${it.msg}`].filter(Boolean).join(' · '); line.classList.remove('hidden'); }
    controlFor(it)?.setAttribute('aria-invalid', 'true');
    if (wrap?.closest('details')) (wrap.closest('details') as HTMLDetailsElement).open = true;
  }
  box.querySelectorAll<HTMLButtonElement>('[data-goto]').forEach((b) => b.addEventListener('click', () => {
    const el = controlFor(items[Number(b.dataset.goto)]);
    el?.focus();
    if (el) revealInPanel(el, 'center');
  }));
  if (focus) {
    const first = items.map(controlFor).find(Boolean);
    if (first) { first.focus(); revealInPanel(first, 'center'); } else revealInPanel(box);
  }
}

// ── Sending, approving, the rest ─────────────────────────────────────────────

async function submit(): Promise<void> {
  const ed = editor;
  if (!ed || ed.readOnly) return;
  const btn = $<HTMLButtonElement>('cmsSubmit');
  if (btn) btn.disabled = true;
  try {
    if (!(await saveNow()) || editor !== ed || !ed.draft) return;
    const half = halfTranslated(ed.model, currentValues(ed));
    if (half.length && !ed.halfOk) {
      notice(`<p class="font-semibold">${esc(tk('admin.cms.half.title'))}</p>
        <p class="mt-0.5">${half.map((h) => esc(`${tk(h.label)}${h.sub ? ` ${h.sub}` : ''}`)).join(', ')}</p>
        <div class="flex flex-wrap gap-2 mt-2"><button type="button" id="cmsHalfSend" class="${BTN.secondary}">${esc(tk('admin.cms.half.send'))}</button></div>`, 'warn');
      $('cmsHalfSend')?.addEventListener('click', () => { ed.halfOk = true; notice(null); void submit(); });
      return;
    }
    const r = await api<{ draft: Draft }>('POST', `/api/cms/drafts/${ed.draft.id}/submit`, {});
    if (editor !== ed) return;
    if (!r.ok) {
      if (r.code === 'invalid') { showErrors(r.body.errors ?? {}, true); notice(esc(tk('admin.cms.error.invalid'))); return; }
      notice(esc(errorText(r)));
      return;
    }
    ed.draft = { ...ed.draft, ...r.body.draft };
    dropBackups(ed.backupKey);
    guard?.reset();
    lists = null;
    void refreshCounts();
    // Mine and an approver's: approve it here, in the same chain.
    await reopenAs(ed, approver ? 'admin.cms.sentApprover' : 'admin.cms.sent');
  } finally {
    if (btn && editor === ed && !ed.readOnly && !ed.fresh) btn.disabled = false;
  }
}

/** Shows a draft again after a step (sent, cancelled), with a note of what happened. */
async function reopenAs(ed: Editor, message: string): Promise<void> {
  ed.autosave?.stop();
  const id = ed.draft!.id;
  const route = `${SECTION}/taslaklar/${id}`;
  pendingNotice = {
    html: `${esc(tk(message))}${approver && message === 'admin.cms.sentApprover' ? ` <a href="${SECTION}/onay/${id}" class="underline">${esc(tk('admin.cms.review'))}</a>` : ''}`,
    tone: 'info',
  };
  closeEditor();
  // Through the shell, so the Taslaklarım tab is the one on screen.
  if (location.hash !== route) location.hash = route;
  else await openDraft(id, route);
}

async function discard(ed: Editor): Promise<void> {
  if (!ed.draft) return;
  const r = await api('DELETE', `/api/cms/drafts/${ed.draft.id}`);
  if (!r.ok) { notice(esc(errorText(r))); return; }
  dropBackups(ed.backupKey);
  guard?.reset();
  lists = null;
  void refreshCounts();
  closeEditor();
  location.hash = `${SECTION}/taslaklar`;
}

async function cancelPr(ed: Editor): Promise<void> {
  if (!ed.draft) return;
  const r = await api<{ draft: Draft }>('POST', `/api/cms/drafts/${ed.draft.id}/cancel`, {});
  if (!r.ok) { notice(esc(errorText(r))); if (r.code !== 'already_merged') return; }
  await reopenAs(ed, r.ok ? 'admin.cms.cancelled' : 'admin.cms.error.already_merged');
}

/** An approver's delete: a delete draft, sent and approved in one go; it never waits in the queue. */
async function deleteEntry(ed: Editor): Promise<void> {
  if (!ed.entryId) return;
  const made = await api<{ draft: Draft }>('POST', '/api/cms/drafts', { type: ed.model.key, action: 'delete', entry_id: ed.entryId, base_shas: ed.baseShas });
  if (!made.ok) { notice(esc(errorText(made))); return; }
  const id = made.body.draft.id;
  const sent = await api('POST', `/api/cms/drafts/${id}/submit`, {});
  if (!sent.ok) { notice(esc(errorText(sent))); return; }
  const ok = await api('POST', `/api/cms/drafts/${id}/approve`, {});
  lists = null;
  void refreshCounts();
  dropBackups(ed.backupKey);
  guard?.reset();
  closeEditor();
  pendingNotice = ok.ok ? { html: esc(tk('admin.cms.approved')), tone: 'info' } : { html: esc(errorText(ok)), tone: 'error' };
  location.hash = `${SECTION}/taslaklar/${id}`;
}

// ── The approver's view ──────────────────────────────────────────────────────

async function openReview(id: string, route: string): Promise<void> {
  const back = `${SECTION}/onay`;
  loadingEditor('onay', back);
  $('cmsForm')!.classList.add('hidden');
  const placeholder = newEditor(MODELS.events, route, {}, { readOnly: true });
  editor = placeholder;
  const r = await api<{ draft: Draft }>('GET', `/api/cms/drafts/${encodeURIComponent(id)}`);
  if (editor !== placeholder) return;
  if (!r.ok) {
    head({ title: tk('admin.cms.goneTitle'), back });
    notice(r.code === 'unauthenticated' ? esc(tk('admin.cms.error.unauthenticated'))
      : `<p>${esc(tk('admin.cms.gone'))} <a href="${SECTION}/taslaklar" data-cms-to-drafts class="underline">${esc(tk('admin.cms.toMyDrafts'))}</a></p>`);
    return;
  }
  const draft = r.body.draft;
  const model = modelFor(draft.type)!;
  await loadEntries(model);
  let published: unknown = null;
  // Without the published version there is nothing to compare with (or, for
  // a delete, nothing to show): no approval on a guess.
  let unreadable = false;
  if (draft.action !== 'create') {
    const e = await api<{ data: unknown }>('GET', `/api/cms/entry?type=${model.key}&id=${encodeURIComponent(draft.entry_id)}`);
    if (editor !== placeholder) return;
    if (e.ok) published = e.body.data;
    else unreadable = true;
  }
  const ed = newEditor(model, route, draft.data ?? {}, { draft, readOnly: true });
  editor = ed;
  const fields = fieldsFor(model);
  const values = formValues(model, draft.data ?? emptyData(model));
  const title = titleFrom(model, values) || titleOf(draft.type, draft.entry_id, draft.action);
  head({ title, back, chipHtml: statusChip(draft), line: `${tk(model.label)} · ${tk('admin.cms.sentBy', { name: draft.author_name || tk('admin.cms.anEditor'), time: when(draft.updated_at) })}` });
  let bodyHtml: string;
  let nothing = false;
  // The note is an approver's field; a change to it alone is a change.
  let noteChanged = false;
  if (unreadable) {
    bodyHtml = `<p data-cms-unreadable class="text-sm text-[#8a1c1c]">${esc(tk('admin.cms.review.unreadable'))}</p>`;
    nothing = true;
  } else if (draft.action === 'create') {
    bodyHtml = `<p class="text-sm font-semibold text-navy mb-1">${esc(tk('admin.cms.review.new'))}</p>${renderAll(model, values, fields.filter((f) => !f.approverOnly))}`;
  } else if (draft.action === 'delete') {
    bodyHtml = `<p class="text-sm font-semibold text-red mb-1">${esc(tk('admin.cms.review.delete'))}</p>${renderAll(model, formValues(model, published), fields.filter((f) => !f.approverOnly))}`;
  } else {
    const diff = diffEntry(model, published ?? emptyData(model), draft.data, fields);
    noteChanged = diff.changed.some((c) => c.field.approverOnly);
    nothing = diff.changed.length === 0;
    bodyHtml = nothing ? `<p class="text-sm text-gray-600">${esc(tk('admin.cms.review.nothing'))}</p>`
      : `<p class="text-sm font-semibold text-navy">${esc(tk('admin.cms.review.changed', { n: diff.changed.length }))}</p>
        <div class="flex flex-wrap gap-1 mt-1 mb-2">${diff.changed.map((c) => chip(tk(c.field.label), 'navy')).join('')}</div>${renderDiff(diff)}`;
  }
  const note = model.key === 'events' && approver && !noteChanged ? String((draft.data as Record<string, unknown> | undefined)?.note ?? '') : '';
  // Someone who cannot approve sees the changes, not the buttons.
  const waiting = approver && (draft.status === 'submitted' || sv(draft).line === 'admin.cms.status.approvedStale');
  $('cmsReview')!.innerHTML = `<div class="bg-white rounded-2xl border border-border p-4 lg:p-3">${bodyHtml}
      ${note ? `<div class="mt-3 rounded-lg bg-[#F7F7F6] px-3 py-2"><p class="text-[11px] font-semibold uppercase text-gray-500">${esc(tk('admin.cms.f.note'))}</p><p class="text-sm text-navy whitespace-pre-wrap [overflow-wrap:anywhere]">${esc(note)}</p></div>` : ''}
    </div>
    ${waiting ? `<div data-cms-sticky class="sticky bottom-0 lg:-bottom-1 z-10 mt-3 -mx-1 px-1 py-2 bg-[#F7F7F6] border-t border-border">
      <div id="cmsRejectBox" class="hidden mb-2 bg-white rounded-xl border border-border p-3 lg:p-2">
        <label for="cmsRejectNote" class="text-xs font-medium text-gray-600">${esc(tk('admin.cms.reject.note'))}</label>
        <textarea id="cmsRejectNote" rows="3" maxlength="2000" class="mt-1 w-full px-3 py-2 rounded-xl border border-border text-sm text-navy focus:outline-none focus-visible:outline-2 focus-visible:outline-navy-mid"></textarea>
        <div class="flex flex-wrap gap-2 mt-2"><button type="button" id="cmsRejectSend" class="${BTN.danger}" disabled>${esc(tk('admin.cms.reject.send'))}</button></div>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <button type="button" id="cmsApprove" class="${BTN.primary}" ${nothing ? 'disabled' : ''}>${esc(tk('admin.cms.approve'))}</button>
        ${draft.status === 'submitted' ? `<button type="button" id="cmsReject" class="${BTN.secondary}">${esc(tk('admin.cms.reject'))}</button>` : ''}
        <span class="flex-1"></span>
        <details class="relative" data-cms-menu><summary class="${BTN.ghost} list-none cursor-pointer" aria-label="${esc(tk('admin.cms.more.menu'))}">…</summary>
          <div class="absolute right-0 bottom-full mb-2 z-10 flex flex-col gap-2 p-2 bg-white rounded-xl border border-border shadow-lg min-w-48">
            <button type="button" id="cmsReviewDiscard" class="${BTN.danger}">${esc(tk('admin.cms.discard'))}</button></div></details>
      </div></div>` : ''}`;
  wireReview(ed);
  liftBars();
  if (!approver) notice(esc(tk('admin.cms.review.readOnly')), 'info');
  else if (unreadable) notice(esc(tk('admin.cms.review.unreadable')));
  // An approval that crashed half way: approving again finishes it.
  else if (draft.status === 'approved') notice(esc(statusLine(draft)), 'warn');
}

function wireReview(ed: Editor): void {
  const id = ed.draft!.id;
  $('cmsApprove')?.addEventListener('click', async () => {
    const b = $<HTMLButtonElement>('cmsApprove')!;
    b.disabled = true;
    const r = await api<{ draft: Draft }>('POST', `/api/cms/drafts/${id}/approve`, {});
    if (editor !== ed) return;
    lists = null;
    void refreshCounts();
    if (!r.ok) {
      b.disabled = false;
      if (r.code === 'invalid') {
        const items = Object.entries(r.body.errors ?? {}).map(([p, m]) => `${placeLabel(ed.model, p).label}: ${tk(messageKey(String(m)))}`);
        notice(`${esc(tk('admin.cms.error.invalid'))}<ul class="mt-1">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`);
      } else if (r.code === 'changed_since') {
        notice(`${esc(tk('admin.cms.error.changed_since'))} ${esc(tk('admin.cms.reject.changedHint'))}`);
        openReject(tk('admin.cms.reject.changedNote'));
      } else notice(esc(errorText(r)));
      return;
    }
    ed.draft = { ...ed.draft!, ...r.body.draft };
    head({ title: $('cmsTitle')?.textContent ?? '', back: `${SECTION}/onay`, chipHtml: statusChip(ed.draft), line: statusLine(ed.draft) });
    notice(esc(tk('admin.cms.approved')), 'info');
    $('cmsReview')!.querySelector('.sticky')?.remove();
  });
  $('cmsReject')?.addEventListener('click', () => openReject(''));
  const note = $<HTMLTextAreaElement>('cmsRejectNote');
  note?.addEventListener('input', () => { $<HTMLButtonElement>('cmsRejectSend')!.disabled = note.value.trim() === ''; });
  $('cmsRejectSend')?.addEventListener('click', async () => {
    const text = note!.value.trim();
    if (!text) return;
    const r = await api('POST', `/api/cms/drafts/${id}/reject`, { note: text });
    if (editor !== ed) return;
    if (!r.ok) { notice(esc(errorText(r))); return; }
    lists = null;
    void refreshCounts();
    location.hash = `${SECTION}/onay`;
  });
  const del = $<HTMLButtonElement>('cmsReviewDiscard');
  if (del) armConfirm(del, tk('admin.cms.confirm'), async () => {
    const r = await api('DELETE', `/api/cms/drafts/${id}`);
    if (!r.ok) { notice(esc(errorText(r))); return; }
    lists = null;
    void refreshCounts();
    location.hash = `${SECTION}/onay`;
  });
}

function openReject(prefill: string): void {
  const box = $('cmsRejectBox');
  const note = $<HTMLTextAreaElement>('cmsRejectNote');
  if (!box || !note) return;
  box.classList.remove('hidden');
  if (prefill && !note.value) note.value = prefill;
  $<HTMLButtonElement>('cmsRejectSend')!.disabled = note.value.trim() === '';
  note.focus();
}

