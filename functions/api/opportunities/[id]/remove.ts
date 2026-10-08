import type { Env } from '../../../_lib/auth';
import { getSessionUser, checkCsrf } from '../../../_lib/auth';
import { verifyRemoval } from '../../../_lib/opportunity';

const page = (body: string) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="font-family:system-ui;max-width:32rem;margin:3rem auto;padding:0 1rem">${body}</body>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });

// The signed token is its own proof and needs no CSRF check; the admin-session
// path is cookie-authenticated, so it goes through checkCsrf like other admin POSTs.
async function authorised(request: Request, env: Env, id: string, csrf: boolean): Promise<string | null> {
  const token = new URL(request.url).searchParams.get('token') ?? '';
  if (token && env.INGEST_SECRET && await verifyRemoval(id, token, env.INGEST_SECRET)) return 'digest';
  if (csrf && !checkCsrf(request)) return null;
  const user = await getSessionUser(request, env);
  return user && user.is_admin === 1 ? `admin:${user.id}` : null;
}

// GET only shows a confirm button: mail scanners follow links, and a GET that
// removed would let any link-preview bot empty the board.
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const id = String(params.id);
  if (!(await authorised(request, env, id, false))) return page('<p>Bu bağlantı geçersiz.</p>');
  const row = await env.DB.prepare('SELECT title, removed_at FROM opportunities WHERE id = ?').bind(id).first<{ title: string; removed_at: number | null }>();
  if (!row) return page('<p>İlan bulunamadı.</p>');
  if (row.removed_at) return page('<p>Bu ilan zaten kaldırılmış.</p>');
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  return page(`<p>Kaldırılsın mı?</p><p><strong>${esc(row.title)}</strong></p><form method="post"><button>Kaldır</button></form>`);
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const id = String(params.id);
  const who = await authorised(request, env, id, true);
  if (!who) return page('<p>Bu bağlantı geçersiz.</p>');
  await env.DB.prepare('UPDATE opportunities SET removed_at = ?, removed_by = ? WHERE id = ? AND removed_at IS NULL')
    .bind(Math.floor(Date.now() / 1000), who, id).run();
  return page('<p>Kaldırıldı. Bir sonraki toplamada geri gelmeyecek.</p>');
};
