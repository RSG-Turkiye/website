/** Server codes to sentences. Every code here has an admin.social.* key in both languages (tests/admin-social-i18n.test.ts). */
import { ApiError, type Problem } from './api';
import { deps } from './context';

export const PROBLEM_CODES = [
  'no_platform', 'platform_unavailable', 'story_instagram_only', 'media_count', 'missing_alt', 'unknown_media', 'bad_ratio',
  'caption_too_long', 'too_many_hashtags', 'no_schedule', 'schedule_in_past', 'schedule_too_far', 'invalid_schedule_time',
] as const;

export const ERROR_CODES = [
  'post_changed', 'not_ready', 'not_pending', 'not_found', 'not_allowed', 'not_submittable', 'not_deletable', 'not_cancellable',
  'plan_taken', 'plan_has_post', 'already_closed', 'invalid_plan', 'invalid_title', 'invalid_platforms', 'invalid_post_type',
  'invalid_assignee', 'invalid_note', 'invalid_name', 'invalid_window', 'window_too_long', 'invalid_editors', 'invalid_range',
  'schedule_in_past', 'schedule_too_far', 'invalid_schedule_time', 'invalid_type', 'invalid_caption', 'invalid_overrides',
  'invalid_link', 'invalid_media', 'too_many_items', 'invalid_schedule', 'malformed_request',
] as const;

export const STATUS_KEYS = ['draft', 'pending_approval', 'scheduled', 'published', 'partially_published', 'failed', 'rejected', 'cancelled', 'plan'] as const;

const known = (list: readonly string[], code: string) => (list.includes(code) ? code : 'unknown');

export function problemText(p: Problem): string {
  const { t, tf } = deps();
  return tf(`admin.social.problem.${known(PROBLEM_CODES, p.code)}`, {
    n: (p.index ?? 0) + 1,
    platform: p.platform ? t(`admin.connections.platform.${p.platform}`) : '',
    limit: p.limit ?? '',
    actual: p.actual ?? '',
  });
}

export function errorText(err: unknown): string {
  const code = err instanceof ApiError ? known(ERROR_CODES, err.code) : 'unknown';
  return deps().t(`admin.social.error.${code}`);
}
