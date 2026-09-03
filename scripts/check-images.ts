/**
 * Reports every image URL in the content that no longer loads.
 *
 * Seven Cloudinary assets went missing between being uploaded and being
 * noticed -- six 2019 gallery photos and the 2023 poster, the last of which
 * was rendering broken on three pages. Every URL in the content carries a
 * Cloudinary-issued version, so all of them existed once; nothing told us when
 * they stopped.
 *
 * Deliberately a script and not a test: it depends on the network and on a
 * third party, so a CI job would fail for reasons that have nothing to do with
 * the change being tested. Run it now and then, and after any bulk upload.
 *
 *   npx tsx scripts/check-images.ts
 *
 * Exits non-zero when anything is broken, so it can be wired into a scheduled
 * job later if that becomes worth doing.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src/content", "symposium_website/src/content", "symposium_website/src/data"];
const URL_RE = /https:\/\/res\.cloudinary\.com\/[^"')\s>\\]+/g;
const CONCURRENCY = 8;

function walk(dir: string): string[] {
  let out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    out = out.concat(statSync(p).isDirectory() ? walk(p) : [p]);
  }
  return out;
}

const where = new Map<string, string[]>();
for (const root of ROOTS) {
  let files: string[];
  try {
    files = walk(root);
  } catch {
    continue; // a root that does not exist is not an error
  }
  for (const file of files) {
    for (const url of readFileSync(file, "utf8").match(URL_RE) ?? []) {
      const clean = url.replace(/[.,)]+$/, "");
      where.set(clean, [...(where.get(clean) ?? []), file]);
    }
  }
}

const urls = [...where.keys()].sort();
console.log(`Checking ${urls.length} image URLs…`);

const broken: { url: string; status: string }[] = [];
let next = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < urls.length) {
      const url = urls[next++];
      let status = "ERR";
      try {
        const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(15_000) });
        status = String(res.status);
      } catch (e) {
        status = e instanceof Error ? e.name : "ERR";
      }
      if (status !== "200") broken.push({ url, status });
    }
  })
);

if (broken.length === 0) {
  console.log(`All ${urls.length} load.`);
  process.exit(0);
}

console.error(`\n${broken.length} of ${urls.length} do not load:\n`);
for (const { url, status } of broken.sort((a, b) => a.url.localeCompare(b.url))) {
  console.error(`  ${status}  ${url}`);
  for (const file of where.get(url) ?? []) console.error(`        referenced by ${file}`);
}
process.exit(1);
