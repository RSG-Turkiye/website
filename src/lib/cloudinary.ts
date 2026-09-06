/**
 * Asking Cloudinary for the size a page actually draws.
 *
 * Image URLs are stored with the transformation they were first needed at,
 * and reused wherever the image appears. A blog post's hero is stored at
 * `c_limit,w_1600`, and the listing page put that same URL in a 128x96 box:
 * fifteen thumbnails, 1,156,042 bytes, to render 1.1 megapixels of screen.
 * A speaker photo stored at `w_600` went into a 30-pixel circle, twenty of
 * them, 506,386 bytes.
 *
 * Cloudinary resizes on request, so the fix is to ask for the right size
 * rather than to store a second URL -- a second URL is a second thing to keep
 * in step, and this repository has enough of those.
 */

/** `https://res.cloudinary.com/<cloud>/image/upload/<transforms>/<rest>` */
const UPLOAD = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.*)$/;

/** A path segment that is a transformation list rather than a version or name. */
function isTransformSegment(segment: string): boolean {
  return /^[a-z]{1,2}_[^/]*$/.test(segment) && !/^v\d+$/.test(segment);
}

/**
 * The same image, asked for at `transform`.
 *
 * Anything that is not a Cloudinary upload URL comes back untouched, so a
 * caller can hand it whatever an author wrote.
 */
export function atSize(url: string, transform: string): string {
  const match = UPLOAD.exec(url);
  if (!match) return url;

  const [, prefix, rest] = match;
  const segments = rest.split('/');
  // Replace the existing transformation if there is one; otherwise insert.
  if (segments.length > 0 && isTransformSegment(segments[0])) {
    segments[0] = transform;
  } else {
    segments.unshift(transform);
  }
  return prefix + segments.join('/');
}

/** Sizes the pages ask for, named where they are used rather than inline. */
export const SIZES = {
  /** Blog and webinar listing cards: 160x112 at 2x. */
  cardThumb: 'f_auto,q_auto,c_fill,w_320,h_224',
  /** The speaker strip's 30px circles, at 2x, cropped to the face. */
  avatarTiny: 'f_auto,q_auto,c_fill,g_face,w_60,h_60',
  /** Committee cards draw at 96px. */
  portrait: 'f_auto,q_auto,c_fill,g_face,w_192,h_192',
} as const;
