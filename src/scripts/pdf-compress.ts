/**
 * Makes a certificate PDF smaller in the organiser's browser before upload.
 * Workers on the free plan get 10 ms CPU per request, so this cannot happen
 * server-side. Never makes a file bigger and never throws: on any failure
 * the original bytes come back with the reason.
 */
export const RASTER_THRESHOLD = 1024 * 1024;
const DPI = 200;
const JPEG_QUALITY = 0.85;

export type Method = 'original' | 'lossless' | 'raster';

export async function compressPdf(
  input: ArrayBuffer,
  opts: { rasterise: boolean },
): Promise<{ bytes: Uint8Array; method: Method; error?: string }> {
  const original = new Uint8Array(input);
  let best: { bytes: Uint8Array; method: Method } = { bytes: original, method: 'original' };
  let error: string | undefined;
  try {
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.load(original);
    const saved = await doc.save({ useObjectStreams: true });
    if (saved.length < best.bytes.length) best = { bytes: saved, method: 'lossless' };
  } catch (err) {
    error = String(err).slice(0, 120);
  }
  if (opts.rasterise && best.bytes.length > RASTER_THRESHOLD) {
    try {
      const raster = await rasterise(original);
      if (raster.length < best.bytes.length) best = { bytes: raster, method: 'raster' };
    } catch (err) {
      error = String(err).slice(0, 120);
    }
  }
  return error && best.method === 'original' ? { ...best, error } : best;
}

async function rasterise(src: Uint8Array): Promise<Uint8Array> {
  const pdfjs = await import('pdfjs-dist');
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  // getDocument transfers the buffer it is given, so hand it a copy.
  const pdf = await pdfjs.getDocument({ data: src.slice() }).promise;
  const { PDFDocument } = await import('pdf-lib');
  const out = await PDFDocument.create();
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const size = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: DPI / 72 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', JPEG_QUALITY),
    );
    const jpg = await out.embedJpg(await blob.arrayBuffer());
    out.addPage([size.width, size.height]).drawImage(jpg, { x: 0, y: 0, width: size.width, height: size.height });
  }
  await pdf.destroy();
  return out.save({ useObjectStreams: true });
}
