# Social Panel: Text on Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Editors can put text on any social image (single image, carousel item, story) in an interactive editor. The preview is the exact output; text boxes are dragged into place by hand (mouse or touch) and pinched or slid to size. The text stays editable later.

**Architecture:**
- **Why burned in:** Instagram's API cannot add native text stickers, so the text is drawn into the image in the browser and the result is uploaded as the JPEG that gets published.
- **What is stored:** the image without text (`base`) and the text layers (`overlays`) are stored with the media item, so "Edit text" reopens the boxes where they were, and a re-crop re-applies the text to the new crop.
- **Layout math:** a pure module, tested (wrapping, box rectangles, clamping, hit testing, pinch).
- **Drawing:** a small editor module that only draws and listens, mirroring `cropper.ts`.

**Tech Stack:** vanilla TypeScript, canvas 2D, pointer events, `node:test`.

**User decisions (2026-10-13):**
- Text on all post types, not only stories.
- Text only: no shapes, no logos.
- The two pending small fixes (the Social tab's stale intro sentence; the README note that Pages secrets need a redeploy) ride along in Task 3.

## Global Constraints

- **Strings:** every user-facing string in `src/i18n/ui.ts`, `en` and `tr`. No em dash (U+2014) in added lines. `tests/contrast.test.ts` rejects `text-gray-400` on text.
- **Escaping:** every server value into `innerHTML` goes through `esc`. Overlay text is drawn on canvas, never put into HTML unescaped.
- **Overlay rules** (server-validated, the client follows them):
  - at most 5 overlays per image;
  - `text` 1 to 200 characters after trim (newlines allowed);
  - `x`, `y` are the box centre as fractions of the image (0 to 1);
  - `size` is the font size as a fraction of the image width, 0.02 to 0.2;
  - `color`: `'white' | 'black' | 'navy' | 'red'`;
  - `box`: `'none' | 'solid' | 'shade'`;
  - `align`: `'left' | 'center' | 'right'`.
- **Colours:** white `#ffffff`, black `#111111`, navy `#1B2A4A`, red `#C8102E`.
  - `solid` box: white text gets a navy box; every other colour gets a white box.
  - `shade` box: `rgba(0,0,0,0.45)` behind the text.
  - `none`: text with a soft shadow (`rgba(0,0,0,0.5)`, blur 0.08 of the font size) for legibility.
- **Font:** `700 <px> Inter, system-ui, sans-serif`. Wait for `document.fonts.load('700 40px Inter')` before the first draw.
- **Output:** JPEG via the existing `canvasToSocialJpeg`, at the base image's own pixel size (never upscaled, at most 2000 px, which the base already is).
- **Never-twice rule unchanged:** text editing only happens before publishing. A published post is locked.
- Run `npm test`, `npx astro check` (0 errors) and `npm run build` before each commit. Commit trailer: `Co-Authored-By: <your model> <noreply@anthropic.com>`.

## Review Focus

1. **A carousel item is re-cropped after text was added.** Expected: the text is redrawn on the new crop at the same relative place, and the published image has the text. Pinned in Task 3.
2. **A text box is dragged to an edge.** Expected: it stays fully inside the image, and is not cut off in the output. Pinned in Task 1 (`clampCenter`).
3. **Long text.** Expected: it wraps within 90% of the image width and never runs off the side. Pinned in Task 1 (`wrapLines`).
4. **All text is removed.** Expected: the item goes back to its base image, with no leftover `base` or `overlays`. Pinned in Task 3 (`withOverlays`).
5. **A tampered overlay is sent to the server** (6 overlays, 500-char text, `x: 2`, unknown colour). Expected: refused as `invalid_media`. Pinned in Task 1.

---

### Task 1: Data rules, validation, and the layout math

**Files:**
- Create: `src/lib/text-overlay.ts`, `tests/text-overlay.test.ts`
- Modify: `functions/_lib/social-posts.ts`, `functions/_lib/social-post-read.ts`, `src/scripts/social/api.ts`, `tests/social-posts.test.ts`

**Interfaces:**
- Produces (`functions/_lib/social-posts.ts`):
  - `type OverlayColor = 'white' | 'black' | 'navy' | 'red'`
  - `interface TextOverlay { text: string; x: number; y: number; size: number; color: OverlayColor; box: 'none' | 'solid' | 'shade'; align: 'left' | 'center' | 'right' }`
  - `MediaRef` gains `base?: string; overlays?: TextOverlay[]`
  - `MAX_OVERLAYS = 5`
  - `parseDraft` validates both fields (`invalid_media` on any violation)
- Produces (`social-post-read.ts`): each media item with `base` also gets `baseUrl`.
- Produces (`api.ts`): `MediaItem` gains `base?: string; baseUrl?: string; overlays?: TextOverlay[]`. Re-export `TextOverlay`.
- Produces (`src/lib/text-overlay.ts`):
  - `type Measure = (text: string) => number` (pixel width at the current font)
  - `wrapLines(text: string, maxWidth: number, measure: Measure): string[]`
  - `interface Box { x: number; y: number; w: number; h: number }` (pixels)
  - `layoutBox(o: { x: number; y: number; size: number }, lines: string[], measure: Measure, W: number, H: number): { box: Box; lineHeight: number; pad: number }`
  - `clampCenter(cx: number, cy: number, w: number, h: number, W: number, H: number): { x: number; y: number }` (fractions)
  - `hitTest(boxes: Box[], px: number, py: number): number` (topmost index or -1)
  - `pinchSize(start: number, startDist: number, dist: number): number` (clamped 0.02 to 0.2)
  - `OVERLAY_COLORS: Record<OverlayColor, string>`
  - `boxFill(o): string | null`

- [ ] **Step 1: Failing tests.** `tests/text-overlay.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wrapLines, layoutBox, clampCenter, hitTest, pinchSize, boxFill } from '../src/lib/text-overlay';

const mono: (t: string) => number = (t) => t.length * 10; // every character 10 px wide

test('wrapLines keeps words whole, honours newlines, and splits a word longer than the line', () => {
  assert.deepEqual(wrapLines('kısa', 100, mono), ['kısa']);
  assert.deepEqual(wrapLines('bir iki üç dört', 70, mono), ['bir iki', 'üç dört']);
  assert.deepEqual(wrapLines('üst\nalt', 1000, mono), ['üst', 'alt']);
  assert.deepEqual(wrapLines('abcdefghijkl', 50, mono), ['abcde', 'fghij', 'kl']);
  assert.deepEqual(wrapLines('  ', 100, mono), []);
});

test('layoutBox sizes the box around the lines with padding, centred on the point', () => {
  const W = 1000, H = 1000;
  const l = layoutBox({ x: 0.5, y: 0.5, size: 0.05 }, ['abc', 'abcdef'], mono, W, H);
  assert.equal(l.lineHeight, 60);           // 1.2 x font size (50 px)
  assert.equal(l.pad, 15);                  // 0.3 x font size
  assert.equal(l.box.w, 60 + 30);           // widest line + 2 pad
  assert.equal(l.box.h, 120 + 30);          // two lines + 2 pad
  assert.deepEqual([l.box.x, l.box.y], [500 - 45, 500 - 75]);
});

test('clampCenter keeps a box fully inside the image', () => {
  assert.deepEqual(clampCenter(0, 0, 200, 100, 1000, 1000), { x: 0.1, y: 0.05 });
  assert.deepEqual(clampCenter(1000, 1000, 200, 100, 1000, 1000), { x: 0.9, y: 0.95 });
  assert.deepEqual(clampCenter(500, 500, 200, 100, 1000, 1000), { x: 0.5, y: 0.5 });
  assert.deepEqual(clampCenter(10, 10, 2000, 100, 1000, 1000), { x: 0.5, y: 0.05 }, 'wider than the image: centred');
});

test('hitTest picks the topmost box under the point', () => {
  const boxes = [{ x: 0, y: 0, w: 100, h: 100 }, { x: 50, y: 50, w: 100, h: 100 }];
  assert.equal(hitTest(boxes, 75, 75), 1);
  assert.equal(hitTest(boxes, 10, 10), 0);
  assert.equal(hitTest(boxes, 500, 500), -1);
});

test('pinch scales the size and clamps it', () => {
  assert.equal(pinchSize(0.05, 100, 200), 0.1);
  assert.equal(pinchSize(0.05, 100, 10), 0.02);
  assert.equal(pinchSize(0.15, 100, 300), 0.2);
});

test('a solid box contrasts with its text; shade is translucent; none has no box', () => {
  assert.equal(boxFill({ color: 'white', box: 'solid' }), '#1B2A4A');
  assert.equal(boxFill({ color: 'navy', box: 'solid' }), '#ffffff');
  assert.equal(boxFill({ color: 'red', box: 'shade' }), 'rgba(0,0,0,0.45)');
  assert.equal(boxFill({ color: 'black', box: 'none' }), null);
});
```

  Append to `tests/social-posts.test.ts`:

```ts
test('parseDraft keeps text overlays and the base image, and refuses a malformed overlay', () => {
  const o = { text: 'Kayıtlar açık!', x: 0.5, y: 0.8, size: 0.06, color: 'white', box: 'shade', align: 'center' };
  const ok = parseDraft({ type: 'story', media: [{ key: KEY_A, alt: 'x', base: KEY_B, overlays: [{ ...o, extra: 1 }] }] });
  assert.deepEqual(ok.ok && ok.value.media, [{ key: KEY_A, alt: 'x', base: KEY_B, overlays: [o] }]);
  const bad = [
    { overlays: Array.from({ length: 6 }, () => o), base: KEY_B },
    { overlays: [{ ...o, text: '   ' }], base: KEY_B },
    { overlays: [{ ...o, text: 'x'.repeat(201) }], base: KEY_B },
    { overlays: [{ ...o, x: 2 }], base: KEY_B },
    { overlays: [{ ...o, size: 0.5 }], base: KEY_B },
    { overlays: [{ ...o, color: 'pink' }], base: KEY_B },
    { overlays: [{ ...o, box: 'glow' }], base: KEY_B },
    { overlays: [o] },                          // overlays need a base
    { overlays: [o], base: '../x' },
  ];
  for (const extra of bad) {
    assert.deepEqual(parseDraft({ type: 'image', media: [{ key: KEY_A, alt: '', ...extra }] }), { ok: false, code: 'invalid_media' }, JSON.stringify(extra).slice(0, 60));
  }
});
```

- [ ] **Step 2: Run, confirm failure.** Run `node --import tsx --test tests/text-overlay.test.ts tests/social-posts.test.ts`. Expected: FAIL.

- [ ] **Step 3: `src/lib/text-overlay.ts`**

```ts
/**
 * Layout for text drawn onto social images, free of the DOM so it can be
 * tested. Positions are fractions of the image (the box centre); sizes are
 * fractions of the image width. The editor and the final render share this,
 * so what the preview shows is what gets published.
 */
export type OverlayColor = 'white' | 'black' | 'navy' | 'red';
export type Measure = (text: string) => number;
export interface Box { x: number; y: number; w: number; h: number }

export const OVERLAY_COLORS: Record<OverlayColor, string> = { white: '#ffffff', black: '#111111', navy: '#1B2A4A', red: '#C8102E' };
export const MIN_SIZE = 0.02;
export const MAX_SIZE = 0.2;
/** Lines wrap at 90% of the image width. */
export const MAX_LINE_FRACTION = 0.9;

export function wrapLines(text: string, maxWidth: number, measure: Measure): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (measure(next) <= maxWidth) { line = next; continue; }
      if (line) out.push(line);
      // A single word wider than the line is split by characters.
      let rest = word;
      while (measure(rest) > maxWidth) {
        let n = 1;
        while (n < rest.length && measure(rest.slice(0, n + 1)) <= maxWidth) n++;
        out.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      line = rest;
    }
    if (line) out.push(line);
  }
  return out;
}

export function layoutBox(o: { x: number; y: number; size: number }, lines: string[], measure: Measure, W: number, H: number): { box: Box; lineHeight: number; pad: number } {
  const px = o.size * W;
  const lineHeight = Math.round(px * 1.2);
  const pad = Math.round(px * 0.3);
  const w = Math.max(0, ...lines.map(measure)) + 2 * pad;
  const h = lines.length * lineHeight + 2 * pad;
  return { box: { x: o.x * W - w / 2, y: o.y * H - h / 2, w, h }, lineHeight, pad };
}

/** The centre, as fractions, that keeps a w x h box inside a W x H image. */
export function clampCenter(cx: number, cy: number, w: number, h: number, W: number, H: number): { x: number; y: number } {
  const fx = w >= W ? W / 2 : Math.min(Math.max(cx, w / 2), W - w / 2);
  const fy = h >= H ? H / 2 : Math.min(Math.max(cy, h / 2), H - h / 2);
  return { x: Math.round((fx / W) * 1e4) / 1e4, y: Math.round((fy / H) * 1e4) / 1e4 };
}

export function hitTest(boxes: Box[], px: number, py: number): number {
  for (let i = boxes.length - 1; i >= 0; i--) {
    const b = boxes[i];
    if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) return i;
  }
  return -1;
}

export function pinchSize(start: number, startDist: number, dist: number): number {
  const s = startDist > 0 ? start * (dist / startDist) : start;
  return Math.round(Math.min(Math.max(s, MIN_SIZE), MAX_SIZE) * 1e4) / 1e4;
}

export function boxFill(o: { color: OverlayColor; box: 'none' | 'solid' | 'shade' }): string | null {
  if (o.box === 'shade') return 'rgba(0,0,0,0.45)';
  if (o.box === 'solid') return o.color === 'white' ? OVERLAY_COLORS.navy : '#ffffff';
  return null;
}
```

- [ ] **Step 4: Server validation.** In `functions/_lib/social-posts.ts`:

  1. Next to `MediaSource`, add:

     ```ts
     export type OverlayColor = 'white' | 'black' | 'navy' | 'red';
     /** Text drawn into the image by the panel; kept so the text can be edited again. Centre and size are fractions of the image. */
     export interface TextOverlay { text: string; x: number; y: number; size: number; color: OverlayColor; box: 'none' | 'solid' | 'shade'; align: 'left' | 'center' | 'right' }
     export const MAX_OVERLAYS = 5;
     ```

  2. Extend `MediaRef` to `{ key: string; alt: string; source?: MediaSource; base?: string; overlays?: TextOverlay[] }`.
  3. Add `parseOverlays(v: unknown): TextOverlay[] | null | undefined`. It returns `undefined` when absent, `null` when malformed, and a list of only the seven known fields otherwise. Rules:
     - an array of 1 to `MAX_OVERLAYS` items;
     - `text` a string, trimmed length 1 to 200, stored trimmed;
     - `x`, `y` finite numbers in [0, 1];
     - `size` a finite number in [0.02, 0.2];
     - enums exactly as in Global Constraints.
  4. In the media loop:
     - `base` must be absent or a string matching `IMAGE_KEY`;
     - overlays need a base (`overlays` present without `base` is `invalid_media`);
     - push `base` and `overlays` only when present, keeping the existing `source` handling.

- [ ] **Step 5: Response and client type.**
  - `social-post-read.ts`: next to `sourceUrl`, add:

    ```ts
    ...(m.base ? { baseUrl: `${env.PUBLIC_BLOG_IMAGES_URL}/${m.base}` } : {})
    ```

  - `src/scripts/social/api.ts`:
    - import and re-export `TextOverlay`;
    - `MediaItem` gains `base?: string; baseUrl?: string; overlays?: TextOverlay[]`;
    - `DraftBody.media` items gain `base?: string; overlays?: TextOverlay[]`.

- [ ] **Step 6: Verify.** Run the two test files (PASS), then `npm test && npx astro check && npm run build`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/text-overlay.ts tests/text-overlay.test.ts functions/_lib/social-posts.ts functions/_lib/social-post-read.ts src/scripts/social/api.ts tests/social-posts.test.ts
git commit -m "Social media: text overlays on images, validated and stored with their base image"
```

---

### Task 2: The interactive text editor

**Files:**
- Create: `src/scripts/social/text-editor.ts`
- Modify: `src/i18n/ui.ts`

**Interfaces:**
- Consumes: Task 1 (`wrapLines`, `layoutBox`, `clampCenter`, `hitTest`, `pinchSize`, `boxFill`, `OVERLAY_COLORS`, `MAX_LINE_FRACTION`, `TextOverlay`); `canvasToSocialJpeg` (`src/scripts/image-upload.ts`); `deps`, `esc`, `button`; `sameOrigin` (`cropper.ts`).
- Produces:
  - `drawOverlays(ctx: CanvasRenderingContext2D, overlays: TextOverlay[], W: number, H: number, selected?: number): Box[]`. It draws the text (and the selection outline only when `selected` is given) and returns each box.
  - `renderWithText(img: HTMLImageElement, overlays: TextOverlay[]): Promise<Blob>`. It draws the base and the text at the image's own size and returns the JPEG.
  - `openTextEditor(opts: { src: string; overlays: TextOverlay[] }): Promise<{ overlays: TextOverlay[] } | null>`. It resolves with the edited list (possibly empty), or null on Cancel.

- [ ] **Step 1: Strings.** Add to both blocks of `src/i18n/ui.ts`, next to the `admin.social.crop.*` keys:

```ts
// en
'admin.social.text.edit': 'Text',
'admin.social.text.title': 'Text on the image',
'admin.social.text.hint': 'What you see is what gets published. Drag a text to move it; pinch, or use the size slider, to resize. Instagram cannot add its own text stickers through the panel, so the text becomes part of the image.',
'admin.social.text.add': '+ Add text',
'admin.social.text.placeholder': 'Type here',
'admin.social.text.size': 'Size',
'admin.social.text.color': 'Colour',
'admin.social.text.colorWhite': 'White',
'admin.social.text.colorBlack': 'Black',
'admin.social.text.colorNavy': 'Navy',
'admin.social.text.colorRed': 'Red',
'admin.social.text.box': 'Background',
'admin.social.text.boxNone': 'None',
'admin.social.text.boxSolid': 'Box',
'admin.social.text.boxShade': 'Shade',
'admin.social.text.align': 'Alignment',
'admin.social.text.alignLeft': 'Left',
'admin.social.text.alignCenter': 'Centre',
'admin.social.text.alignRight': 'Right',
'admin.social.text.remove': 'Remove this text',
'admin.social.text.max': 'At most 5 texts on one image.',
'admin.social.text.stage': 'Preview of the image with its text. Drag a text, or select it and use the arrow keys, to move it.',
'admin.social.text.apply': 'Apply',
'admin.social.text.applying': 'Saving...',
'admin.social.text.cancel': 'Cancel',
'admin.social.text.failed': 'The text could not be added: {detail}',
'admin.social.text.altHint': 'The image now contains text. Add it to the alt text so people using screen readers get it too.',
'admin.social.text.altAdd': 'Add the text to the alt text',
```

```ts
// tr
'admin.social.text.edit': 'Yazı',
'admin.social.text.title': 'Görselin üstüne yazı',
'admin.social.text.hint': "Burada gördüğün, yayınlanacak olanın aynısı. Yazıyı taşımak için sürükle; büyütüp küçültmek için iki parmakla sıkıştır ya da boyut kaydırıcısını kullan. Instagram panel üzerinden kendi yazı sticker'larını eklemeye izin vermediği için yazı görselin parçası olur.",
'admin.social.text.add': '+ Yazı ekle',
'admin.social.text.placeholder': 'Buraya yaz',
'admin.social.text.size': 'Boyut',
'admin.social.text.color': 'Renk',
'admin.social.text.colorWhite': 'Beyaz',
'admin.social.text.colorBlack': 'Siyah',
'admin.social.text.colorNavy': 'Lacivert',
'admin.social.text.colorRed': 'Kırmızı',
'admin.social.text.box': 'Arka plan',
'admin.social.text.boxNone': 'Yok',
'admin.social.text.boxSolid': 'Kutu',
'admin.social.text.boxShade': 'Gölge',
'admin.social.text.align': 'Hizalama',
'admin.social.text.alignLeft': 'Sol',
'admin.social.text.alignCenter': 'Orta',
'admin.social.text.alignRight': 'Sağ',
'admin.social.text.remove': 'Bu yazıyı kaldır',
'admin.social.text.max': 'Bir görselde en fazla 5 yazı olabilir.',
'admin.social.text.stage': 'Görselin yazıyla önizlemesi. Yazıyı taşımak için sürükle ya da seçip ok tuşlarını kullan.',
'admin.social.text.apply': 'Uygula',
'admin.social.text.applying': 'Kaydediliyor...',
'admin.social.text.cancel': 'Vazgeç',
'admin.social.text.failed': 'Yazı eklenemedi: {detail}',
'admin.social.text.altHint': 'Görselde artık yazı var. Ekran okuyucu kullananlar da görsün diye yazıyı alt metne ekle.',
'admin.social.text.altAdd': 'Yazıyı alt metne ekle',
```

- [ ] **Step 2: `src/scripts/social/text-editor.ts`.** Write it in the same style as `cropper.ts`: a dialog appended to `document.body` (`fixed inset-0 z-50`, `role="dialog"`, `aria-modal="true"`), Escape cancels, it resolves once and removes itself. Required behaviour:

  **1. Loading.** Load the image from `opts.src` (already same-origin from the caller). Wait for `document.fonts.load('700 40px Inter')`; ignore a rejection. `W`, `H` are the image's natural size.

  **2. State.**
  - `overlays` is a deep copy of `opts.overlays`; `selected` is an index or -1.
  - "+ Add text" adds `{ text: deps().t('admin.social.text.placeholder'), x: 0.5, y: 0.5, size: 0.06, color: 'white', box: 'shade', align: 'center' }`, selects it and focuses its textarea.
  - At 5 overlays the button is disabled and `admin.social.text.max` is shown.

  **3. Layout.**
  - Left: the stage canvas. CSS width is `min(480, root.clientWidth - 72, window.innerHeight * 0.6 * W / H)`, internal size multiplied by `devicePixelRatio`. Set `tabindex="0"`, `aria-label` from `admin.social.text.stage`, and `touch-none`.
  - Right (below on narrow screens), for the selected overlay:
    - a textarea (`maxlength 200`);
    - a size slider from 0.02 to 0.2, step 0.005;
    - colour buttons (4) and background buttons (3);
    - alignment buttons (3);
    - "Remove this text".
  - Then Cancel and Apply.
  - Every control updates the overlay and redraws.

  **4. Drawing** (`drawOverlays`, also used for the final render):
  - Per overlay, set `ctx.font = 700 ${size*W}px Inter, system-ui, sans-serif` and `ctx.textBaseline = 'top'`.
  - Lines: `wrapLines(text, MAX_LINE_FRACTION*W - 2*pad, w => ctx.measureText(w).width)`, then `layoutBox(...)`.
  - Clamp the overlay's centre with `clampCenter` before drawing, writing the clamped `x`/`y` back, so a box resized at an edge stays inside.
  - Fill the box with `boxFill(o)` when non-null (rounded corners, radius `pad`).
  - For `box: 'none'`, set a shadow (`rgba(0,0,0,0.5)`, blur `0.08*size*W`) and clear it afterwards.
  - Draw each line at its x for `align`: left at `box.x + pad`, centre at the box centre with `textAlign 'center'`, right at `box.x + box.w - pad` with `textAlign 'right'`. Line y is `box.y + pad + i*lineHeight`. Use the colour `OVERLAY_COLORS[o.color]`.
  - Only when `selected` is given: stroke a dashed outline (`#C8102E`, 2 device px) around that box.
  - Return the boxes.

  **5. Preview.** Draw the image scaled to the stage, then `drawOverlays` on a context scaled by `stage.width / W`, so all overlay math stays in image pixels and the preview equals the output.

  **6. Pointer.**
  - `pointerdown`: convert to image pixels; `hitTest` the boxes; select; remember the grab offset (pointer minus box centre). `setPointerCapture`.
  - `pointermove` with one pointer: set the centre to pointer minus offset, clamp with `clampCenter`, redraw.
  - Two active pointers on the selected overlay: `pinchSize(sizeAtPinchStart, distAtStart, distNow)`.
  - `pointerup`/`pointercancel`: release.
  - A click on empty space deselects.

  **7. Keyboard.** With the stage focused and an overlay selected, the arrow keys move it by 1% of the image (`preventDefault`), and Delete removes it if the textarea is not focused.

  **8. Apply.** Resolve `{ overlays }` with every overlay trimmed and empty ones dropped. The caller renders and uploads. Cancel or Escape resolves null.

  **9. `renderWithText(img, overlays)`.**
  - A canvas `img.naturalWidth` x `img.naturalHeight`; fill white; draw the image; `drawOverlays(ctx, overlays, W, H)` (no selection).
  - Return `canvasToSocialJpeg(canvas)`.

  **10. Escaping.** No `confirm()`/`alert()`. Every label comes from `t()` through `esc`. Overlay text only reaches the DOM as a textarea value set by property (`textarea.value = ...`), never through `innerHTML`.

  Export `drawOverlays`, `renderWithText` and `openTextEditor`.

- [ ] **Step 3: Verify.** Run `npm test && npx astro check && npm run build`. The i18n test checks that every `'admin.social.text.*'` key used exists in both languages.

- [ ] **Step 4: Commit**

```bash
git add src/scripts/social/text-editor.ts src/i18n/ui.ts
git commit -m "Social media: interactive editor for text on images (drag, pinch, live preview)"
```

---

### Task 3: Composer integration, re-crop keeps the text, and the two small fixes

**Files:**
- Modify: `src/scripts/social/composer.ts`, `src/i18n/ui.ts`, `README.md`
- Test: `tests/social-composer-body.test.ts`

**Interfaces:**
- Consumes: Tasks 1 and 2 (`openTextEditor`, `renderWithText`, `TextOverlay`); `uploadSocialBlob`; `sameOrigin`.
- Produces:
  - `withOverlays(m: MediaItem, overlays: TextOverlay[], up: { key: string; url: string; width: number; height: number } | null): MediaItem`. Pure, exported for the test. It returns the item for the new text state: with text, `key/url/width/height` from `up`, `base` = the existing base or the old key, and `overlays`. With none, the base becomes the key again and `base`/`baseUrl`/`overlays` are removed.
  - `toDraftBody` sends `base` and `overlays` when present.

- [ ] **Step 1: Failing tests.** Append to `tests/social-composer-body.test.ts`:

```ts
import { withOverlays } from '../src/scripts/social/composer';

const o = { text: 'Kayıt açık', x: 0.5, y: 0.8, size: 0.06, color: 'white' as const, box: 'shade' as const, align: 'center' as const };

test('adding text keeps the image without text as the base and sends both', () => {
  const m = { key: 'crop.jpg', url: 'u/crop.jpg', alt: 'Afiş', width: 1080, height: 1920 };
  const n = withOverlays(m, [o], { key: 'text.jpg', url: 'u/text.jpg', width: 1080, height: 1920 });
  assert.deepEqual([n.key, n.base, n.baseUrl, n.overlays], ['text.jpg', 'crop.jpg', 'u/crop.jpg', [o]]);
  const again = withOverlays(n, [{ ...o, text: 'Son gün' }], { key: 'text2.jpg', url: 'u/text2.jpg', width: 1080, height: 1920 });
  assert.equal(again.base, 'crop.jpg', 'editing text again starts from the same base');
  const b = toDraftBody({ ...base, media: [n] });
  assert.deepEqual(b.media, [{ key: 'text.jpg', alt: 'Afiş', base: 'crop.jpg', overlays: [o] }]);
});

test('removing all text returns to the base image and drops the text fields', () => {
  const m = { key: 'text.jpg', url: 'u/text.jpg', alt: 'Afiş', base: 'crop.jpg', baseUrl: 'u/crop.jpg', overlays: [o] };
  const n = withOverlays(m, [], null);
  assert.deepEqual([n.key, n.url, 'base' in n, 'overlays' in n, 'baseUrl' in n], ['crop.jpg', 'u/crop.jpg', false, false, false]);
});
```

  Run it to see it fail.

- [ ] **Step 2: Composer.** In `src/scripts/social/composer.ts`:

  1. **`toDraftBody`:** build each media entry as `{ key, alt: alt.trim(), ...(m.source ? { source } : {}), ...(m.base ? { base: m.base } : {}), ...(m.overlays?.length ? { overlays: m.overlays } : {}) }`.
  2. **`withOverlays`:** add it as specified above. With no text, also set `width`/`height` to `undefined` so `measure()` re-reads them; `renderMedia` re-measures.
  3. **Card button:** on every editable media card, add a **Text** button (`data-text="${i}"`, label `admin.social.text.edit`) next to Crop. Its handler:
     - opens `openTextEditor({ src: sameOrigin(m.baseUrl ?? m.url), overlays: m.overlays ?? [] })`;
     - on a result with overlays, loads the base image (same-origin), runs `renderWithText`, `uploadSocialBlob`, then `withOverlays(m, result.overlays, up)`;
     - on a result with none, calls `withOverlays(m, [], null)`.
     - Guard with the same `state !== s` / index checks the crop handler uses. Then `queueSave(); renderMedia(); renderChecks(); renderPreviewPane();`.
     - Errors toast `admin.social.text.failed`.
  4. **Re-crop keeps the text:** in the crop handler (and the crop-on-upload path), after the cropped upload succeeds and the item has `overlays`, render the text on the new cropped image (`renderWithText` on the cropped image loaded same-origin from `up.url`), upload it, and set `{ key: textUp.key, url: textUp.url, width, height, base: up.key, baseUrl: up.url, overlays: m.overlays, source, sourceUrl }`. Without overlays, behaviour is unchanged.
  5. **Alt hint:** below the alt textarea of an item with overlays whose alt does not contain the overlay text (case-insensitive, each overlay's first 20 characters), show `admin.social.text.altHint` with a small button (`admin.social.text.altAdd`). The button appends the overlay texts (joined with '. ') to the alt, then `touch()` and re-render the media.
  6. **Preview:** the Instagram/LinkedIn/story previews already use `m.url`, which is the image with text, so no change is needed. Confirm by reading `preview.ts`.

- [ ] **Step 3: The two small fixes.**
  - `src/i18n/ui.ts` `admin.social.intro`:
    - en: `'Plan the month, prepare posts and send them for approval. Approved posts go out to Instagram at their time; LinkedIn comes later.'`
    - tr: `"Ayı planla, gönderileri hazırla ve onaya gönder. Onaylanan gönderiler zamanı gelince Instagram'a gider; LinkedIn sonra gelecek."`
  - `README.md`:
    - In the phase 3a "One-time setup", after the secrets step, add: "Pages reads secrets only when it deploys. After adding or changing a Pages secret, redeploy (Cloudflare dashboard > Workers & Pages > website > Deployments > latest production > Retry deployment), or the running site keeps the old values. Connecting or reconnecting an account in the panel needs no redeploy: tokens live in D1."
    - Add one short paragraph to the panel usage section on the Text button: what it does, that the text becomes part of the image, editable again, kept through re-crops, and the alt-text hint.

- [ ] **Step 4: Verify.** Run the composer-body test (PASS), then `npm test && npx astro check && npm run build`.

- [ ] **Step 5: Commit**

```bash
git add src/scripts/social/composer.ts src/i18n/ui.ts README.md tests/social-composer-body.test.ts
git commit -m "Social composer: Text button, text survives re-crop, alt-text hint; intro and README fixes"
```

- [ ] **Step 6: Browser check (the user, after deploy, signed in).**
  1. On a story image, press **Text**. Add two texts, drag one to a corner (it stays inside) and pinch or slide its size. Apply: the card and the story preview show the text.
  2. Press **Text** again: both boxes come back where they were. Remove one and apply.
  3. **Crop** the same image differently: the text is still there.
  4. Schedule the post to the test account: the published story shows the text.
  5. On a phone: dragging and pinching work with fingers.
