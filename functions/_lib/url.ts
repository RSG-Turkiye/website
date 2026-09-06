/**
 * A URL that is safe to put in an href.
 *
 * Lived in _lib/symposium.ts, where the symposium CMS has always used it, and
 * was moved here when the announcement endpoints needed the same rule. The two
 * surfaces write the same `button_url` column and disagreed about it, which is
 * the shape of defect this repository keeps paying for.
 *
 * A scheme test rather than a parse, deliberately: the point is to refuse
 * `javascript:` and `data:`, and `new URL()` accepts both quite happily.
 */
export function parseHttpUrl(value: string | undefined, field: string): string {
  if (!value) return '';
  if (!/^https?:\/\//i.test(value)) {
    throw new Error(`${field} must be an http(s) URL, got: ${value}`);
  }
  return value;
}
