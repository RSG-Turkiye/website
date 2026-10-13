/**
 * The publishing rules, free of I/O so they can be tested exactly
 * (spec §5): how a post's status follows from its targets, when a target is
 * too late to go out unattended, and what one adapter step does to a target.
 */
import type { PublishStep } from './social/types';

/** A "tomorrow at 18:00" post must not appear a day late without a person saying so. */
export const LATE_SECONDS = 2 * 3600;
/** Transient failures are retried every tick for this long from the first attempt. */
export const RETRY_WINDOW_SECONDS = 2 * 3600;
/** How long a tick's claim on a target holds; a claim older than this is taken over. */
export const CLAIM_LEASE_SECONDS = 10 * 60;

export type TargetStatus = 'queued' | 'waiting_connection' | 'needs_confirmation' | 'publishing' | 'published' | 'failed' | 'skipped';
const UNSETTLED: TargetStatus[] = ['queued', 'publishing', 'waiting_connection', 'needs_confirmation'];

export function derivePostStatus(statuses: TargetStatus[]): 'scheduled' | 'published' | 'partially_published' | 'failed' {
  const counted = statuses.filter((s) => s !== 'skipped');
  if (counted.some((s) => UNSETTLED.includes(s))) return 'scheduled';
  const published = counted.filter((s) => s === 'published').length;
  if (published === 0) return 'failed';
  return published === counted.length ? 'published' : 'partially_published';
}

export function isLate(scheduledAt: number, now: number, confirmedAt: number | null): boolean {
  return confirmedAt === null && now - scheduledAt > LATE_SECONDS;
}

export interface TargetNow {
  status: TargetStatus;
  attempts: number;
  first_tried_at: number | null;
  container_id: string | null;
  remote_id: string | null;
  permalink: string | null;
  published_at: number | null;
  last_error: string | null;
}

export interface Transition { next: TargetNow; notify: 'failed' | 'waiting_connection' | null; audit: string | null }

export function afterStep(step: PublishStep, t: TargetNow, now: number): Transition {
  switch (step.kind) {
    case 'done':
      return {
        next: { ...t, status: 'published', remote_id: step.remoteId, permalink: step.permalink, published_at: now, last_error: null },
        notify: null, audit: 'social.target.published',
      };
    case 'pending': {
      const first = t.first_tried_at ?? now;
      if (now - first >= RETRY_WINDOW_SECONDS) {
        return {
          next: { ...t, status: 'failed', container_id: step.containerId, first_tried_at: first, last_error: 'processing: still processing after 2 hours' },
          notify: 'failed', audit: 'social.target.failed',
        };
      }
      return {
        next: { ...t, status: 'publishing', container_id: step.containerId, first_tried_at: first },
        notify: null, audit: t.container_id === null ? 'social.target.container' : null,
      };
    }
    case 'retry': {
      const first = t.first_tried_at ?? now;
      const tried = { ...t, attempts: t.attempts + 1, first_tried_at: first, last_error: step.reason };
      if (now - first >= RETRY_WINDOW_SECONDS) return { next: { ...tried, status: 'failed' }, notify: 'failed', audit: 'social.target.failed' };
      return step.clearContainer
        ? { next: { ...tried, status: 'queued', container_id: null }, notify: null, audit: null }
        : { next: tried, notify: null, audit: null };
    }
    case 'fail':
      // The container is dropped only when Instagram said it could not process it (proof nothing went out), so the post can be edited.
      return {
        next: { ...t, status: 'failed', container_id: step.clearContainer ? null : t.container_id, last_error: step.reason },
        notify: 'failed', audit: 'social.target.failed',
      };
    case 'auth':
      return { next: { ...t, status: 'waiting_connection', last_error: step.reason }, notify: 'waiting_connection', audit: 'social.target.waiting' };
  }
}
