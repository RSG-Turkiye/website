/**
 * The Connections pane (admins only). One row per platform; Gmail is the only
 * one that can be connected in this phase. Reconnect is a plain link: the
 * browser goes to /api/admin/connections/gmail/start and on to Google, and
 * comes back to /admin?connected=gmail.
 */
import { escapeHtml } from './escape-html';
import { formatDateTime } from './format-time';

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

const STATUS_CLASS: Record<Conn['status'], string> = {
  connected: 'text-green-700', expiring: 'text-amber-700', broken: 'text-red-600', unused: 'text-gray-500',
};
const BUTTON = 'inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-mid';

let deps: ConnDeps;

export function setupConnections(d: ConnDeps): void {
  deps = d;
}

function actions(c: Conn): string {
  if (c.platform !== 'gmail') return `<span class="text-xs text-gray-500">${escapeHtml(deps.t('admin.connections.later'))}</span>`;
  const urgent = c.status === 'broken' || c.status === 'expiring';
  const label = deps.t(c.status === 'unused' ? 'admin.connections.connect' : 'admin.connections.reconnect');
  const connect = `<a href="/api/admin/connections/gmail/start?lang=${deps.lang}" class="${BUTTON} ${urgent ? 'bg-red text-white hover:bg-red-hover' : 'border border-navy text-navy hover:bg-navy-light'}">${escapeHtml(label)}</a>`;
  const disconnect = c.hasStoredToken
    ? ` <button type="button" data-disconnect="${c.platform}" class="${BUTTON} text-gray-500 hover:text-red-600">${escapeHtml(deps.t('admin.connections.disconnect'))}</button>`
    : '';
  return connect + disconnect;
}

function row(c: Conn): string {
  const note = c.status === 'broken' && c.lastError ? c.lastError : c.usesLegacySecret ? deps.t('admin.connections.legacy') : '';
  return `<tr class="border-b border-border last:border-0">
    <td class="px-5 py-3"><p class="font-medium text-navy">${escapeHtml(deps.t(`admin.connections.platform.${c.platform}`))}</p><p class="text-xs text-gray-500">${escapeHtml(c.accountName ?? '')}</p></td>
    <td class="px-5 py-3"><span class="font-medium ${STATUS_CLASS[c.status]}">● ${escapeHtml(deps.t(`admin.connections.status.${c.status}`))}</span>${note ? `<p class="text-xs text-gray-500 mt-0.5 max-w-md">${escapeHtml(note)}</p>` : ''}</td>
    <td class="px-5 py-3 text-gray-500">${escapeHtml(c.connectedBy ?? '')}${c.connectedAt ? `<br><span class="text-xs">${escapeHtml(formatDateTime(c.connectedAt, deps.lang))}</span>` : ''}</td>
    <td class="px-5 py-3 text-gray-500">${c.lastOkAt ? escapeHtml(formatDateTime(c.lastOkAt, deps.lang)) : ''}</td>
    <td class="px-5 py-3 text-right whitespace-nowrap">${actions(c)}</td>
  </tr>`;
}

async function disconnect(button: HTMLButtonElement): Promise<void> {
  // Two clicks instead of window.confirm: the panel uses no browser dialogs.
  if (button.dataset.armed !== '1') {
    button.dataset.armed = '1';
    button.textContent = deps.t('admin.connections.disconnectConfirm');
    return;
  }
  button.disabled = true;
  const res = await fetch(`/api/admin/connections/${button.dataset.disconnect}`, { method: 'DELETE' });
  if (!res.ok) {
    deps.showToast(deps.t('admin.connections.disconnectFailed'), true);
    button.disabled = false;
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
  body.querySelectorAll<HTMLButtonElement>('[data-disconnect]').forEach((b) => b.addEventListener('click', () => void disconnect(b)));
}
