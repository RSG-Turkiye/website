import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { compressPdf } from '../src/scripts/pdf-compress';

// Only the lossless step runs under node: these files are far below the
// 1 MB rasterise threshold, and rasterising needs a canvas.

async function twoPages(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const label of ['PAGE-ONE', 'PAGE-TWO']) {
    doc.addPage([595, 842]).drawText(`${label} ${'x'.repeat(2000)}`, { x: 20, y: 400, size: 4, font });
  }
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

const buf = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) as ArrayBuffer;

test('a sound PDF is re-saved losslessly with every page', async () => {
  const r = await compressPdf(buf(await twoPages()), { rasterise: false });
  assert.equal(r.method, 'lossless');
  assert.equal((await PDFDocument.load(r.bytes)).getPageCount(), 2);
});

test('a PDF with a damaged object is uploaded as it is, never re-saved with a page missing', async () => {
  const good = (await twoPages()).toString('latin1');
  const objs = [...good.matchAll(/\n(\d+) 0 obj\n/g)];
  const victim = objs[Math.floor(objs.length / 2)];
  const at = victim.index! + victim[0].length;
  const damaged = Buffer.from(good.slice(0, at) + '<< /Type /Page /Broken [[[ ' + good.slice(at + 10), 'latin1');

  const r = await compressPdf(buf(damaged), { rasterise: false });
  assert.equal(r.method, 'original');
  assert.ok(r.error, 'the row says it could not be shrunk');
  assert.deepEqual(Buffer.from(r.bytes), damaged);
});
