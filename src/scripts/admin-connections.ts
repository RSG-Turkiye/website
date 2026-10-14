/**
 * The Connections pane (admins only). One row per platform; Gmail, Instagram, LinkedIn and X
 * can be connected. Reconnect is a plain link: the browser goes to
 * /api/admin/connections/<platform>/start and on to the provider, and comes
 * back to /admin?connected=<platform>.
 */
import { escapeHtml } from './escape-html';
import { formatDateTime } from './format-time';
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
};

const STATUS_TONE = { connected: 'green', expiring: 'amber', broken: 'red', unused: 'neutral' } as const;

let deps: ConnDeps;

export function setupConnections(d: ConnDeps): void {
  deps = d;
}

function actions(c: Conn): string {
  const urgent = c.status === 'broken' || c.status === 'expiring';
  const label = deps.t(c.status === 'unused' ? 'admin.connections.connect' : 'admin.connections.reconnect');
  const connect = `<a href="/api/admin/connections/${c.platform}/start?lang=${deps.lang}" class="${urgent ? BTN.danger : BTN.secondary}">${escapeHtml(label)}</a>`;
  const disconnect = c.hasStoredToken
    ? `<button type="button" data-disconnect="${c.platform}" class="${BTN.danger}">${escapeHtml(deps.t('admin.connections.disconnect'))}</button>`
    : '';
  return connect + disconnect;
}

function row(c: Conn): string {
  const note = c.status === 'broken' && c.lastError ? c.lastError : c.usesLegacySecret ? deps.t('admin.connections.legacy') : '';
  const account = c.accountName ? (c.platform === 'instagram' || c.platform === 'x' ? `@${c.accountName}` : c.accountName) : '';
  const by = c.connectedBy ? `${deps.t('admin.connections.col.connectedBy')}: ${c.connectedBy}${c.connectedAt ? ` · ${formatDateTime(c.connectedAt, deps.lang)}` : ''}` : '';
  const last = c.lastOkAt ? `${deps.t('admin.connections.col.lastOk')}: ${formatDateTime(c.lastOkAt, deps.lang)}` : '';
  return uiRow({
    title: deps.t(`admin.connections.platform.${c.platform}`),
    subtitle: [account, by, last].filter(Boolean).join(' · '),
    chips: chip(deps.t(`admin.connections.status.${c.status}`), STATUS_TONE[c.status]) + (note ? `<span class="text-xs text-gray-500 min-w-0 max-w-full break-all">${escapeHtml(note)}</span>` : ''),
    trailing: actions(c),
    attrs: `data-platform="${c.platform}"`,
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
}
