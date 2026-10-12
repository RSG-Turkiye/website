/**
 * The Certificates section of the symposium pane. Kept out of admin-panel.ts
 * (already 1600+ lines); that file hands in its helpers through CertDeps.
 */
import { decodeCsv, parseCsv, planUpload, type PlannedRow } from '../lib/certificate-csv';
import { compressPdf, type Method } from './pdf-compress';

export interface CertDeps {
  t: (key: string) => string;
  tf: (key: string, vars: Record<string, string | number>) => string;
  showToast: (message: string, isError?: boolean) => void;
  showRebuildStatus: (elId: string, rebuild: { state?: 'started' | 'queued' | 'failed'; detail: string }) => void;
  formatDate: (ts: number) => string;
}

const MAX_BYTES = 10 * 1024 * 1024;
type Prepared = PlannedRow & {
  bytes?: Uint8Array; originalSize?: number; method?: Method; fileProblem?: 'not_pdf' | 'too_large';
  compressError?: string; uploaded?: boolean; uploadError?: string;
};

let deps: CertDeps;
let prepared: Prepared[] = [];
// One check or upload at a time: a second click on either would run a second
// loop over the same rows (two uploads per certificate) or swap the rows out
// from under an upload that is still going.
let busy = false;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(n < 1024 * 1024 ? 2 : 1)} MB`;
const year = () => Number($<HTMLInputElement>('symCertYear').value);

function cell(text: string, cls = ''): HTMLTableCellElement {
  const td = document.createElement('td');
  td.className = `px-3 py-2 text-sm ${cls}`;
  td.textContent = text;
  return td;
}

/** appendChild, not append: the Workers types this project also loads
 * redeclare Element.append (HTMLRewriter's), which hides the DOM one. */
function appendAll(parent: HTMLElement, children: HTMLElement[]): void {
  for (const child of children) parent.appendChild(child);
}

function problemsOf(r: Prepared): string[] {
  const keys: string[] = [...r.problems];
  if (r.fileProblem) keys.push(r.fileProblem);
  return keys.map((k) => deps.t(`admin.symposium.certificates.problem.${k}`));
}

function renderPreview(unused: string[]): void {
  const body = $('symCertPreviewBody');
  body.replaceChildren();
  for (const r of prepared) {
    const tr = document.createElement('tr');
    const problems = problemsOf(r);
    const size = r.bytes && r.originalSize ? `${mb(r.originalSize)} → ${mb(r.bytes.length)}` : '';
    const status = r.uploaded ? deps.t('admin.symposium.certificates.status.uploaded')
      : r.uploadError ? r.uploadError
      : problems.length ? problems.join(', ')
      : r.compressError ? deps.t('admin.symposium.certificates.status.compressFailed')
      : deps.t('admin.symposium.certificates.status.ready');
    appendAll(tr, [
      cell(r.email), cell(r.name),
      cell(r.kind ? deps.t(`admin.symposium.certificates.kind.${r.kind}`) : r.type),
      cell(size),
      cell(status, problems.length || r.uploadError ? 'text-red-600' : r.uploaded ? 'text-green-700' : ''),
    ]);
    body.appendChild(tr);
  }
  $('symCertPreview').classList.remove('hidden');
  const unusedEl = $('symCertUnused');
  unusedEl.textContent = unused.length ? deps.tf('admin.symposium.certificates.unused', { files: unused.join(', ') }) : '';
  unusedEl.classList.toggle('hidden', unused.length === 0);
  const ready = uploadable().length;
  const button = $<HTMLButtonElement>('symCertUpload');
  button.textContent = deps.tf('admin.symposium.certificates.upload', { count: ready });
  // Hidden while a check or an upload is running, not only when nothing is
  // ready: offering "Upload 3" halfway through compressing ten files invites
  // an upload of the first three.
  button.classList.toggle('hidden', ready === 0 || busy);
}

/** Runs one check or upload, with both buttons locked for its duration. */
async function exclusive(work: () => Promise<void>): Promise<void> {
  if (busy) return;
  busy = true;
  const check = $<HTMLButtonElement>('symCertCheck');
  const upload = $<HTMLButtonElement>('symCertUpload');
  check.disabled = upload.disabled = true;
  upload.classList.add('hidden');
  try {
    await work();
  } finally {
    busy = false;
    check.disabled = upload.disabled = false;
    if (prepared.length) renderPreview(lastUnused);
  }
}

let lastUnused: string[] = [];

const uploadable = () => prepared.filter((r) => r.problems.length === 0 && !r.fileProblem && r.bytes && !r.uploaded);

async function check(): Promise<void> {
  const csvFile = $<HTMLInputElement>('symCertCsv').files?.[0];
  const pdfs = [...($<HTMLInputElement>('symCertPdfs').files ?? [])];
  const errorEl = $('symCertCsvError');
  errorEl.classList.add('hidden');
  // A new check starts from nothing: a CSV that fails to parse must not leave
  // the previous batch on screen with an Upload button beside the error.
  prepared = [];
  lastUnused = [];
  $('symCertPreview').classList.add('hidden');
  $('symCertUnused').classList.add('hidden');
  if (!csvFile) return;
  const parsed = parseCsv(decodeCsv(await csvFile.arrayBuffer()));
  if ('error' in parsed) {
    errorEl.textContent = parsed.error === 'missing_columns'
      ? deps.tf('admin.symposium.certificates.csvError.missing_columns', { columns: (parsed.missing ?? []).join(', ') })
      : deps.t('admin.symposium.certificates.csvError.empty');
    errorEl.classList.remove('hidden');
    return;
  }
  const plan = planUpload(parsed.rows, pdfs.map((f) => f.name));
  const byName = new Map(pdfs.map((f) => [f.name, f]));
  const rasterise = $<HTMLInputElement>('symCertRasterise').checked;
  prepared = plan.rows.map((r) => ({ ...r }));
  lastUnused = plan.unusedFiles;
  renderPreview(plan.unusedFiles);
  for (const r of prepared) {
    if (r.problems.length) continue;
    const file = byName.get(r.file)!;
    const raw = await file.arrayBuffer();
    r.originalSize = raw.byteLength;
    if (new TextDecoder().decode(new Uint8Array(raw, 0, Math.min(5, raw.byteLength))) !== '%PDF-') {
      r.fileProblem = 'not_pdf';
    } else {
      const result = await compressPdf(raw, { rasterise });
      r.bytes = result.bytes;
      r.method = result.method;
      r.compressError = result.error;
      if (result.bytes.length > MAX_BYTES) r.fileProblem = 'too_large';
    }
    renderPreview(plan.unusedFiles);
  }
}

async function upload(): Promise<void> {
  const rows = uploadable();
  const progress = $('symCertProgress');
  progress.classList.remove('hidden');
  let ok = 0, failed = 0;
  for (const [i, r] of rows.entries()) {
    progress.textContent = deps.tf('admin.symposium.certificates.progress', { done: i, total: rows.length });
    try {
      const res = await fetch('/api/admin/certificates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/pdf',
          'X-Cert-Year': String(year()),
          'X-Cert-Email': encodeURIComponent(r.email),
          'X-Cert-Name': encodeURIComponent(r.name),
          'X-Cert-Type': r.kind!,
        },
        body: new Blob([r.bytes as BlobPart], { type: 'application/pdf' }),
      });
      if (res.ok) { r.uploaded = true; ok++; }
      else { r.uploadError = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`; failed++; }
    } catch (err) {
      r.uploadError = String(err).slice(0, 80);
      failed++;
    }
    renderPreview(lastUnused);
  }
  progress.textContent = deps.tf('admin.symposium.certificates.done', { ok, failed });
  if (ok > 0) await rebuild();
  await loadCertificates();
}

async function rebuild(): Promise<void> {
  const res = await fetch('/api/admin/certificates/rebuild', { method: 'POST' });
  if (res.ok) deps.showRebuildStatus('symCertRebuildStatus', ((await res.json()) as { rebuild: { state: 'started' | 'queued' | 'failed'; detail: string } }).rebuild);
}

export async function loadCertificates(): Promise<void> {
  const res = await fetch(`/api/admin/certificates?year=${year()}`);
  if (!res.ok) return;
  const { certificates, totalBytes } = (await res.json()) as {
    certificates: { id: string; email: string; name: string; kind: string; size_bytes: number; expires_at: number }[];
    totalBytes: number;
  };
  const body = $('symCertListBody');
  body.replaceChildren();
  for (const c of certificates) {
    const tr = document.createElement('tr');
    const actions = document.createElement('td');
    actions.className = 'px-3 py-2 text-right';
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'text-xs text-red-600 hover:underline';
    del.textContent = deps.t('admin.symposium.certificates.delete');
    del.addEventListener('click', async () => {
      const r = await fetch(`/api/admin/certificates/${c.id}`, { method: 'DELETE' });
      if (r.ok) { deps.showToast(deps.t('admin.toast.deleted')); await loadCertificates(); }
      else deps.showToast(`HTTP ${r.status}`, true);
    });
    actions.appendChild(del);
    appendAll(tr, [cell(c.email), cell(c.name), cell(deps.t(`admin.symposium.certificates.kind.${c.kind}`)),
      cell(mb(c.size_bytes)), cell(deps.formatDate(c.expires_at)), actions]);
    body.appendChild(tr);
  }
  $('symCertEmpty').classList.toggle('hidden', certificates.length > 0);
  $('symCertSummary').textContent = deps.tf('admin.symposium.certificates.stored', { count: certificates.length, size: mb(totalBytes) });
  $('symCertDeleteAll').textContent = deps.tf('admin.symposium.certificates.deleteAll', { year: year() });
  $<HTMLInputElement>('symCertDeleteAllInput').placeholder = deps.tf('admin.symposium.certificates.deleteAllConfirm', { year: year() });
}

export function setupCertificates(d: CertDeps): void {
  deps = d;
  $<HTMLInputElement>('symCertYear').value = String(new Date().getFullYear());
  $('symCertForm').addEventListener('submit', (e) => { e.preventDefault(); void exclusive(check); });
  $('symCertUpload').addEventListener('click', () => void exclusive(upload));
  $('symCertYear').addEventListener('change', () => void loadCertificates());
  const confirmInput = $<HTMLInputElement>('symCertDeleteAllInput');
  const deleteAll = $<HTMLButtonElement>('symCertDeleteAll');
  confirmInput.addEventListener('input', () => { deleteAll.disabled = confirmInput.value.trim() !== String(year()); });
  deleteAll.addEventListener('click', async () => {
    if (confirmInput.value.trim() !== String(year())) return;
    const res = await fetch(`/api/admin/certificates?year=${year()}`, { method: 'DELETE' });
    if (!res.ok) { deps.showToast(`HTTP ${res.status}`, true); return; }
    confirmInput.value = '';
    deleteAll.disabled = true;
    deps.showToast(deps.t('admin.toast.deleted'));
    await rebuild();
    await loadCertificates();
  });
}
