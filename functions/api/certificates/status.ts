// Read at build time by the symposium site to decide whether the home page
// shows the certificates band. Counts only -- no names, no emails.
import type { Env } from '../../_lib/auth';
import { jsonResponse } from '../../_lib/auth';

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const now = Math.floor(Date.now() / 1000);
  const { results } = await env.DB.prepare(
    `SELECT year, COUNT(*) AS count, MAX(expires_at) AS expiresAt
     FROM symposium_certificates WHERE expires_at > ? GROUP BY year ORDER BY year DESC`
  ).bind(now).all<{ year: number; count: number; expiresAt: number }>();
  return jsonResponse({ years: results });
};
