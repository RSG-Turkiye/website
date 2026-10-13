/** Server codes to sentences. Every code here has an admin.social.* key in both languages (tests/admin-social-i18n.test.ts). */
import { ApiError, type Problem, type Post } from './api';
import { deps } from './context';
import { PUBLISH_REASON_KEYS } from '../../../functions/_lib/social/instagram-errors';

export const PROBLEM_CODES = [
  'no_platform', 'platform_unavailable', 'story_instagram_only', 'media_count', 'missing_alt', 'unknown_media', 'bad_ratio', 'not_jpeg',
  'caption_too_long', 'too_many_hashtags', 'no_schedule', 'schedule_in_past', 'schedule_too_far', 'invalid_schedule_time',
] as const;

export const ERROR_CODES = [
  'post_changed', 'not_ready', 'not_pending', 'not_found', 'not_allowed', 'not_submittable', 'not_deletable', 'not_cancellable', 'not_requeueable', 'publishing_started',
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

export const TARGET_STATUS_KEYS = ['queued', 'waiting_connection', 'needs_confirmation', 'publishing', 'published', 'failed', 'skipped'] as const;

/** last_error is "<key>: <provider detail>"; the key becomes a sentence, the detail stays for whoever needs it. */
export function splitPublishError(lastError: string): { key: string; detail: string } {
  const at = lastError.indexOf(': ');
  if (at <= 0) return { key: lastError, detail: '' };
  return { key: lastError.slice(0, at), detail: lastError.slice(at + 2).trim() };
}

export function publishErrorText(lastError: string | null): string {
  if (!lastError) return '';
  const { key } = splitPublishError(lastError);
  return deps().t(`admin.social.publishError.${(PUBLISH_REASON_KEYS as readonly string[]).includes(key) ? key : 'unknown'}`);
}

/** The label key of the requeue button for this post, or null when there is nothing to requeue. Held posts get "Publish anyway", failed ones "Retry". */
export function requeueLabelKey(p: Post): string | null {
  const held = p.targets.some((x) => x.status === 'needs_confirmation');
  const failedAny = p.targets.some((x) => x.status === 'failed');
  if (!(held || failedAny) || !['scheduled', 'failed', 'partially_published'].includes(p.status)) return null;
  return held ? 'admin.social.action.publishAnyway' : 'admin.social.action.retry';
}
