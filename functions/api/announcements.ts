import type { Env } from '../_lib/auth';
import { jsonResponse } from '../_lib/auth';

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const now = Math.floor(Date.now() / 1000);

  const result = await env.DB.prepare(
    `SELECT id, title, description, button_text, button_url, show_as_popup
     FROM announcements
     WHERE expires_at > ? AND site = 'main'
     ORDER BY created_at DESC`
  ).bind(now).all<{
    id: string;
    title: string;
    description: string;
    button_text: string;
    button_url: string;
    show_as_popup: number;
  }>();

  return jsonResponse({
    announcements: result.results.map(a => ({
      id: a.id,
      title: a.title,
      description: a.description,
      button_text: a.button_text,
      button_url: a.button_url,
      show_as_popup: a.show_as_popup === 1,
    })),
  });
};
