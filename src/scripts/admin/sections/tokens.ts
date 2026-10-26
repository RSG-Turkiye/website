/**
 * The Agent tokens section (TokensPane.astro). The server says which areas
 * one may scope a token to (`areas`), so nothing here decides a right. The
 * value of a new token lives only in this page's memory and the box that
 * shows it; it is never stored, and a reload drops it for good.
 *
 * A connected app (Claude, ChatGPT: `kind` 'oauth') is a token the member
 * never saw. It is listed apart and "disconnected" rather than "revoked",
 * but it is the same row and the same DELETE.
 */
import { t, tf, formatDate, showToast } from '../context';
import { escapeHtml } from '../../escape-html';
import { armConfirm, BTN, chip, emptyState, row } from '../ui-kit';

type Status = 'live' | 'expired' | 'revoked';
interface Token {
  id: string; kind?: 'pat' | 'oauth'; label: string; hint: string; scopes: string[];
  created_at: number; expires_at: number; last_used_at: number | null;
  revoked_at: number | null; revoke_reason: string | null; status: Status;
  user_id?: string; display_name?: string | null;
}

const tt = (key: string) => t(key as never);
const ERRORS = ['too_many_tokens', 'scope_not_held', 'invalid'];
const STATUS_TONE = { live: 'green', expired: 'neutral', revoked: 'red' } as const;
/** Reasons agent-limits.ts and the OAuth refresh give when the site itself revokes. */
const AUTO_REASONS = ['refresh_reuse', 'flood', 'refusals', 'leaked'];
const isApp = (tok: Token) => tok.kind === 'oauth';

const areaName = (area: string) =>
  area === 'social' ? tt('admin.tokens.area.social') : area.startsWith('cms.') ? tt(`admin.cms.groupName.${area.slice(4)}`) : area;
const levelName = (level: string) => tt(level === 'draft' ? 'admin.tokens.create.level.draft' : 'admin.tokens.create.level.read');
function scopeName(scope: string): string {
  const [area, level] = scope.split(':');
  return `${areaName(area)}: ${levelName(level ?? 'read')}`;
}

const isTokens = (v: unknown): v is Token[] => Array.isArray(v) && v.every((x) => x && typeof x === 'object' && typeof (x as Token).id === 'string');

function tokenRow(tok: Token, owner: boolean): string {
  const app = isApp(tok);
  // An app's access token changes every hour, so its last characters identify nothing.
  const meta = [
    ...(app ? [] : [tf('admin.tokens.row.hint' as never, { hint: tok.hint })]),
    tf((app ? 'admin.tokens.apps.row.connected' : 'admin.tokens.row.created') as never, { date: formatDate(tok.created_at) }),
    ...(tok.status === 'live' ? [tf('admin.tokens.row.expires' as never, { date: formatDate(tok.expires_at) })] : []),
    tok.last_used_at ? tf('admin.tokens.row.lastUsed' as never, { date: formatDate(tok.last_used_at) }) : tt('admin.tokens.row.neverUsed'),
    ...(tok.revoke_reason === 'admin' ? [tt('admin.tokens.row.revokedByAdmin')] : []),
    ...(tok.revoke_reason && AUTO_REASONS.includes(tok.revoke_reason) ? [tt('admin.tokens.row.revokedAuto')] : []),
  ];
  const who = owner ? `${tok.display_name || tt('admin.tokens.all.unknownOwner')}: ` : '';
  return row({
    title: who + tok.label,
    subtitle: meta.join(', '),
    chips: chip(tt(`admin.tokens.status.${tok.status}`), STATUS_TONE[tok.status])
      + (owner && app ? chip(tt('admin.tokens.kind.app')) : '')
      + (tok.scopes ?? []).map((s) => chip(scopeName(s), 'navy')).join(''),
    trailing: tok.status === 'live'
      ? `<button type="button" class="${BTN.danger}" data-revoke="${escapeHtml(tok.id)}" data-app="${app ? '1' : ''}">${escapeHtml(tt(app ? 'admin.tokens.apps.disconnect' : 'admin.tokens.revoke'))}</button>` : '',
    attrs: `data-token="${escapeHtml(tok.id)}"`,
    stack: true,
  });
}

function renderList(host: HTMLElement, tokens: Token[], none: string, owner: boolean): void {
  host.innerHTML = tokens.length ? tokens.map((tok) => tokenRow(tok, owner)).join('') : emptyState(tt(none));
  host.querySelectorAll<HTMLButtonElement>('[data-revoke]').forEach((b) => {
    const app = b.dataset.app === '1';
    armConfirm(b, tt(app ? 'admin.tokens.apps.disconnectConfirm' : 'admin.tokens.revokeConfirm'), () => revoke(b.dataset.revoke!, app));
  });
}

function renderAreas(areas: string[]): void {
  const host = document.getElementById('tokensAreas')!;
  const checked = new Set([...host.querySelectorAll<HTMLInputElement>('[data-area]:checked')].map((i) => i.dataset.area));
  host.innerHTML = areas.map((area, i) => {
    const name = escapeHtml(areaName(area));
    const a = escapeHtml(area);
    return `<div class="flex flex-wrap items-center gap-x-3 gap-y-1 py-1 border-b border-border last:border-0">
      <label class="flex-1 min-w-40 flex items-center gap-2 min-h-11 lg:min-h-9 text-sm text-navy cursor-pointer">
        <input type="checkbox" data-area="${a}" ${checked.has(area) ? 'checked' : ''} class="w-4 h-4 accent-navy" />${name}
      </label>
      <select data-level-for="${a}" aria-label="${escapeHtml(tf('admin.tokens.create.level' as never, { area: areaName(area) }))}"
        id="tokensLevel${i}" class="px-3 py-2 lg:py-1.5 min-h-11 lg:min-h-9 rounded-xl border border-border bg-white text-sm text-navy focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-mid">
        <option value="draft">${escapeHtml(levelName('draft'))}</option>
        <option value="read">${escapeHtml(levelName('read'))}</option>
      </select>
    </div>`;
  }).join('');
  document.getElementById('tokensAreasNone')!.classList.toggle('hidden', areas.length > 0);
  (document.getElementById('tokensSubmit') as HTMLButtonElement).disabled = areas.length === 0;
}

async function refresh(): Promise<void> {
  const res = await fetch('/api/agent-tokens');
  if (!res.ok) throw new Error(`agent tokens ${res.status}`);
  const data = await res.json() as { mine?: unknown; areas?: unknown; all?: unknown };
  renderAreas(Array.isArray(data.areas) ? data.areas.filter((a): a is string => typeof a === 'string') : []);
  const mine = isTokens(data.mine) ? data.mine : [];
  renderList(document.getElementById('tokensMine')!, mine.filter((tok) => !isApp(tok)), 'admin.tokens.mine.none', false);
  renderList(document.getElementById('tokensApps')!, mine.filter(isApp), 'admin.tokens.apps.none', false);
  const allWrap = document.getElementById('tokensAllWrap')!;
  allWrap.classList.toggle('hidden', !isTokens(data.all));
  if (isTokens(data.all)) renderList(document.getElementById('tokensAll')!, data.all, 'admin.tokens.all.none', true);
}

async function revoke(id: string, app: boolean): Promise<void> {
  const res = await fetch(`/api/agent-tokens/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => null);
  if (!res?.ok) { showToast(tt(app ? 'admin.tokens.apps.disconnectFailed' : 'admin.tokens.revokeFailed'), true); return; }
  showToast(tt(app ? 'admin.tokens.apps.disconnected' : 'admin.tokens.revoked'));
  await refresh().catch(() => showToast(tt('admin.tokens.loadFailed'), true));
}

function showValue(value: string | null): void {
  const box = document.getElementById('tokensShown')!;
  document.getElementById('tokensShownValue')!.textContent = value ?? '';
  box.classList.toggle('hidden', value === null);
  if (value !== null) box.scrollIntoView({ block: 'nearest' });
}

async function create(form: HTMLFormElement): Promise<void> {
  const label = (document.getElementById('tokensLabel') as HTMLInputElement).value.trim();
  const scopes = [...form.querySelectorAll<HTMLInputElement>('[data-area]:checked')].map((box) => {
    const level = (form.querySelector(`[data-level-for="${CSS.escape(box.dataset.area!)}"]`) as HTMLSelectElement | null)?.value ?? 'read';
    return `${box.dataset.area}:${level}`;
  });
  if (!label) { showToast(tt('admin.tokens.error.invalid'), true); return; }
  if (!scopes.length) { showToast(tt('admin.tokens.create.pickArea'), true); return; }
  const days = Number((document.getElementById('tokensDays') as HTMLSelectElement | null)?.value ?? 30);
  const submit = document.getElementById('tokensSubmit') as HTMLButtonElement;
  submit.disabled = true;
  try {
    const res = await fetch('/api/agent-tokens', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label, scopes, days }),
    });
    const body = await res.json().catch(() => ({})) as { value?: unknown; code?: unknown };
    if (res.status !== 201 || typeof body.value !== 'string') {
      const code = typeof body.code === 'string' && ERRORS.includes(body.code) ? body.code : null;
      showToast(tt(code ? `admin.tokens.error.${code}` : 'admin.tokens.create.failed'), true);
      return;
    }
    form.reset();
    form.querySelectorAll<HTMLInputElement>('[data-area]').forEach((box) => { box.checked = false; });
    showValue(body.value);
    document.getElementById('tokensCreatedNote')!.textContent = tt('admin.tokens.created');
    await refresh().catch(() => showToast(tt('admin.tokens.loadFailed'), true));
  } catch {
    showToast(tt('admin.tokens.create.failed'), true);
  } finally {
    submit.disabled = !form.querySelector('[data-area]');
  }
}

let wired = false;
function wire(): void {
  if (wired) return;
  wired = true;
  const form = document.getElementById('tokensCreate') as HTMLFormElement;
  form.addEventListener('submit', (e) => { e.preventDefault(); void create(form); });
  document.getElementById('tokensCopy')!.addEventListener('click', async () => {
    const value = document.getElementById('tokensShownValue')!.textContent ?? '';
    try { await navigator.clipboard.writeText(value); showToast(tt('admin.tokens.shown.copied')); }
    catch { showToast(tt('admin.tokens.shown.copyFailed'), true); }
  });
  document.getElementById('tokensShownDone')!.addEventListener('click', () => {
    showValue(null);
    document.getElementById('tokensCreatedNote')!.textContent = '';
  });
}

/** Runs the first time the section shows (main.ts). */
export async function loadTokens(): Promise<void> {
  if (!document.querySelector('[data-section="anahtarlar"]')) return;
  wire();
  await refresh();
}
