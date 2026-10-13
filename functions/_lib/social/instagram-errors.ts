/**
 * Instagram Graph errors, sorted into what the dispatcher should do about
 * them. Classified on code and subcode together: Meta's documented table
 * and live responses do not always agree on which one carries the meaning.
 */
import type { PublishStep } from './types';

export interface GraphError { code?: number; error_subcode?: number; message?: string; type?: string }
export type ErrorClass = 'auth' | 'pending' | 'expired' | 'content' | 'transient';

const PENDING_SUBCODES = new Set([2207027]);
const EXPIRED_SUBCODES = new Set([2207006, 2207008, 2207020]);
const TRANSIENT_SUBCODES = new Set([2207001, 2207003, 2207032, 2207042, 2207052]);
const TRANSIENT_CODES = new Set([1, 2, -1, -2, 4, 9, 17, 32, 341, 368, 613]);
const NOT_BUSINESS = /not an instagram business/i;

export function classifyGraphError(httpStatus: number, err: GraphError | null): ErrorClass {
  if (!err) return httpStatus === 0 || httpStatus >= 500 || httpStatus === 429 ? 'transient' : 'content';
  const code = err.code ?? 0;
  const sub = err.error_subcode ?? 0;
  if (code === 190 || (code >= 200 && code <= 299)) return 'auth';
  if (code === 10) return NOT_BUSINESS.test(err.message ?? '') ? 'content' : 'auth';
  if (code === 9007 || PENDING_SUBCODES.has(sub)) return 'pending';
  if (EXPIRED_SUBCODES.has(sub)) return 'expired';
  if (TRANSIENT_SUBCODES.has(sub) || TRANSIENT_CODES.has(code)) return 'transient';
  if (httpStatus >= 500) return 'transient';
  return 'content';
}

/** Keys the panel turns into a sentence (admin.social.publishError.<key>). */
export const PUBLISH_REASON_KEYS = [
  'auth', 'needs_business', 'image_too_large', 'image_format', 'bad_ratio', 'caption_rejected', 'carousel_count',
  'account_restricted', 'spam', 'media_unreachable', 'rate_limited', 'daily_limit', 'expired', 'container_error',
  'unavailable', 'not_available', 'unknown',
] as const;

function reasonKey(httpStatus: number, err: GraphError | null): (typeof PUBLISH_REASON_KEYS)[number] {
  if (!err) return httpStatus === 0 || httpStatus >= 500 ? 'unavailable' : 'unknown';
  const code = err.code ?? 0;
  const sub = err.error_subcode ?? 0;
  if (code === 10 && NOT_BUSINESS.test(err.message ?? '')) return 'needs_business';
  if (code === 190 || code === 10 || (code >= 200 && code <= 299)) return 'auth';
  switch (sub) {
    case 2207004: return 'image_too_large';
    case 2207005: case 2207023: return 'image_format';
    case 2207009: return 'bad_ratio';
    case 2207010: case 2207040: return 'caption_rejected';
    case 2207028: return 'carousel_count';
    case 2207050: return 'account_restricted';
    case 2207051: return 'spam';
    case 2207052: case 2207003: return 'media_unreachable';
    case 2207042: return 'daily_limit';
    case 2207006: case 2207008: case 2207020: return 'expired';
  }
  if ([4, 17, 32, 341, 368, 613].includes(code)) return 'rate_limited';
  if (httpStatus >= 500 || code === 1 || code === 2 || code === -1 || code === -2) return 'unavailable';
  return 'unknown';
}

/** "<key>: <detail>", stored in last_error; the panel translates the key and shows the detail beneath. */
export function graphReason(httpStatus: number, err: GraphError | null): string {
  const detail = err?.message ?? `HTTP ${httpStatus}`;
  return `${reasonKey(httpStatus, err)}: ${detail}`.slice(0, 300);
}

export function stepFromError(httpStatus: number, err: GraphError | null): PublishStep {
  const reason = graphReason(httpStatus, err);
  switch (classifyGraphError(httpStatus, err)) {
    case 'auth': return { kind: 'auth', reason };
    case 'expired': return { kind: 'retry', reason, clearContainer: true };
    case 'transient': case 'pending': return { kind: 'retry', reason };
    default: return { kind: 'fail', reason };
  }
}
