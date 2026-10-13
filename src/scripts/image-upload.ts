/**
 * Downscales an image in the browser, then uploads it.
 *
 * The server refuses anything over 2000px on its longest side, but a refusal
 * is a bad way to find out: the person has already chosen the photo. So the
 * browser shrinks it first, and in normal use nobody ever meets the limit.
 * The server's check stays because this one can be bypassed -- it is a
 * convenience, not the guarantee.
 *
 * Re-encodes as WebP where the browser can, which is most of them, and falls
 * back to JPEG. Images already within the limit are still re-encoded when
 * that makes them smaller, and sent untouched when it does not.
 */
const MAX_DIMENSION = 2000;
const QUALITY = 0.85;

async function shrink(file: File): Promise<Blob> {
  // GIFs may be animated and canvas would flatten them to one frame.
  if (file.type === 'image/gif') return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file; // not decodable here; let the server have its say
  }

  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/webp', QUALITY);
  });
  if (blob && blob.size > 0 && blob.type === 'image/webp') {
    // Only worth it if it actually saved something.
    return blob.size < file.size || scale < 1 ? blob : file;
  }

  const jpeg = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', QUALITY);
  });
  return jpeg && jpeg.size > 0 && (jpeg.size < file.size || scale < 1) ? jpeg : file;
}

/**
 * Uploads `file`, shrinking it first. Returns the stored URL, or throws with
 * the server's own message -- which explains what is wrong and what to do,
 * and used to be thrown away in favour of a bare "upload failed".
 */
export async function uploadImage(file: File): Promise<string> {
  const body = await shrink(file);
  const res = await fetch('/api/blog-submissions/upload-image', {
    method: 'POST',
    headers: { 'Content-Type': body.type || file.type },
    body,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(detail?.error ?? `Upload failed (${res.status})`);
  }
  return ((await res.json()) as { url: string }).url;
}

export interface SocialUpload { url: string; key: string; width: number; height: number }

/** The picker's accept list and the check behind it: JPEG and PNG only. */
export const SOCIAL_IMAGE_TYPES = ['image/jpeg', 'image/png'];
/** Higher than QUALITY: PNG posters carry text that 0.85 visibly blurs. */
const SOCIAL_QUALITY = 0.92;

export class UnsupportedImageType extends Error {}

/**
 * For social posts: always JPEG (Instagram accepts nothing else), longest
 * side at most 2000px, transparent areas filled white so a PNG logo does not
 * turn black. Returns the server-measured size along with the key; the
 * composer's ratio check uses it and the server re-checks on submit.
 */
export async function uploadSocialImage(file: File): Promise<SocialUpload> {
  if (!SOCIAL_IMAGE_TYPES.includes(file.type)) throw new UnsupportedImageType(file.type || file.name);
  let body: Blob = file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', SOCIAL_QUALITY));
      if (jpeg && jpeg.size > 0) body = jpeg;
    }
    bitmap.close();
  } catch {
    // Not decodable in this browser: send it as is and let the server judge.
  }
  // Either the JPEG or the original file, whose type was checked above.
  return uploadSocialBlob(body);
}

/** Sends an image the panel already prepared (the cropper's JPEG). */
export async function uploadSocialBlob(body: Blob): Promise<SocialUpload> {
  const res = await fetch('/api/blog-submissions/upload-image', {
    method: 'POST',
    headers: { 'Content-Type': body.type },
    body,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(detail?.error ?? `Upload failed (${res.status})`);
  }
  return (await res.json()) as SocialUpload;
}

/** Encodes a canvas the way every social upload is stored. */
export function canvasToSocialJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(
    (b) => (b && b.size > 0 ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', SOCIAL_QUALITY,
  ));
}
