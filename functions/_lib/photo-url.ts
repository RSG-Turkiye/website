/**
 * A Google Drive share link, turned into something an <img> can show.
 *
 * Organisers paste the link Drive's "Share" button gives them --
 * `drive.google.com/file/d/<id>/view?usp=sharing` -- into the photo field.
 * That is a web page, not a picture, so the speaker card showed nothing.
 * The first real case was a 2026 keynote speaker.
 *
 * `lh3.googleusercontent.com/d/<id>=w600` serves the file itself, resized by
 * Google (600 px is about 2x the widest place a photo is drawn; the original
 * was 900 KB, this is a quarter of that). It only works while the file is
 * shared as "anyone with the link" -- uploading through the panel is still
 * the better path, because then the photo lives with us.
 *
 * Anything that is not a Drive file link comes back unchanged.
 *
 * The symposium site has a copy of this in its own src/lib/photo-url.ts --
 * it is a separate package and applies the same rule to rows saved before
 * this existed.
 */
export function drivePhotoUrl(url: string): string {
  const id = driveFileId(url);
  return id ? `https://lh3.googleusercontent.com/d/${id}=w600` : url;
}

function driveFileId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== 'drive.google.com') return null;
  const fromPath = parsed.pathname.match(/^\/file\/d\/([\w-]+)/)?.[1];
  if (fromPath) return fromPath;
  // `open?id=` and `uc?id=` are the older share and download forms.
  if (parsed.pathname === '/open' || parsed.pathname === '/uc') {
    const id = parsed.searchParams.get('id');
    if (id && /^[\w-]+$/.test(id)) return id;
  }
  return null;
}
