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

import { Document, isMap, isScalar, isSeq, parseDocument, Scalar, YAMLMap, YAMLSeq, type Pair } from "yaml";
import { checkId, type CmsType } from "./types";

// ── JSON ─────────────────────────────────────────────────────────────────────

/** The entry as written in the file: dates stay "YYYY-MM-DD" strings, the
 * schema's input, not its parsed output. */
export function parseJson(_type: CmsType, text: string): unknown {
  return JSON.parse(text);
}

/** Two-space indent, keys in the schema's order, a trailing newline: the
 * format of every existing file. Keys are reordered so that an entry built in
 * any order (a new one from the panel's form) is written like the others. */
export function serializeJson(type: CmsType, data: unknown): string {
  return `${JSON.stringify(inSchemaOrder(type.schema, data), null, 2)}\n`;
}

type ZodDef = { type: string; innerType?: unknown; in?: unknown; element?: unknown; shape?: Record<string, unknown> };
const defOf = (schema: unknown): ZodDef | undefined => (schema as { _zod?: { def: ZodDef } } | undefined)?._zod?.def;

/** The schema under optional/default/nullable/pipe wrappers. */
function unwrap(schema: unknown): unknown {
  let s = schema;
  for (let def = defOf(s); def; def = defOf(s)) {
    if (def.innerType) s = def.innerType;
    else if (def.type === "pipe" && def.in) s = def.in;
    else break;
  }
  return s;
}

/** `value` with object keys in the schema's shape order, recursively; keys
 * the schema does not know follow in their own order. */
function inSchemaOrder(schema: unknown, value: unknown): unknown {
  const def = defOf(unwrap(schema));
  if (Array.isArray(value)) return def?.type === "array" ? value.map((v) => inSchemaOrder(def.element, v)) : value;
  if (value === null || typeof value !== "object" || def?.type !== "object" || !def.shape) return value;
  const shape = def.shape;
  const obj = value as Record<string, unknown>;
  const keys = [...Object.keys(shape).filter((k) => k in obj), ...Object.keys(obj).filter((k) => !(k in shape))];
  return Object.fromEntries(keys.map((k) => [k, k in shape ? inSchemaOrder(shape[k], obj[k]) : obj[k]]));
}

/** `<dir>/<id>.json`, after checking the id is a file-name slug. */
export function jsonPath(type: CmsType, id: string): string {
  if (type.format !== "json") throw new Error(`${type.key} is not a json type`);
  return `${type.dir}/${checkId(id)}.json`;
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
  if (entry.source !== undefined) return `---\n${renderEdited(type, entry.source, entry.frontmatter)}---\n${entry.body}`;
  return `---\n${renderNew(type, entry.frontmatter)}---\n${newBody(entry.body)}`;
}

/** A new file's body in the repository's format: a blank line after the
 * frontmatter and one final line break. An empty body stays empty (a
 * learning-path file is frontmatter only). A file read from disk (with
 * `source`) keeps its body as it is. */
function newBody(body: string): string {
  if (body.trim() === "") return body;
  return `\n${body.replace(/^(\r?\n)+/, "").replace(/(\r?\n)*$/, "")}\n`;
}

/** `src/content/webinars/{en,tr}/<id>.md`. Existing pairs whose files have
 * different names are tied by `translationKey`; find those with
 * src/lib/translations.ts, not with this. */
export function markdownPairPaths(type: CmsType, id: string): { en: string; tr: string } {
  if (type.format !== "markdown-pair") throw new Error(`${type.key} is not a markdown-pair type`);
  checkId(id);
  return { en: `${type.dir}/en/${id}.md`, tr: `${type.dir}/tr/${id}.md` };
}

// ── Frontmatter rendering ────────────────────────────────────────────────────

/** Written plain in (nearly) every file: `date: 2020-05-05`, `pubDate: 2026-01-05`, `type: bioinfonet`. */
const PLAIN_KEYS = new Set(["date", "pubDate", "type", "lang"]);

/** Scalar style to use for a value, given the style it had (if any). */
type Style = { scalar?: Scalar.Type; item?: Scalar.Type };

/** A value with a line break is written double-quoted with `\n` escapes,
 * whatever its style was: a plain or block scalar would run over several
 * lines and swallow a trailing `# comment` on the key's line into the value. */
function scalarType(value: string, wanted: Scalar.Type | undefined): Scalar.Type | undefined {
  return /[\n\r]/.test(value) ? "QUOTE_DOUBLE" : wanted;
}

function normalise(value: unknown): unknown {
  // A Date would be written as a timestamp; frontmatter dates are days.
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value;
}

/** The default style below the top level: inside a list of objects (a
 * learning path's sections and resources) every string is double-quoted,
 * except under the keys in PLAIN_KEYS, as at the top; empty lists and
 * objects are `[]` and `{}`, others block style. One fixed rule, so a changed
 * list is written exactly as the rest of the file was. */
function styleNested(node: unknown, key: string): void {
  if (isScalar(node)) {
    if (typeof node.value === "string") node.type = scalarType(node.value, PLAIN_KEYS.has(key) ? "PLAIN" : "QUOTE_DOUBLE");
  } else if (isSeq(node)) {
    node.flow = node.items.length === 0;
    for (const item of node.items) styleNested(item, "");
  } else if (isMap(node)) {
    node.flow = node.items.length === 0;
    for (const p of (node as YAMLMap).items as Pair[]) styleNested(p.value, String((p.key as Scalar).value));
  }
}

/** One `key: value` pair as YAML, ending in a newline. */
function renderPair(key: string, value: unknown, style: Style): string {
  const doc = new Document({ [key]: normalise(value) });
  const pair = (doc.contents as { items: Pair[] }).items[0];
  const node = pair.value;
  if (isScalar(node)) {
    if (typeof node.value === "string") node.type = scalarType(node.value, style.scalar ?? (PLAIN_KEYS.has(key) ? "PLAIN" : "QUOTE_DOUBLE"));
  } else if (isSeq(node)) {
    node.flow = node.items.length === 0;
    for (const item of node.items) {
      if (isScalar(item) && typeof item.value === "string") item.type = scalarType(item.value, style.item ?? "QUOTE_DOUBLE");
      else if (!isScalar(item)) styleNested(item, "");
    }
  } else if (isMap(node)) {
    styleNested(node, key);
  }
  // lineWidth 0: never fold a long description over several lines.
  // doubleQuotedMinMultiLineLength: a quoted value with line breaks is written
  // as "a\nb" on one line, never folded across lines.
  return doc.toString({ lineWidth: 0, doubleQuotedMinMultiLineLength: Infinity });
}

/** The schema of one top-level frontmatter key, if the type's schema has it. */
function keySchema(type: CmsType, key: string): unknown {
  return defOf(unwrap(type.schema))?.shape?.[key];
}

/**
 * A new entry: keys in the schema's order at every depth (which is also the
 * order the existing files use), then any key the schema does not know.
 * Strings double-quoted, except `date`, `type` and `lang`, which every file
 * writes plain; empty lists as `[]`, others as block lists. Keys whose value
 * is undefined are left out.
 */
function renderNew(type: CmsType, fm: Frontmatter): string {
  const ordered = inSchemaOrder(type.schema, fm) as Frontmatter;
  return Object.keys(ordered)
    .filter((k) => ordered[k] !== undefined)
    .map((k) => renderPair(k, ordered[k], {}))
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
 * on its chunk. A removed key loses its chunk. A new key the schema knows
 * goes at its schema position: just before the first key in the file that
 * the schema lists after it. So a key added by the panel lands where a newly
 * written file would have it. A new key with no such key after it, or one
 * the schema does not know, is added after the last key's content, before
 * any trailing blank lines.
 */
function renderEdited(type: CmsType, source: string, fm: Frontmatter): string {
  const doc = parseDocument(source);
  const contents = doc.contents;
  if (contents !== null && !isMap(contents)) throw new Error("YAML frontmatter must be a mapping of keys to values");
  const pairs = (contents?.items ?? []) as Pair[];
  const before = doc.toJS() ?? {};

  const startOf = (p: Pair) => (p.key as Scalar).range![0];
  const nameOf = (p: Pair) => String((p.key as Scalar).value);
  const schemaKeys = Object.keys(defOf(unwrap(type.schema))?.shape ?? {});
  const rank = (k: string) => schemaKeys.indexOf(k);
  const render = (k: string) => renderPair(k, inSchemaOrder(keySchema(type, k), fm[k]), {});

  // New keys, in schema order; each goes before the first later key, or last.
  const added = Object.keys(fm)
    .filter((k) => fm[k] !== undefined && !pairs.some((p) => nameOf(p) === k))
    .sort((a, b) => (rank(a) < 0 ? Infinity : rank(a)) - (rank(b) < 0 ? Infinity : rank(b)));
  const insertBefore = new Map<number, string[]>();
  const atEnd: string[] = [];
  for (const k of added) {
    const at = rank(k) < 0 ? -1 : pairs.findIndex((p) => rank(nameOf(p)) > rank(k));
    if (at < 0) atEnd.push(k);
    else insertBefore.set(at, [...(insertBefore.get(at) ?? []), k]);
  }

  const head = pairs.length > 0 ? source.slice(0, startOf(pairs[0])) : source;
  let out = head;

  pairs.forEach((p, i) => {
    const key = nameOf(p);
    out += (insertBefore.get(i) ?? []).map(render).join("");
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
    let rendered = renderPair(key, inSchemaOrder(keySchema(type, key), fm[key]), styleOf(p.value));
    if (!own.endsWith("\n")) rendered = rendered.slice(0, -1);
    out += rendered + source.slice(valueEnd, end);
  });

  if (atEnd.length > 0) {
    const text = atEnd.map(render).join("");
    const trailing = /\n*$/.exec(out)![0];
    // Keep exactly one line break before the new keys; extra blank lines
    // stay at the end, where the file had them.
    const kept = out.slice(0, out.length - trailing.length);
    out = (kept === "" ? "" : `${kept}\n`) + text + trailing.slice(1);
  }
  return out;
}
