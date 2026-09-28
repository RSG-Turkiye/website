import { test } from "node:test";
import assert from "node:assert/strict";
import { drivePhotoUrl } from "../src/lib/photo-url";

// A Drive "Share" link is a web page, and an <img> pointed at it shows
// nothing -- which is how the first 2026 speaker appeared without a photo.

const ID = "1CobUlVv3wmcPikRfqmct_yJPaKrqTdJH";
const DIRECT = `https://lh3.googleusercontent.com/d/${ID}=w600`;

test("the link Drive's Share button gives becomes a direct image", () => {
  assert.equal(drivePhotoUrl(`https://drive.google.com/file/d/${ID}/view?usp=sharing`), DIRECT);
  assert.equal(drivePhotoUrl(`https://drive.google.com/file/d/${ID}/view`), DIRECT);
  assert.equal(drivePhotoUrl(`https://drive.google.com/file/d/${ID}`), DIRECT);
});

test("the older open?id= and uc?id= forms are recognised too", () => {
  assert.equal(drivePhotoUrl(`https://drive.google.com/open?id=${ID}`), DIRECT);
  assert.equal(drivePhotoUrl(`https://drive.google.com/uc?export=view&id=${ID}`), DIRECT);
});

test("anything else is left exactly as it was", () => {
  for (const url of [
    "https://rsg-turkiye.iscbsc.org/api/images/speakers/a.webp",
    "https://drive.google.com/drive/folders/abc",
    "https://example.com/file/d/abc/view",
    "",
    "not a url",
  ]) {
    assert.equal(drivePhotoUrl(url), url);
  }
});
