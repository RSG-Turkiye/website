/**
 * The Guide section (src/components/admin/panes/GuidePane.astro): the graduate
 * guide's professors and labs, from /api/guide/professors. Rehber editors
 * read; approvers and admins add, edit, delete and republish. Universities
 * and programmes for the selects come from /guide/catalog.json.
 */
import { escapeHtml } from '../../escape-html';
import { t, tf, showToast, formatDate, lang } from '../context';
import { row, chip, BTN, armConfirm, emptyState } from '../ui-kit';

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
