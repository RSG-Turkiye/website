import type { Env } from '../../_lib/auth';
import { jsonResponse } from '../../_lib/auth';
import { socialGate } from '../../_lib/social-api';

/** Everyone who can be given a plan or included in an event window. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const gate = await socialGate(request, env, 'edit', false);
  if (!gate.ok) return gate.response;
  const rows = (await env.DB.prepare(
    `SELECT u.id, u.email, p.display_name AS name, (u.is_admin = 1 OR u.is_social_publisher = 1) AS is_publisher
       FROM users u LEFT JOIN profiles p ON p.user_id = u.id
      WHERE u.is_admin = 1 OR u.is_social = 1 OR u.is_social_publisher = 1
      ORDER BY u.email`,
  ).all<{ id: string; email: string; name: string | null; is_publisher: number }>()).results;
  return jsonResponse({ editors: rows.map((r) => ({ id: r.id, email: r.email, name: r.name, isPublisher: r.is_publisher === 1 })) });
};
