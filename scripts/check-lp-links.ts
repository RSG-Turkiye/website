/**
 * Checks every external link in the learning paths and reports the dead ones.
 *
 * 10 of about 109 links went dead within a year (#35) and nobody noticed until
 * someone clicked through all of them by hand. This runs weekly from
 * .github/workflows/lp-link-check.yml, which keeps the result in one issue.
 *
 * Like check-images.ts, deliberately a script and not a test: it depends on
 * the network and on third parties, so it must never fail an unrelated PR.
 *
 *   npx tsx scripts/check-lp-links.ts [--out report.md]
 *
 * Dead means 404/410, or no answer at all after a retry. Publishers that wall
 * off bots (403, 429, 5xx) are listed as unverified rather than dead: those
 * links open fine in a browser, and calling them dead would bury the real ones.
 * Exits 1 when something is dead.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src/content/lp-domains", "src/content/lp-levels", "src/content/lp-roadmap"];
// `url:` and `youtubeUrl:` lines; site-relative links ("/learning-paths/...") are the build's job.
const LINK_RE = /^\s*(?:- )?(?:url|youtubeUrl):\s*"?(https?:\/\/[^"\s]+)"?\s*$/;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";
const TIMEOUT_MS = 20_000;
const CONCURRENCY = 8;

export type Verdict = "ok" | "dead" | "unverified";
export interface Result { url: string; files: string[]; verdict: Verdict; detail: string }

/** Every external link in the given markdown files, with the files it appears in. */
export function extractLinks(files: { path: string; text: string }[]): Map<string, string[]> {
  const where = new Map<string, string[]>();
  for (const { path, text } of files) {
    for (const line of text.split("\n")) {
      const m = line.match(LINK_RE);
      if (!m) continue;
      const list = where.get(m[1]) ?? [];
      if (!list.includes(path)) list.push(path);
      where.set(m[1], list);
    }
  }
  return where;
}

/** An HTTP status, or null when nothing answered. */
export function classify(status: number | null): Verdict {
  if (status === null) return "dead";
  if (status >= 200 && status < 400) return "ok";
  if (status === 404 || status === 410) return "dead";
  return "unverified";
}

/**
 * Where a redirect leads, as a browser would follow it. An https page that
 * redirects to plain http on the same host is followed over https, as HSTS
 * makes browsers do: wwpdb.org answers HTTP/1.1 clients (Node's fetch) with
 * such a hop, whose http address then redirects to a closed port 8443, while
 * browsers on HTTP/2 never see it and load the page.
 */
export function nextHop(from: string, location: string): string {
  const to = new URL(location, from);
  const prev = new URL(from);
  if (prev.protocol === "https:" && to.protocol === "http:" && to.hostname === prev.hostname) to.protocol = "https:";
  return to.href;
}

async function statusOf(url: string): Promise<{ status: number | null; detail: string }> {
  try {
    let current = url;
    for (let hop = 0; hop < 10; hop++) {
      const res = await fetch(current, {
        redirect: "manual",
        headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      await res.body?.cancel(); // the status is all we need; some targets are PDFs
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) { current = nextHop(current, location); continue; }
      return { status: res.status, detail: String(res.status) };
    }
    return { status: null, detail: "more than 10 redirects" };
  } catch (err) {
    return { status: null, detail: err instanceof Error ? (err.cause as Error)?.message ?? err.message : String(err) };
  }
}

async function check(url: string, files: string[]): Promise<Result> {
  let first = await statusOf(url);
  // One retry for anything that is not a clear answer: a flaky host must not open an issue.
  if (classify(first.status) !== "ok" && first.status !== 404 && first.status !== 410) {
    await new Promise((r) => setTimeout(r, 3000));
    first = await statusOf(url);
  }
  return { url, files, verdict: classify(first.status), detail: first.detail };
}

export function report(results: Result[], when: Date): string {
  const dead = results.filter((r) => r.verdict === "dead");
  const unverified = results.filter((r) => r.verdict === "unverified");
  const row = (r: Result) => `| ${r.url} | ${r.detail} | ${r.files.map((f) => `\`${f}\``).join("<br>")} |`;
  const lines = [
    `Checked ${results.length} external learning-path links on ${when.toISOString().slice(0, 10)}.`,
    "",
    dead.length
      ? `## Dead (${dead.length})\n\nReplace each one **in place**: keep the resource's \`id\`, since members' progress is saved under it. Change the link in the \`en/\` and \`tr/\` files together.\n\n| Link | Answer | Files |\n|---|---|---|\n${dead.map(row).join("\n")}`
      : "## Dead\n\nNone.",
  ];
  if (unverified.length) {
    lines.push(
      "",
      `## Unverified (${unverified.length})`,
      "",
      "These hosts refuse automated requests (bot walls, rate limits), so this check cannot tell. They normally open fine in a browser; worth a manual look now and then.",
      "",
      "| Link | Answer | Files |\n|---|---|---|",
      ...unverified.map(row),
    );
  }
  lines.push("", "_Written by `scripts/check-lp-links.ts` (weekly workflow `lp-link-check.yml`)._");
  return lines.join("\n");
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".md") ? [p] : [];
  });
}

async function main() {
  const out = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : null;
  const files = ROOTS.flatMap(walk).map((path) => ({ path, text: readFileSync(path, "utf8") }));
  const links = [...extractLinks(files)];
  const results: Result[] = [];
  for (let i = 0; i < links.length; i += CONCURRENCY) {
    results.push(...(await Promise.all(links.slice(i, i + CONCURRENCY).map(([url, where]) => check(url, where)))));
  }
  const md = report(results, new Date());
  if (out) writeFileSync(out, md);
  console.log(md);
  if (results.some((r) => r.verdict === "dead")) process.exit(1);
}

if (process.argv[1]?.endsWith("check-lp-links.ts")) await main();
