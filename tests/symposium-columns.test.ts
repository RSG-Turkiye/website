import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every symposium column is named everywhere it has to be named.
 *
 * A symposium row's column list is written out by hand in seven places: the
 * row interface, two `Record<SymposiumKind, string>` column constants, the
 * public endpoint's SELECT, the archive route's SELECT, the INSERT and the
 * UPDATE. Adding `teams` to the committee meant editing all seven, and the
 * failure mode of missing one is not a type error -- it is a D1 "no such
 * column" 500 on the admin list, or, worse, a column that reads back as
 * undefined and quietly writes an empty value over a real one.
 *
 * This is the recurring bug in this repo: the same fact stored twice drifts.
 * The interfaces in functions/_lib/symposium.ts mirror the CREATE TABLEs and
 * are the one place a column is declared; everything else is checked against
 * them rather than against a list somebody has to remember to extend.
 */

const LIB = new URL('../functions/_lib/symposium.ts', import.meta.url).pathname;
const FUNCTIONS = new URL('../functions/', import.meta.url).pathname;
const SCHEMA = new URL('../db/schema.sql', import.meta.url).pathname;

const TABLES = {
  symposium_speakers: 'SpeakerRow',
  symposium_sessions: 'SessionRow',
  symposium_committee: 'CommitteeRow',
} as const;

const lib = readFileSync(LIB, 'utf8');

/** The fields of a one-line `export interface XRow { a: string; b: number }`. */
function interfaceFields(name: string): string[] {
  const match = new RegExp(`export interface ${name} \\{([^}]*)\\}`).exec(lib);
  assert.ok(match, `${name} is not declared in functions/_lib/symposium.ts`);
  return match[1]
    .split(';')
    .map((part) => part.trim().split(':')[0].trim())
    .filter(Boolean);
}

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (name.endsWith('.ts')) out.push(path);
  }
  return out;
}

const files = sources(FUNCTIONS);
const all = files.map((path) => ({ path, text: readFileSync(path, 'utf8') }));

const names = (list: string) => list.split(',').map((c) => c.trim()).filter(Boolean);

test('the row interfaces match their CREATE TABLE statements', () => {
  // The interfaces are the reference every check below uses, so they are
  // themselves checked against the thing they claim to mirror.
  const sql = readFileSync(SCHEMA, 'utf8');
  for (const [table, iface] of Object.entries(TABLES)) {
    const create = new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`).exec(sql);
    assert.ok(create, `${table} is not in db/schema.sql`);
    const columns = create[1]
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('--'))
      .map((line) => line.split(/\s+/)[0]);
    assert.deepEqual(
      [...columns].sort(),
      [...interfaceFields(iface)].sort(),
      `${iface} and ${table} disagree about which columns exist`,
    );
  }
});

test('every SELECT of a symposium table lists every column of it', () => {
  // A column left out of a SELECT reads back as undefined, and undefined is
  // what then gets written over the real value on the next save.
  let checked = 0;
  for (const { path, text } of all) {
    for (const [, list, table] of text.matchAll(/SELECT\s+([\w\s,]+?)\s+FROM\s+(symposium_\w+)/gi)) {
      const iface = TABLES[table as keyof typeof TABLES];
      if (!iface) continue;
      checked++;
      const missing = interfaceFields(iface).filter((f) => !names(list).includes(f));
      assert.deepEqual(missing, [], `${path}: SELECT ... FROM ${table} is missing ${missing.join(', ')}`);
    }
  }
  assert.ok(checked >= 3, `expected the literal SELECTs, found ${checked}`);
});

test('the per-kind column constants list every column', () => {
  // These are the SELECT lists the admin routes interpolate --
  // `SELECT ${LIST_COLUMNS[kind]} FROM ${table}` -- so the regex above
  // cannot see them.
  let checked = 0;
  for (const { path, text } of all) {
    // Named ...COLUMNS, to skip KIND_TABLES -- the same Record type, but
    // its values are table names rather than column lists.
    for (const [, body] of text.matchAll(/\w*COLUMNS\w*: Record<SymposiumKind, string> = \{([^}]*)\}/g)) {
      for (const [, kind, list] of body.matchAll(/(\w+):\s*'([^']*)'/g)) {
        const table = `symposium_${kind}` as keyof typeof TABLES;
        assert.ok(TABLES[table], `${path}: unknown kind ${kind}`);
        checked++;
        const missing = interfaceFields(TABLES[table]).filter((f) => !names(list).includes(f));
        assert.deepEqual(missing, [], `${path}: the ${kind} column list is missing ${missing.join(', ')}`);
      }
    }
  }
  assert.ok(checked >= 3, `expected the column constants, found ${checked}`);
});

test('every INSERT writes every column', () => {
  // A column left out of an INSERT takes its default silently -- a new
  // committee member with no teams, saved from a form that had them.
  let checked = 0;
  for (const { path, text } of all) {
    for (const [, table, list] of text.matchAll(/INSERT INTO (symposium_\w+) \(([^)]*)\)/gi)) {
      const iface = TABLES[table as keyof typeof TABLES];
      if (!iface) continue;
      checked++;
      const missing = interfaceFields(iface).filter((f) => !names(list).includes(f));
      assert.deepEqual(missing, [], `${path}: INSERT INTO ${table} is missing ${missing.join(', ')}`);
    }
  }
  assert.ok(checked >= 3, `expected the INSERTs, found ${checked}`);
});

test('every UPDATE sets every editable column', () => {
  // `id`, `year` and `sort` are deliberately not editable here: the route
  // reads the year from the existing row and manages sort itself. Everything
  // else the editor can change must be in the SET, or a cleared field stays
  // as it was and the editor is never told.
  const NOT_EDITABLE = new Set(['id', 'year', 'sort']);
  let checked = 0;
  for (const { path, text } of all) {
    for (const [, table, body] of text.matchAll(/UPDATE (symposium_\w+)\s+SET([\s\S]*?)WHERE/gi)) {
      const iface = TABLES[table as keyof typeof TABLES];
      if (!iface) continue;
      checked++;
      const set = [...body.matchAll(/(\w+)\s*=\s*\?/g)].map(([, c]) => c);
      const missing = interfaceFields(iface).filter((f) => !NOT_EDITABLE.has(f) && !set.includes(f));
      assert.deepEqual(missing, [], `${path}: UPDATE ${table} does not set ${missing.join(', ')}`);
    }
  }
  assert.ok(checked >= 3, `expected the UPDATEs, found ${checked}`);
});
