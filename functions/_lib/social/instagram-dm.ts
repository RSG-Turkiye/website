/**
 * Instagram direct messages through the Instagram API with Instagram Login
 * (graph.instagram.com, scope instagram_business_manage_messages). Reads the
 * conversation list, the newest messages of one conversation (Meta returns
 * details for the 20 newest only), and sends a text reply. Never throws.
 *
 * Errors have their own classes here, not publishing's: code 10 with subcode
 * 2534022 is "outside the 24-hour window", a refusal of this one message, and
 * must not mark the connection broken (plan ruling R3).
 */
import { igGraph } from './instagram';
import type { GraphError } from './instagram-errors';

export interface DmConversation { id: string; updatedAt: number }
export interface DmMessage { id: string; at: number; fromId: string; fromUsername: string | null; text: string; attachments: string[]; mine: boolean; toId?: string; toUsername?: string | null }
export type DmErrorKind = 'window' | 'auth' | 'permission' | 'transient' | 'refused';
export interface DmError { ok: false; kind: DmErrorKind; reason: string }
export interface DmAccount { id: string; name: string | null }

export interface DmAdapter {
  listConversations(token: string): Promise<{ ok: true; conversations: DmConversation[] } | DmError>;
  thread(token: string, conversationId: string, account: DmAccount): Promise<{ ok: true; messages: DmMessage[] } | DmError>;
  send(token: string, peerId: string, text: string): Promise<{ ok: true } | DmError>;
}

const WINDOW_SUBCODE = 2534022;
const TRANSIENT_CODES = new Set([1, 2, 4, 17, 32, 341, 613, -1, -2]);

export function dmErrorKind(status: number, err: GraphError | null): DmErrorKind {
  const code = err?.code ?? 0;
  if (code === 10 && err?.error_subcode === WINDOW_SUBCODE) return 'window';
  if (code === 190) return 'auth';
  // Codes 200-299 are a permission refusal; for messages that is a settings toggle, not a dead token (R8).
  if (code >= 200 && code <= 299) return 'permission';
  if (status === 0 || status >= 500 || TRANSIENT_CODES.has(code)) return 'transient';
  return 'refused';
}

const fail = (status: number, error: GraphError | null): DmError => ({
  ok: false, kind: dmErrorKind(status, error), reason: (error?.message ?? `HTTP ${status}`).slice(0, 200),
});

/** Meta writes "2026-10-15T09:00:00+0000"; Date.parse wants "+00:00". */
function parseTime(v: unknown): number {
  if (typeof v !== 'string') return 0;
  const ms = Date.parse(v.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

function attachmentUrls(raw: unknown): string[] {
  const data = (raw as { data?: unknown[] } | undefined)?.data;
  if (!Array.isArray(data)) return [];
  const out: string[] = [];
  for (const a of data as Record<string, any>[]) {
    for (const u of [a?.image_data?.url, a?.video_data?.url, a?.file_url, a?.url]) {
      if (typeof u === 'string' && u.startsWith('https://')) out.push(u);
    }
  }
  return out;
}

const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** The other person: the sender of their newest message, else whom our message went to. */
export function peerOf(messages: DmMessage[]): { id: string; username: string | null } | null {
  for (let i = messages.length - 1; i >= 0; i--) if (!messages[i].mine) return { id: messages[i].fromId, username: messages[i].fromUsername };
  const ours = messages.find((m) => m.toId);
  return ours ? { id: ours.toId!, username: ours.toUsername ?? null } : null;
}

export const instagramDm: DmAdapter = {
  async listConversations(token) {
    const r = await igGraph('GET', 'me/conversations', token, { platform: 'instagram', fields: 'id,updated_time', limit: '25' });
    if (!r.ok) return fail(r.status, r.error);
    const data = Array.isArray(r.data.data) ? (r.data.data as Record<string, unknown>[]) : [];
    const conversations = data
      .filter((c) => typeof c.id === 'string')
      .map((c) => ({ id: c.id as string, updatedAt: parseTime(c.updated_time) }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    return { ok: true, conversations };
  },

  async thread(token, conversationId, account) {
    const r = await igGraph('GET', encodeURIComponent(conversationId), token, { fields: 'messages{id,created_time,from,to,message,attachments}' });
    if (!r.ok) return fail(r.status, r.error);
    const data = (r.data.messages as { data?: unknown[] } | undefined)?.data;
    const messages = (Array.isArray(data) ? (data as Record<string, any>[]) : [])
      .filter((m) => typeof m.id === 'string')
      .map((m): DmMessage => {
        const fromId = String(m.from?.id ?? '');
        const fromUsername = typeof m.from?.username === 'string' ? m.from.username : null;
        const to = Array.isArray(m.to?.data) ? m.to.data[0] : undefined;
        return {
          id: m.id, at: parseTime(m.created_time), fromId, fromUsername,
          text: typeof m.message === 'string' ? m.message : '',
          attachments: attachmentUrls(m.attachments),
          mine: fromId === account.id || same(fromUsername, account.name),
          toId: to?.id !== undefined ? String(to.id) : undefined,
          toUsername: typeof to?.username === 'string' ? to.username : null,
        };
      })
      .sort((a, b) => a.at - b.at);
    return { ok: true, messages };
  },

  async send(token, peerId, text) {
    const r = await igGraph('POST', 'me/messages', token, {
      recipient: JSON.stringify({ id: peerId }),
      message: JSON.stringify({ text }),
    });
    return r.ok ? { ok: true } : fail(r.status, r.error);
  },
};
