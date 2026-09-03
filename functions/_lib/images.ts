/**
 * The pixel dimensions of an image, read from its header bytes.
 *
 * The upload endpoint accepted anything up to its byte limit, so a
 * 6720x4480 photograph -- one of which is in this very repo at 6.18 MB --
 * went into a blog post untouched and was sent whole to every reader. Bytes
 * alone do not catch that: a heavily compressed photograph can be enormous
 * in pixels and modest on disk.
 *
 * Reads the header only. No decoding, no dependency, no allocation beyond
 * the few bytes each format puts its size in.
 *
 * Returns null when the bytes are not a format we recognise or are truncated
 * before the size field; the caller decides what to do with that.
 */
export function imageSize(bytes: ArrayBuffer): { width: number; height: number } | null {
  const b = new DataView(bytes);
  const len = b.byteLength;
  if (len < 16) return null;

  // PNG: 8-byte signature, then IHDR with width and height as big-endian u32.
  if (b.getUint32(0) === 0x89504e47 && b.getUint32(4) === 0x0d0a1a0a) {
    return { width: b.getUint32(16), height: b.getUint32(20) };
  }

  // GIF87a / GIF89a: little-endian u16 pair right after the signature.
  if (b.getUint32(0) === 0x47494638) {
    return { width: b.getUint16(6, true), height: b.getUint16(8, true) };
  }

  // WebP: RIFF container, then one of three chunk layouts.
  if (b.getUint32(0) === 0x52494646 && b.getUint32(8) === 0x57454250) {
    const chunk = b.getUint32(12);
    if (chunk === 0x56503820 && len >= 30) {
      // Lossy: dimensions follow the 3-byte start code, 14 bits each.
      return { width: b.getUint16(26, true) & 0x3fff, height: b.getUint16(28, true) & 0x3fff };
    }
    if (chunk === 0x5650384c && len >= 25) {
      // Lossless: 14 bits each, packed across four bytes, both minus one.
      const bits = b.getUint32(21, true);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 0x38585650 || chunk === 0x56503858) {
      if (len < 30) return null;
      // Extended: 24-bit little-endian, each minus one.
      const w = b.getUint8(24) | (b.getUint8(25) << 8) | (b.getUint8(26) << 16);
      const h = b.getUint8(27) | (b.getUint8(28) << 8) | (b.getUint8(29) << 16);
      return { width: w + 1, height: h + 1 };
    }
    return null;
  }

  // JPEG: walk the marker segments to the frame header, which carries the size.
  if (b.getUint16(0) === 0xffd8) {
    let i = 2;
    while (i + 9 < len) {
      if (b.getUint8(i) !== 0xff) { i++; continue; }
      const marker = b.getUint8(i + 1);
      // Standalone markers carry no length field.
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      // Any SOFn except the four that are not frame headers.
      const isFrame = marker >= 0xc0 && marker <= 0xcf &&
        marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc && marker !== 0xc9;
      if (isFrame) return { height: b.getUint16(i + 5), width: b.getUint16(i + 7) };
      const segment = b.getUint16(i + 2);
      if (segment < 2) return null; // malformed; refuse rather than loop
      i += 2 + segment;
    }
    return null;
  }

  return null;
}
