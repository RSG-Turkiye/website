/**
 * Every "<key>: <detail>" an adapter may write to a target's last_error. The
 * panel turns the key into a sentence (admin.social.publishError.<key>) with
 * the platform's name filled in, so one list serves Instagram, LinkedIn and X.
 */
export const PUBLISH_REASON_KEYS = [
  'auth', 'needs_business', 'image_too_large', 'image_format', 'bad_ratio', 'caption_rejected', 'carousel_count',
  'account_restricted', 'spam', 'media_unreachable', 'rate_limited', 'daily_limit', 'expired', 'container_error',
  'unavailable', 'not_available', 'unknown', 'processing',
  'duplicate', 'uncertain', 'no_api_access', 'not_connected',
] as const;
export type PublishReasonKey = (typeof PUBLISH_REASON_KEYS)[number];
