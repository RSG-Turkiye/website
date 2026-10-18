/**
 * The Connections pane (admins only). One row per platform; Gmail, Instagram, LinkedIn and X
 * can be connected. Reconnect is a plain link: the browser goes to
 * /api/admin/connections/<platform>/start and on to the provider, and comes
 * back to /admin?connected=<platform>. LinkedIn and X can instead be
 * connected through Buffer: a POST, no provider page, and a short list to
 * choose from when Buffer has more than one fitting channel.
 */
import { escapeHtml } from './escape-html';
import { formatDateTime, formatDay } from './format-time';
import { row as uiRow, chip, BTN, armConfirm } from './admin/ui-kit';

export interface ConnDeps {
  t: (key: string) => string;
  showToast: (message: string, isError?: boolean) => void;
  lang: 'en' | 'tr';
}

type Conn = {
  platform: 'gmail' | 'instagram' | 'linkedin' | 'x';
  status: 'connected' | 'expiring' | 'broken' | 'unused';
  accountName: string | null;
  connectedBy: string | null;
  connectedAt: number | null;
  lastOkAt: number | null;
  lastError: string | null;
  usesLegacySecret: boolean;
  hasStoredToken: boolean;
  expiresAt: number | null;
  via: 'buffer' | null;
};

const BUFFER_ERRORS = ['buffer_not_configured', 'buffer_auth', 'buffer_unavailable', 'no_channel', 'unknown_channel'];
const viaBufferPossible = (p: Conn['platform']) => p === 'linkedin' || p === 'x';

const STATUS_TONE = { connected: 'green', expiring: 'amber', broken: 'red', unused: 'neutral' } as const;

let deps: ConnDeps;

export function setupConnections(d: ConnDeps): void {
  deps = d;
}

function actions(c: Conn): string {
  const urgent = c.status === 'broken' || c.status === 'expiring';
  const label = deps.t(c.status === 'unused' ? 'admin.connections.connect' : 'admin.connections.reconnect');
  const connect = `<a href="/api/admin/connections/${c.platform}/start?lang=${deps.lang}" class="${urgent ? BTN.danger : BTN.secondary}">${escapeHtml(label)}</a>`;
  const buffer = viaBufferPossible(c.platform)
    ? `<button type="button" data-buffer-connect="${c.platform}" class="${urgent && c.via === 'buffer' ? BTN.danger : BTN.secondary}">${escapeHtml(deps.t(c.via === 'buffer' ? 'admin.connections.reconnectBuffer' : 'admin.connections.connectBuffer'))}</button>`
    : '';
  const disconnect = c.hasStoredToken
    ? `<button type="button" data-disconnect="${c.platform}" class="${BTN.danger}">${escapeHtml(deps.t('admin.connections.disconnect'))}</button>`
    : '';
  // A Buffer connection is renewed through Buffer; the direct link stays for the other case.
  return (c.via === 'buffer' ? '' : connect) + buffer + disconnect;
}

function row(c: Conn): string {
  const keyUnknown = c.via === 'buffer' && c.expiresAt === null;
  const note = c.status === 'broken' && c.lastError ? c.lastError
    : c.usesLegacySecret ? deps.t('admin.connections.legacy')
    : keyUnknown ? deps.t('admin.connections.bufferKeyUnknown') : '';
  const name = c.accountName ? (c.platform === 'instagram' || (c.platform === 'x' && c.via !== 'buffer') ? `@${c.accountName}` : c.accountName) : '';
  const account = [name, c.via === 'buffer' ? deps.t('admin.connections.viaBuffer') : '', c.via === 'buffer' && c.expiresAt
    ? deps.t('admin.connections.bufferKeyEnds').replace('{date}', formatDay(c.expiresAt, deps.lang)) : ''].filter(Boolean).join(' · ');
  const by = c.connectedBy ? `${deps.t('admin.connections.col.connectedBy')}: ${c.connectedBy}${c.connectedAt ? ` · ${formatDateTime(c.connectedAt, deps.lang)}` : ''}` : '';
  const last = c.lastOkAt ? `${deps.t('admin.connections.col.lastOk')}: ${formatDateTime(c.lastOkAt, deps.lang)}` : '';
  return uiRow({
    title: deps.t(`admin.connections.platform.${c.platform}`),
    subtitle: [account, by, last].filter(Boolean).join(' · '),
    chips: chip(deps.t(`admin.connections.status.${c.status}`), STATUS_TONE[c.status]) + (note ? `<span class="text-xs text-gray-500 min-w-0 max-w-full break-all">${escapeHtml(note)}</span>` : ''),
    trailing: actions(c),
    attrs: `data-platform="${c.platform}"`,
    stack: true,
  });
}

async function disconnect(button: HTMLButtonElement): Promise<void> {
  const res = await fetch(`/api/admin/connections/${button.dataset.disconnect}`, { method: 'DELETE' });
  if (!res.ok) {
    deps.showToast(deps.t('admin.connections.disconnectFailed'), true);
    return;
  }
  await loadConnections();
}

export async function loadConnections(): Promise<void> {
  const body = document.getElementById('connectionsBody');
  if (!body) return;
  const res = await fetch('/api/admin/connections');
  if (!res.ok) {
    deps.showToast(deps.t('admin.connections.loadFailed'), true);
    return;
  }
  const { connections } = await res.json() as { connections: Conn[] };
  body.innerHTML = connections.map(row).join('');
  body.querySelectorAll<HTMLButtonElement>('[data-disconnect]').forEach((b) => armConfirm(b, deps.t('admin.connections.disconnectConfirm'), () => disconnect(b)));
  body.querySelectorAll<HTMLButtonElement>('[data-buffer-connect]').forEach((b) => b.addEventListener('click', () => connectBuffer(b.dataset.bufferConnect!, null, b)));
}

/** Asks the server to save the Buffer channel for this platform; with several to choose from, lists them under the row. */
async function connectBuffer(platform: string, channelId: string | null, button: HTMLButtonElement): Promise<void> {
  button.disabled = true;
  let res: Response;
  try {
    res = await fetch(`/api/admin/connections/${platform}/buffer`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(channelId ? { channelId } : {}),
    });
  } catch {
    button.disabled = false;
    deps.showToast(deps.t('admin.connections.error.buffer_unavailable'), true);
    return;
  }
  const data = await res.json().catch(() => ({})) as { ok?: boolean; code?: string; choose?: { id: string; name: string }[] };
  button.disabled = false;
  if (data.choose) {
    showChoices(platform, data.choose);
    return;
  }
  if (!res.ok || !data.ok) {
    const code = data.code === 'not_configured' ? 'buffer_not_configured' : data.code ?? '';
    deps.showToast(deps.t(`admin.connections.error.${BUFFER_ERRORS.includes(code) ? code : 'unknown'}`), true);
    return;
  }
  deps.showToast(deps.t('admin.connections.connected').replace('{platform}', deps.t(`admin.connections.platform.${platform}`)));
  await loadConnections();
}

function showChoices(platform: string, choices: { id: string; name: string }[]): void {
  const rowEl = document.querySelector<HTMLElement>(`#connectionsBody [data-platform="${platform}"]`);
  if (!rowEl) return;
  rowEl.parentElement?.querySelector(`[data-buffer-choices="${platform}"]`)?.remove();
  const box = document.createElement('div');
  box.dataset.bufferChoices = platform;
  box.className = 'flex flex-wrap items-center gap-2 px-4 py-3 lg:px-3 lg:py-2 border border-border rounded-xl bg-white';
  box.innerHTML = `<p class="w-full text-xs text-gray-500">${escapeHtml(deps.t('admin.connections.chooseChannel'))}</p>`
    + choices.map((c) => `<button type="button" data-channel="${escapeHtml(c.id)}" class="${BTN.secondary}">${escapeHtml(c.name)}</button>`).join('');
  rowEl.insertAdjacentElement('afterend', box);
  box.querySelectorAll<HTMLButtonElement>('[data-channel]').forEach((b) => b.addEventListener('click', () => connectBuffer(platform, b.dataset.channel!, b)));
}
