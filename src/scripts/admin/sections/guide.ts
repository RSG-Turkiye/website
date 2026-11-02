/**
 * The Guide section (src/components/admin/panes/GuidePane.astro): the graduate
 * guide's professors and labs, from /api/guide/professors. Rehber editors
 * read; approvers and admins add, edit, delete and republish. Universities
 * and programmes for the selects come from /guide/catalog.json.
 */
import { escapeHtml } from '../../escape-html';
import { t, tf, showToast, formatDate, lang } from '../context';
import { row, chip, BTN, armConfirm, emptyState } from '../ui-kit';
import { suggestionBody, removalNoticeTemplate, removalNoticeForm } from './guide-render';

interface Professor {
  id: string; title: string; name: string; universityId: string; department: string; labId: string | null;
  profileUrl: string; openalexId: string | null; handTopics: string[]; hiddenTopics: string[]; openalexTopics: string[];
  programmeIds: string[]; source: string; checkedAt: number;
}
interface Lab { id: string; name: string; universityId: string; url: string; checkedAt: number }
interface State { published_at: number | null; count: number | null; unresolved: number | null; error: string | null }
interface Catalog {
  universities: { id: string; name: { en: string; tr: string }; city: string }[];
  programmes: { id: string; universityId: string; name: { en: string; tr: string } }[];
}

let data: { professors: Professor[]; labs: Lab[]; stale: { professors: string[]; labs: string[] }; state: State; canWrite: boolean } | null = null;
let catalog: Catalog = { universities: [], programmes: [] };
let wired = false;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const uniName = (id: string) => catalog.universities.find((u) => u.id === id)?.name[lang] ?? id;
const sel = (form: HTMLFormElement, name: string) => form.querySelector(`[name="${name}"]`) as unknown as HTMLSelectElement;
const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

async function send(url: string, method: string, body?: unknown): Promise<boolean> {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const out = await res.json().catch(() => ({})) as { error?: string; publish?: { ok: boolean } };
  if (!res.ok) { showToast(out.error || t('admin.toast.error'), true); return false; }
  if (out.publish && !out.publish.ok) showToast(t('admin.guide.publishFailed'), true);
  else showToast(t('admin.toast.updated'));
  return true;
}

function renderState() {
  if (!data) return;
  const s = data.state;
  const el = $<HTMLParagraphElement>('guideState');
  const parts: string[] = [];
  if (s?.error) parts.push(t('admin.guide.state.error'));
  if (s?.published_at) parts.push(tf('admin.guide.state.published', { when: formatDate(s.published_at), count: s.count ?? 0 }));
  else parts.push(t('admin.guide.state.never'));
  if (s?.unresolved) parts.push(tf('admin.guide.state.unresolved', { n: s.unresolved }));
  el.textContent = parts.join(' · ');
  el.classList.toggle('text-red-700', Boolean(s?.error));
  $('guideRepublish').classList.toggle('hidden', !data.canWrite);
}

function renderProfessors() {
  if (!data) return;
  const q = $<HTMLInputElement>('guideProfSearch').value.trim().toLocaleLowerCase(lang === 'tr' ? 'tr' : 'en');
  const staleOnly = $<HTMLInputElement>('guideStaleOnly').checked;
  const stale = new Set(data.stale.professors);
  const list = data.professors.filter((p) => (!staleOnly || stale.has(p.id))
    && (!q || `${p.name} ${uniName(p.universityId)} ${p.department}`.toLocaleLowerCase(lang === 'tr' ? 'tr' : 'en').includes(q)));
  const host = $('guideProfList');
  if (!list.length) { host.innerHTML = emptyState(t('admin.guide.empty')); return; }
  host.innerHTML = list.map((p) => row({
    title: `${p.title} ${p.name}`.trim(),
    subtitle: `${uniName(p.universityId)}${p.department ? ` · ${p.department}` : ''}`,
    chips: [
      stale.has(p.id) ? chip(t('admin.guide.stale'), 'amber') : '',
      p.programmeIds.length ? '' : chip(t('admin.guide.noProgramme'), 'neutral'),
      p.openalexId ? '' : chip(t('admin.guide.noOpenalex'), 'neutral'),
    ].join(''),
    attrs: `data-prof="${escapeHtml(p.id)}"`,
    trailing: data!.canWrite
      ? `<button type="button" data-edit="${escapeHtml(p.id)}" class="${BTN.ghost}">${escapeHtml(t('admin.guide.edit'))}</button>
         <button type="button" data-delete="${escapeHtml(p.id)}" class="${BTN.danger}">${escapeHtml(t('admin.guide.delete'))}</button>`
      : '',
    stack: true,
  })).join('');
  host.querySelectorAll<HTMLButtonElement>('[data-edit]').forEach((b) => b.addEventListener('click', () => openProfessor(data!.professors.find((p) => p.id === b.dataset.edit) ?? null)));
  host.querySelectorAll<HTMLButtonElement>('[data-delete]').forEach((b) => armConfirm(b, t('admin.guide.confirmDelete'), async () => {
    if (await send(`/api/guide/professors?id=${encodeURIComponent(b.dataset.delete!)}`, 'DELETE')) await loadGuide();
  }));
}

function renderLabs() {
  if (!data) return;
  const host = $('guideLabList');
  const stale = new Set(data.stale.labs);
  if (!data.labs.length) { host.innerHTML = emptyState(t('admin.guide.emptyLabs')); return; }
  host.innerHTML = data.labs.map((l) => row({
    title: l.name,
    subtitle: uniName(l.universityId),
    chips: stale.has(l.id) ? chip(t('admin.guide.stale'), 'amber') : '',
    trailing: data!.canWrite
      ? `<button type="button" data-edit="${escapeHtml(l.id)}" class="${BTN.ghost}">${escapeHtml(t('admin.guide.edit'))}</button>
         <button type="button" data-delete="${escapeHtml(l.id)}" class="${BTN.danger}">${escapeHtml(t('admin.guide.delete'))}</button>`
      : '',
    stack: true,
  })).join('');
  host.querySelectorAll<HTMLButtonElement>('[data-edit]').forEach((b) => b.addEventListener('click', () => openLab(data!.labs.find((l) => l.id === b.dataset.edit) ?? null)));
  host.querySelectorAll<HTMLButtonElement>('[data-delete]').forEach((b) => armConfirm(b, t('admin.guide.confirmDelete'), async () => {
    if (await send(`/api/guide/labs?id=${encodeURIComponent(b.dataset.delete!)}`, 'DELETE')) await loadGuide();
  }));
}

function fillUniversities(select: HTMLSelectElement, value: string) {
  select.innerHTML = catalog.universities.map((u) => `<option value="${escapeHtml(u.id)}">${escapeHtml(`${u.name[lang]} (${u.city})`)}</option>`).join('');
  select.value = value;
}

function fillDependents(form: HTMLFormElement, uni: string, p: Professor | null) {
  const labs = (data?.labs ?? []).filter((l) => l.universityId === uni);
  const labSel = sel(form, 'labId');
  labSel.innerHTML = `<option value="">${escapeHtml(t('admin.guide.noLab'))}</option>` + labs.map((l) => `<option value="${escapeHtml(l.id)}">${escapeHtml(l.name)}</option>`).join('');
  labSel.value = p?.labId ?? '';
  const progSel = sel(form, 'programmeIds');
  progSel.innerHTML = catalog.programmes.filter((x) => x.universityId === uni)
    .map((x) => `<option value="${escapeHtml(x.id)}" ${p?.programmeIds.includes(x.id) ? 'selected' : ''}>${escapeHtml(x.name[lang])}</option>`).join('');
}

function openProfessor(p: Professor | null) {
  const form = $<HTMLFormElement>('guideProfForm');
  form.reset();
  const set = (name: string, v: string) => { (form.elements.namedItem(name) as HTMLInputElement).value = v; };
  set('id', p?.id ?? '');
  set('title', p?.title ?? '');
  set('name', p?.name ?? '');
  set('department', p?.department ?? '');
  set('profileUrl', p?.profileUrl ?? '');
  set('openalexId', p?.openalexId ?? '');
  set('source', p?.source ?? '');
  (form.elements.namedItem('handTopics') as HTMLTextAreaElement).value = (p?.handTopics ?? []).join('\n');
  const uni = p?.universityId ?? catalog.universities[0]?.id ?? '';
  fillUniversities(sel(form, 'universityId'), uni);
  fillDependents(form, uni, p);
  const hidden = new Set(p?.hiddenTopics ?? []);
  $('guideOpenalexTopics').innerHTML = (p?.openalexTopics ?? []).length
    ? p!.openalexTopics.map((x, i) => `<label class="inline-flex items-center gap-1 text-sm text-navy"><input type="checkbox" class="size-4" data-topic="${i}" ${hidden.has(x) ? '' : 'checked'} />${escapeHtml(x)}</label>`).join('')
    : `<span class="text-xs text-gray-500">${escapeHtml(t('admin.guide.noOpenalexTopics'))}</span>`;
  form.classList.remove('hidden');
  form.scrollIntoView({ block: 'nearest' });
}

function openLab(l: Lab | null) {
  const form = $<HTMLFormElement>('guideLabForm');
  form.reset();
  (form.elements.namedItem('id') as HTMLInputElement).value = l?.id ?? '';
  (form.elements.namedItem('name') as HTMLInputElement).value = l?.name ?? '';
  (form.elements.namedItem('url') as HTMLInputElement).value = l?.url ?? '';
  fillUniversities(sel(form, 'universityId'), l?.universityId ?? catalog.universities[0]?.id ?? '');
  form.classList.remove('hidden');
  form.scrollIntoView({ block: 'nearest' });
}

function wire() {
  if (wired) return;
  wired = true;
  $('guideProfSearch').addEventListener('input', renderProfessors);
  $('guideStaleOnly').addEventListener('change', renderProfessors);
  $('guideProfNew').addEventListener('click', () => openProfessor(null));
  $('guideLabNew').addEventListener('click', () => openLab(null));
  document.querySelectorAll<HTMLButtonElement>('[data-section="rehber"] [data-guide-cancel]').forEach((b) =>
    b.addEventListener('click', () => b.closest('form')!.classList.add('hidden')));
  const pf = $<HTMLFormElement>('guideProfForm');
  sel(pf, 'universityId').addEventListener('change', (e) => {
    const id = (pf.elements.namedItem('id') as HTMLInputElement).value;
    fillDependents(pf, (e.target as HTMLSelectElement).value, data?.professors.find((p) => p.id === id) ?? null);
  });
  pf.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = (n: string) => (pf.elements.namedItem(n) as HTMLInputElement).value;
    const id = v('id');
    const existing = data?.professors.find((p) => p.id === id) ?? null;
    const topics = existing?.openalexTopics ?? [];
    const hiddenTopics = topics.filter((_, i) => !(pf.querySelector<HTMLInputElement>(`[data-topic="${i}"]`)?.checked ?? true));
    const professor: Record<string, unknown> = {
      title: v('title'), name: v('name'), universityId: v('universityId'), department: v('department'),
      labId: v('labId') || null, profileUrl: v('profileUrl'), openalexId: v('openalexId') || null,
      handTopics: lines((pf.elements.namedItem('handTopics') as HTMLTextAreaElement).value), hiddenTopics,
      programmeIds: [...sel(pf, 'programmeIds').selectedOptions].map((o) => o.value),
      source: v('source'),
    };
    if (id) professor.id = id;
    if (!(pf.elements.namedItem('checkedNow') as HTMLInputElement).checked && existing) professor.checkedAt = existing.checkedAt;
    if (await send('/api/guide/professors', 'POST', { professor })) { pf.classList.add('hidden'); await loadGuide(); }
  });
  const lf = $<HTMLFormElement>('guideLabForm');
  lf.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = (n: string) => (lf.elements.namedItem(n) as HTMLInputElement).value;
    const lab: Record<string, unknown> = { name: v('name'), universityId: v('universityId'), url: v('url') };
    const existing = data?.labs.find((l) => l.id === v('id')) ?? null;
    if (existing) lab.id = existing.id;
    if (!(lf.elements.namedItem('checkedNow') as HTMLInputElement).checked && existing) lab.checkedAt = existing.checkedAt;
    if (await send('/api/guide/labs', 'POST', { lab })) { lf.classList.add('hidden'); await loadGuide(); }
  });
  $('guideRepublish').addEventListener('click', async () => {
    if (await send('/api/guide/professors?republish=1', 'POST', {})) await loadGuide();
  });
}

export async function loadGuide(): Promise<void> {
  wire();
  const [res, cat] = await Promise.all([fetch('/api/guide/professors'), fetch('/guide/catalog.json').catch(() => null)]);
  if (!res.ok) throw new Error(`guide ${res.status}`);
  data = await res.json();
  if (cat?.ok) catalog = await cat.json();
  $('guideProfNew').classList.toggle('hidden', !data!.canWrite);
  $('guideLabNew').classList.toggle('hidden', !data!.canWrite);
  renderState();
  renderProfessors();
  renderLabs();
}

interface Suggestion { id: number; recordId: string; kind: 'correction' | 'addition' | 'programme' | 'removal' | 'page_changed'; count: number; createdAt: number; text?: string; link?: string; submittedAt?: string }

/** The queue of Form suggestions. A person makes the change in the editor, then marks the row done. */
export async function loadSuggestions(): Promise<void> {
  const res = await fetch('/api/guide/suggestions');
  if (!res.ok) throw new Error(`suggestions ${res.status}`);
  const body = await res.json() as { rows: Suggestion[]; state: { checked_at: number | null; result: string | null; added: number | null } | null; watch: { unreadable: { url: string; failures: number }[]; muted: string[] }; canWrite: boolean };
  const st = body.state;
  $('guideImportState').textContent = st?.checked_at
    ? tf('admin.guide.suggestions.lastImport', { when: formatDate(st.checked_at), result: t(`admin.guide.import.${st.result ?? 'error'}` as never) })
    : t('admin.guide.suggestions.neverImported');
  const importNow = $<HTMLButtonElement>('guideImportNow');
  importNow.classList.toggle('hidden', !body.canWrite);
  importNow.onclick = async () => {
    importNow.disabled = true;
    try {
      const res = await fetch('/api/guide/import', { method: 'POST' });
      const out = await res.json().catch(() => ({})) as { sheet?: string; added?: number; error?: string };
      if (!res.ok) showToast(out.error || t('admin.toast.error'), true);
      else if (out.sheet !== 'ok') showToast(t(`admin.guide.import.${out.sheet ?? 'error'}` as never), true);
      else showToast(tf('admin.guide.suggestions.imported', { n: out.added ?? 0 }));
      await loadSuggestions();
    } finally { importNow.disabled = false; }
  };
  const pages = $('guideWatchList');
  const watchRows = [
    ...body.watch.unreadable.map((w) => ({ url: w.url, muted: false, note: tf('admin.guide.watch.unreadable', { n: w.failures }) })),
    ...body.watch.muted.map((url) => ({ url, muted: true, note: t('admin.guide.watch.muted') })),
  ];
  pages.innerHTML = watchRows.map((w) => row({
    title: w.url, subtitle: w.note,
    trailing: body.canWrite ? `<button type="button" data-watch="${escapeHtml(w.url)}" data-muted="${w.muted ? '0' : '1'}" class="${BTN.ghost}">${escapeHtml(t(w.muted ? 'admin.guide.watch.unmute' : 'admin.guide.watch.mute'))}</button>` : '',
    stack: true,
  })).join('');
  $('guideWatchHeading').classList.toggle('hidden', watchRows.length === 0);
  const mute = async (url: string, muted: boolean) => { if (await send('/api/guide/watch', 'POST', { url, muted })) await loadSuggestions(); };
  pages.querySelectorAll<HTMLButtonElement>('[data-watch]').forEach((b) => b.addEventListener('click', () => mute(b.dataset.watch!, b.dataset.muted === '1')));
  const host = $('guideSuggestionList');
  if (!body.rows.length) { host.innerHTML = emptyState(t('admin.guide.suggestions.empty')); return; }
  const who = (id: string) => data?.professors.find((p) => p.id === id)?.name ?? data?.labs.find((l) => l.id === id)?.name ?? id;
  host.innerHTML = body.rows.map((r) => {
    const actions = !body.canWrite ? '' : [
      r.kind === 'removal' && r.recordId.startsWith('p_') ? `<button type="button" data-remove="${r.id}" class="${BTN.danger}">${escapeHtml(t('admin.guide.suggestions.applyRemoval'))}</button>` : '',
      r.recordId.startsWith('p_') && r.kind !== 'removal' ? `<button type="button" data-open="${escapeHtml(r.recordId)}" class="${BTN.ghost}">${escapeHtml(t('admin.guide.edit'))}</button>` : '',
      r.kind === 'page_changed' && r.link ? `<button type="button" data-watch="${escapeHtml(r.link)}" data-muted="1" class="${BTN.ghost}">${escapeHtml(t('admin.guide.watch.mute'))}</button>` : '',
      `<button type="button" data-done="${r.id}" class="${BTN.ghost}">${escapeHtml(t('admin.guide.suggestions.done'))}</button>`,
      `<button type="button" data-discard="${r.id}" class="${BTN.ghost}">${escapeHtml(t('admin.guide.suggestions.discard'))}</button>`,
    ].join('');
    return `<div class="bg-white border border-border rounded-xl" data-row="${r.id}">` + row({
      title: `${t(`admin.guide.kind.${r.kind}` as never)}${r.recordId ? ` · ${who(r.recordId)}` : ''}`,
      subtitle: r.submittedAt ?? '',
      chips: [r.kind === 'removal' ? chip(t('admin.guide.suggestions.urgent'), 'red') : '', r.count > 1 ? chip(`×${r.count}`, 'neutral') : ''].join(''),
      trailing: actions,
      stack: true,
    }).replace('border border-border rounded-xl', 'rounded-xl') + suggestionBody(r.text, r.link) + '</div>';
  }).join('');
  const act = async (id: string, action: string) => {
    if (await send('/api/guide/suggestions', 'POST', { id: Number(id), action })) { await loadSuggestions(); if (action === 'applyRemoval') await loadGuide(); }
  };
  host.querySelectorAll<HTMLButtonElement>('[data-watch]').forEach((b) => b.addEventListener('click', () => mute(b.dataset.watch!, true)));
  host.querySelectorAll<HTMLButtonElement>('[data-done]').forEach((b) => b.addEventListener('click', () => act(b.dataset.done!, 'done')));
  host.querySelectorAll<HTMLButtonElement>('[data-discard]').forEach((b) => b.addEventListener('click', () => act(b.dataset.discard!, 'discard')));
  host.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach((b) => b.addEventListener('click', () => openRemovalNotice(host, b.dataset.remove!, body.rows)));
  host.querySelectorAll<HTMLButtonElement>('[data-open]').forEach((b) => b.addEventListener('click', () => {
    location.hash = '#rehber/hocalar';
    openProfessor(data?.professors.find((p) => p.id === b.dataset.open) ?? null);
  }));
}

/**
 * A removal request opens a box under its row: the approver finds the
 * professor's address on their university page, checks the prepared text,
 * and one click removes the record and sends the notice
 * (functions/_lib/guide-removal-notice.ts). Without an address they can still
 * remove, after a confirm.
 */
function openRemovalNotice(host: HTMLElement, rowId: string, rows: Suggestion[]): void {
  const wrap = host.querySelector<HTMLElement>(`[data-row="${rowId}"]`);
  if (!wrap) return;
  const open = wrap.querySelector<HTMLFormElement>('[data-notice-form]');
  if (open) { open.querySelector<HTMLInputElement>('[name="to"]')?.focus(); return; }
  const r = rows.find((x) => String(x.id) === rowId);
  const p = data?.professors.find((x) => x.id === r?.recordId);
  wrap.insertAdjacentHTML('beforeend', removalNoticeForm(Number(rowId), removalNoticeTemplate(p?.title ?? '', p?.name ?? ''), {
    to: t('admin.guide.notice.to'), hint: t('admin.guide.notice.hint'), subject: t('admin.guide.notice.subject'), text: t('admin.guide.notice.text'),
    send: t('admin.guide.notice.send'), skip: t('admin.guide.notice.skip'), cancel: t('admin.guide.notice.cancel'),
  }));
  const form = wrap.querySelector<HTMLFormElement>('[data-notice-form]')!;
  const to = form.querySelector<HTMLInputElement>('[name="to"]')!;
  to.focus();
  const run = async (notice?: { to: string; subject: string; text: string }) => {
    form.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    try {
      const res = await fetch('/api/guide/suggestions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: Number(rowId), action: 'applyRemoval', notice }) });
      const out = await res.json().catch(() => ({})) as { error?: string; code?: string; notice?: 'none' | 'sent' | 'failed'; publish?: { ok: boolean } };
      if (!res.ok) {
        showToast(out.code === 'bad_notice' ? t('admin.guide.notice.badAddress') : out.code === 'notice_limit' ? t('admin.guide.notice.limit') : out.error || t('admin.toast.error'), true);
        return;
      }
      if (out.notice === 'failed') showToast(t('admin.guide.notice.failed'), true);
      else if (out.publish && !out.publish.ok) showToast(t('admin.guide.publishFailed'), true);
      else showToast(out.notice === 'sent' ? t('admin.guide.notice.sent') : t('admin.toast.updated'));
      await loadSuggestions();
      await loadGuide();
    } finally { form.querySelectorAll('button').forEach((b) => { b.disabled = false; }); }
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const address = to.value.trim();
    if (!to.checkValidity() || !address || /[,;\s]/.test(address)) { showToast(t('admin.guide.notice.badAddress'), true); to.focus(); return; }
    const fd = new FormData(form);
    void run({ to: address, subject: String(fd.get('subject') ?? ''), text: String(fd.get('text') ?? '') });
  });
  armConfirm(form.querySelector<HTMLButtonElement>('[data-notice-skip]')!, t('admin.guide.confirmDelete'), () => run());
  form.querySelector('[data-notice-cancel]')!.addEventListener('click', () => form.remove());
}
