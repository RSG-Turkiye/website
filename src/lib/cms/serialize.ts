/**
 * Content entries to file text and back, byte for byte.
 *
 * The panel CMS opens pull requests that change content files. A save that
 * rewrites every line of a file it changed one value in makes the diff
 * unreadable to the reviewer who has to approve it, so:
 *
 * - JSON: every file in the repo is `JSON.stringify(data, null, 2)` plus a
 *   newline, so that is the serialiser, and parse → serialize is the
 *   identity on them.
 * - Markdown: the frontmatter's formatting (plain or quoted, comments, blank
 *   lines) cannot be recovered from the values, and the files mix styles. So
 *   `parseMarkdown` also returns the original frontmatter text as `source`,
 *   and `serializeMarkdown` keeps every key whose value the draft did not
 *   change exactly as it was written, rewriting only the changed keys. A draft
 *   without `source` is a new entry and is written in the dominant style
 *   (see `renderNew`).
 *
 * No astro:content, no browser APIs: the Pages Functions import this.
 */

import { Document, isMap, isScalar, isSeq, parseDocument, Scalar, YAMLSeq, type Pair } from "yaml";
import type { CmsType } from "./types";

// ── JSON ─────────────────────────────────────────────────────────────────────

/** The entry as written in the file: dates stay "YYYY-MM-DD" strings, the
 * schema's input, not its parsed output. */
export function parseJson(_type: CmsType, text: string): unknown {
  return JSON.parse(text);
}

/** Two-space indent, keys in the entry's own order, a trailing newline: the
 * format of every existing file. */
export function serializeJson(_type: CmsType, data: unknown): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

// ── Markdown ─────────────────────────────────────────────────────────────────

export type Frontmatter = Record<string, unknown>;

export interface MarkdownEntry {
  frontmatter: Frontmatter;
  /** Everything after the closing `---` line, unchanged (usually starts with
   * a blank line). */
  body: string;
  /** The original frontmatter text between the fences. Present for an entry
   * read from a file; absent for a new one. A string, not a yaml Document, so
   * a draft can be stored as JSON and still be written back exactly. */
  source?: string;
}

const FENCED = /^---\n([\s\S]*?\n)?---\n/;

export function parseMarkdown(_type: CmsType, text: string): MarkdownEntry {
  const m = FENCED.exec(text);
  if (!m) throw new Error("Markdown entry has no frontmatter: it must start with a --- line and close with another");
  const source = m[1] ?? "";
  const doc = parseDocument(source);
  if (doc.errors.length > 0) throw new Error(`Invalid YAML frontmatter: ${doc.errors[0].message}`);
  const data = doc.toJS() ?? {};
  if (typeof data !== "object" || Array.isArray(data)) throw new Error("YAML frontmatter must be a mapping of keys to values");
  return { frontmatter: data as Frontmatter, body: text.slice(m[0].length), source };
}

export function serializeMarkdown(type: CmsType, entry: MarkdownEntry): string {
  const fm = entry.source === undefined ? renderNew(type, entry.frontmatter) : renderEdited(entry.source, entry.frontmatter);
  return `---\n${fm}---\n${entry.body}`;
}

/** `src/content/webinars/{en,tr}/<id>.md`. Existing pairs whose files have
 * different names are tied by `translationKey`; find those with
 * src/lib/translations.ts, not with this. */
export function markdownPairPaths(type: CmsType, id: string): { en: string; tr: string } {
  if (type.format !== "markdown-pair") throw new Error(`${type.key} is not a markdown-pair type`);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error(`Invalid id: ${JSON.stringify(id)}`);
  return { en: `${type.dir}/en/${id}.md`, tr: `${type.dir}/tr/${id}.md` };
}

// ── Frontmatter rendering ────────────────────────────────────────────────────

/** Written plain in (nearly) every file: `date: 2020-05-05`, `type: bioinfonet`. */
const PLAIN_KEYS = new Set(["date", "type", "lang"]);

/** Scalar style to use for a value, given the style it had (if any). */
type Style = { scalar?: Scalar.Type; item?: Scalar.Type };

function normalise(value: unknown): unknown {
  // A Date would be written as a timestamp; frontmatter dates are days.
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value;
}

/** One `key: value` pair as YAML, ending in a newline. */
function renderPair(key: string, value: unknown, style: Style): string {
  const doc = new Document({ [key]: normalise(value) });
  const pair = (doc.contents as { items: Pair[] }).items[0];
  const node = pair.value;
  if (isScalar(node)) {
    if (typeof node.value === "string") node.type = style.scalar ?? (PLAIN_KEYS.has(key) ? "PLAIN" : "QUOTE_DOUBLE");
  } else if (isSeq(node)) {
    node.flow = node.items.length === 0;
    for (const item of node.items) {
      if (isScalar(item) && typeof item.value === "string") item.type = style.item ?? "QUOTE_DOUBLE";
    }
  }
  // lineWidth 0: never fold a long description over several lines.
  return doc.toString({ lineWidth: 0 });
}

/**
 * A new entry: the schema's key order (which is also the order the existing
 * files use), then any key the schema does not know. Strings double-quoted,
 * except `date`, `type` and `lang`, which every file writes plain; empty lists
 * as `[]`, others as a block list of quoted items. Keys whose value is
 * undefined are left out.
 */
function renderNew(type: CmsType, fm: Frontmatter): string {
  const shape = (type.schema as { shape?: Record<string, unknown> }).shape ?? {};
  const known = Object.keys(shape).filter((k) => k in fm);
  const rest = Object.keys(fm).filter((k) => !(k in shape));
  return [...known, ...rest]
    .filter((k) => fm[k] !== undefined)
    .map((k) => renderPair(k, fm[k], {}))
    .join("");
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The style a node was written in, to carry over to its new value. */
function styleOf(node: unknown): Style {
  if (isScalar(node)) return { scalar: node.type };
  if (isSeq(node)) {
    const first = (node as YAMLSeq).items.find(isScalar);
    return { item: first?.type };
  }
  return {};
}

/**
 * An edited entry. The source is cut into one chunk per top-level key, from
 * the key to the next key, so a trailing comment or blank line stays with the
 * key before it. An unchanged key keeps its chunk byte for byte. A changed key
 * has only its `key: value` part re-rendered (in the style the value had,
 * when that is still valid YAML for the new value), keeping what followed it
 * on its chunk. A removed key loses its chunk. A new key is added after the
 * last key's content, before any trailing blank lines.
 */
function renderEdited(source: string, fm: Frontmatter): string {
  const doc = parseDocument(source);
  const contents = doc.contents;
  if (contents !== null && !isMap(contents)) throw new Error("YAML frontmatter must be a mapping of keys to values");
  const pairs = (contents?.items ?? []) as Pair[];
  const before = doc.toJS() ?? {};

  const startOf = (p: Pair) => (p.key as Scalar).range![0];
  const head = pairs.length > 0 ? source.slice(0, startOf(pairs[0])) : source;
  let out = head;
  const seen = new Set<string>();

  pairs.forEach((p, i) => {
    const key = String((p.key as Scalar).value);
    seen.add(key);
    const start = startOf(p);
    const end = i + 1 < pairs.length ? startOf(pairs[i + 1]) : source.length;
    const chunk = source.slice(start, end);
    if (!(key in fm) || fm[key] === undefined) return;
    if (sameValue(fm[key], before[key])) {
      out += chunk;
      return;
    }
    // The pair's own text ends where its value does; after that come any
    // comment, the line break and blank lines, which stay.
    const valueEnd = (p.value as Scalar | null)?.range?.[1] ?? (p.key as Scalar).range![1];
    const own = source.slice(start, valueEnd);
    let rendered = renderPair(key, fm[key], styleOf(p.value));
    if (!own.endsWith("\n")) rendered = rendered.slice(0, -1);
    out += rendered + source.slice(valueEnd, end);
  });

  const added = Object.keys(fm).filter((k) => !seen.has(k) && fm[k] !== undefined);
  if (added.length > 0) {
    const text = added.map((k) => renderPair(k, fm[k], {})).join("");
    const trailing = /\n*$/.exec(out)![0];
    // Keep exactly one line break before the new keys; extra blank lines
    // stay at the end, where the file had them.
    const kept = out.slice(0, out.length - trailing.length);
    out = (kept === "" ? "" : `${kept}\n`) + text + trailing.slice(1);
  }
  return out;
}
