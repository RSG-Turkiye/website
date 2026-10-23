/**
 * An image address for a content file: a path on this site (usually
 * /api/images/<key>) or a full https URL on a host readers can reach.
 * r2.dev, pages.dev and workers.dev are blocked in Türkiye (CLAUDE.md rule
 * 2), so an image there would be a broken picture for most of our readers;
 * the schema refuses one rather than letting it reach a page.
 *
 * No astro:content import here, so node tests can use it.
 */

import { z } from "astro/zod";

const BLOCKED_HOST = /(^|\.)(r2|pages|workers)\.dev\.?$/i;

export const isReachableImageUrl = (s: string): boolean => {
  let host: string;
  try {
    host = new URL(s, "https://example.invalid").hostname;
  } catch {
    return false;
  }
  return !BLOCKED_HOST.test(host);
};

export const imageUrl = z.string().min(1).refine(isReachableImageUrl, {
  message: "image URL is on r2.dev, pages.dev or workers.dev, which are blocked in Türkiye; serve it through /api/images",
});
