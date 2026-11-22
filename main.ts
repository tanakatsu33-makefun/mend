// main.ts is mend, the CLI SPEC.md specifies, and this is the kit's starting point for it (MIT). It does sections 1 to 4, 9 and 10 of SPEC.md: the command line, the output and
// exit codes, safe paths, format detection, JSON edits and the all-or-nothing write. The other three formats are
// detected and then read as holding no edit, so they answer `error: parse 1`: reading unified diffs (section 6),
// SEARCH/REPLACE blocks (section 7) and V4A patches (section 8), and matching lines at three tiers (section 5), are
// yours to write. Node 22, the standard library alone; run it as `node main.ts [options] [PATCH]`.
//
// In a trial the grader runs `node /bot/main.ts` with MAKEFUN_ENV_URL set, and then this file hands over to runner.ts
// (the last lines below): keep that hand-over and runner.ts as they are, and write the CLI.

import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

const FORMATS = ['auto', 'unified', 'search-replace', 'v4a', 'json'];

class Exit2 {
  readonly line: string;
  constructor(line: string) {
    this.line = line;
  }
}
class Fail {
  readonly code: string;
  readonly path: string;
  constructor(code: string, path: string) {
    this.code = code;
    this.path = path;
  }
}

const blank = (s: string): boolean => s.trim() === '';

function patchLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (text.endsWith('\n')) lines.pop();
  return lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
}

function safe(p: string): boolean {
  return p !== '' && !p.startsWith('/') && !p.includes('\\') && p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

/** The tree as the edits leave it: changed paths in `now` (null: deleted), the rest read from disk. */
class Tree {
  private readonly orig = new Map<string, string | null>();
  readonly now = new Map<string, string | null>();
  original(p: string): string | null {
    if (!this.orig.has(p)) {
      let v: string | null = null;
      try {
        if (statSync(p).isFile()) v = readFileSync(p, 'utf8');
      } catch {
        v = null;
      }
      this.orig.set(p, v);
    }
    return this.orig.get(p)!;
  }
  get(p: string): string | null {
    return this.now.has(p) ? this.now.get(p)! : this.original(p);
  }
  /** Successful move edits, in order, as [old, new]. */
  moves: Array<[string, string]> = [];
  put(p: string, text: string | null): void {
    this.now.set(p, text);
  }
}

type Edit = (tree: Tree) => void;

/** A file as lines (SPEC.md section 3). */
interface Doc {
  lines: string[];
  br: string;
  final: boolean;
}
function toDoc(text: string): Doc {
  const nl = text.indexOf('\n');
  const br = nl > 0 && text[nl - 1] === '\r' ? '\r\n' : '\n';
  if (text === '') return { lines: [], br, final: false };
  const lines = text.split(br);
  const final = text.endsWith(br);
  if (final) lines.pop();
  return { lines, br, final };
}
function fromDoc(d: Doc): string {
  return d.lines.length === 0 ? '' : d.lines.join(d.br) + (d.final ? d.br : '');
}

// ---- section 5: matching lines at three tiers ----
const TIERS: Array<(s: string) => string> = [(s) => s, (s) => s.replace(/[ \t]+$/, ''), (s) => s.replace(/^[ \t]+|[ \t]+$/g, '')];

interface Found {
  tier: number;
  at: number[];
}
/** Occurrences of `old` in `file` at the first tier that has one; `from` limits the start, `mustEnd` the end. */
function occurrences(file: string[], old: string[], strict: boolean, from = 0, mustEnd = false): Found | null {
  for (let tier = 0; tier < (strict ? 1 : 3); tier++) {
    const f = TIERS[tier]!;
    const nf = file.map(f);
    const no = old.map(f);
    const at: number[] = [];
    for (let i = from; i + no.length <= nf.length; i++) {
      if (mustEnd && i + no.length !== nf.length) continue;
      let ok = true;
      for (let j = 0; j < no.length; j++) {
        if (nf[i + j] !== no[j]) {
          ok = false;
          break;
        }
      }
      if (ok) at.push(i);
    }
    if (at.length > 0) return { tier, at };
  }
  return null;
}

interface Item {
  kind: ' ' | '-' | '+';
  text: string;
  nonl?: boolean;
}
const oldOf = (items: Item[]): Item[] => items.filter((x) => x.kind !== '+');
const newOf = (items: Item[]): Item[] => items.filter((x) => x.kind !== '-');
const indentOf = (s: string): string => /^[ \t]*/.exec(s)![0];

/** The lines that replace the matched file lines at `at` (tier `tier`) for the edit `items`. */
function replacement(file: string[], items: Item[], at: number, tier: number): string[] {
  const out: string[] = [];
  const O = oldOf(items);
  const F = indentOf(file[at]!);
  const P = O.length > 0 ? indentOf(O[0]!.text) : '';
  let k = 0;
  for (const it of items) {
    if (it.kind === '-') k += 1;
    else if (it.kind === ' ') out.push(file[at + k++]!);
    else if (tier === 2 && it.text.trim() !== '' && it.text.startsWith(P)) out.push(F + it.text.slice(P.length));
    else out.push(it.text);
  }
  return out;
}

// ---- section 6: unified diffs ----
interface Hunk {
  a: number;
  items: Item[];
}
interface Section {
  start: number;
  gitOld?: string;
  gitNew?: string;
  paired: boolean;
  minus?: string | null;
  plus?: string | null;
  renFrom?: string;
  renTo?: string;
  isNew: boolean;
  isDel: boolean;
  hunks: Hunk[];
}

function diffPath(rest: string): string | null {
  const tab = rest.indexOf('\t');
  const p = (tab >= 0 ? rest.slice(0, tab) : rest).replace(/^ +| +$/g, '');
  if (p === '/dev/null') return null;
  return p.startsWith('a/') || p.startsWith('b/') ? p.slice(2) : p;
}

function parseUnified(lines: string[]): Section[] {
  const secs: Section[] = [];
  let cur: Section | null = null;
  const pairAt = (k: number): boolean => lines[k]!.startsWith('--- ') && (lines[k + 1] ?? '').startsWith('+++ ');
  const fresh = (start: number): Section => {
    const s: Section = { start, paired: false, isNew: false, isDel: false, hunks: [] };
    secs.push(s);
    return s;
  };
  let i = 0;
  while (i < lines.length) {
    const l = lines[i]!;
    if (l.startsWith('diff --git ')) {
      const rest = l.slice(11);
      const cuts: number[] = [];
      for (let k = rest.indexOf(' b/'); k >= 0; k = rest.indexOf(' b/', k + 1)) cuts.push(k);
      if (!rest.startsWith('a/') || cuts.length === 0) throw new Exit2(`error: parse ${i + 1}`);
      const cut = cuts.find((k) => rest.slice(2, k) === rest.slice(k + 3)) ?? cuts[0]!;
      cur = fresh(i);
      cur.gitOld = rest.slice(2, cut);
      cur.gitNew = rest.slice(cut + 3);
      if (cur.gitOld === '' || cur.gitNew === '') throw new Exit2(`error: parse ${i + 1}`);
      i += 1;
      continue;
    }
    if (l.startsWith('--- ')) {
      const inHeader = cur !== null && cur.hunks.length === 0;
      if (pairAt(i)) {
        if (!(inHeader && !cur!.paired)) cur = fresh(i);
        cur!.paired = true;
        cur!.minus = diffPath(l.slice(4));
        cur!.plus = diffPath(lines[i + 1]!.slice(4));
        i += 2;
        continue;
      }
      if (inHeader) throw new Exit2(`error: parse ${i + 2}`);
      i += 1;
      continue;
    }
    if (l.startsWith('@@')) {
      const m = /^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/.exec(l);
      if (m === null || cur === null) throw new Exit2(`error: parse ${i + 1}`);
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const b = lines[j]!;
        if (!(b === '' || b[0] === ' ' || b[0] === '-' || b[0] === '+' || b[0] === '\\')) break;
        if (pairAt(j)) break;
        body.push(b);
        j += 1;
      }
      while (body.length > 0 && body[body.length - 1] === '') body.pop();
      const items: Item[] = [];
      for (const b of body) {
        if (b[0] === '\\') {
          if (items.length > 0) items[items.length - 1]!.nonl = true;
        } else items.push({ kind: b === '' ? ' ' : (b[0] as Item['kind']), text: b.slice(1) });
      }
      cur.hunks.push({ a: Number(m[1]), items });
      i = j;
      continue;
    }
    if (cur !== null && cur.hunks.length === 0) {
      if (l.startsWith('rename from ')) cur.renFrom = l.slice(12);
      else if (l.startsWith('rename to ')) cur.renTo = l.slice(10);
      else if (l.startsWith('new file mode')) cur.isNew = true;
      else if (l.startsWith('deleted file mode')) cur.isDel = true;
    }
    i += 1;
  }
  return secs;
}

/** Apply a section's hunks to a document (SPEC.md section 6, "Applying hunks"). */
function applyHunks(doc: Doc, hunks: Hunk[], strict: boolean, path: string): void {
  let d = 0;
  for (const h of hunks) {
    const O = oldOf(h.items);
    const N = newOf(h.items);
    const nonl = N.length > 0 && N[N.length - 1]!.nonl === true;
    if (O.length === 0) {
      if (N.length > 0) {
        const pos = Math.min(Math.max(h.a + d, 0), doc.lines.length);
        const atEnd = pos === doc.lines.length;
        doc.lines.splice(pos, 0, ...N.map((x) => x.text));
        if (atEnd) doc.final = !nonl;
      }
    } else {
      const found = occurrences(doc.lines, O.map((x) => x.text), strict);
      if (found === null) throw new Fail('no-match', path);
      const want = h.a - 1 + d;
      let at = found.at[0]!;
      for (const p of found.at) if (Math.abs(p - want) < Math.abs(at - want)) at = p;
      const repl = replacement(doc.lines, h.items, at, found.tier);
      if (at + O.length === doc.lines.length) doc.final = !nonl;
      doc.lines.splice(at, O.length, ...repl);
    }
    d += N.length - O.length;
  }
}

// ---- section 7: SEARCH/REPLACE blocks ----
function searchReplaceEdits(lines: string[], strict: boolean): Edit[] {
  const edits: Edit[] = [];
  let prevEnd = -1;
  let prevPath: string | null = null;
  let i = 0;
  while (i < lines.length) {
    if (lines[i]!.trimEnd() !== '<<<<<<< SEARCH') {
      i += 1;
      continue;
    }
    const s = i;
    const mid = lines.findIndex((l, k) => k > s && l.trimEnd() === '=======');
    const end = mid < 0 ? -1 : lines.findIndex((l, k) => k > mid && l.trimEnd() === '>>>>>>> REPLACE');
    if (end < 0) throw new Exit2(`error: parse ${s + 1}`);
    let path: string | null = null;
    for (let k = s - 1; k > prevEnd; k--) {
      const t = lines[k]!.trim();
      if (t !== '' && !t.startsWith('```')) {
        path = t;
        break;
      }
    }
    if (path === null) path = prevPath;
    if (path === null) throw new Exit2(`error: parse ${s + 1}`);
    prevPath = path;
    prevEnd = end;
    const oldLines = lines.slice(s + 1, mid);
    const newLines = lines.slice(mid + 1, end);
    const p = path;
    edits.push((tree) => {
      if (!safe(p)) throw new Fail('unsafe', p);
      const text = tree.get(p);
      if (oldLines.length === 0) {
        if (text !== null) throw new Fail('exists', p);
        tree.put(p, newLines.length === 0 ? '' : newLines.join('\n') + '\n');
        return;
      }
      if (text === null) throw new Fail('missing', p);
      const doc = toDoc(text);
      const found = occurrences(doc.lines, oldLines, strict);
      if (found === null) throw new Fail('no-match', p);
      if (found.at.length > 1) throw new Fail('ambiguous', p);
      const items: Item[] = [...oldLines.map((t): Item => ({ kind: '-', text: t })), ...newLines.map((t): Item => ({ kind: '+', text: t }))];
      doc.lines.splice(found.at[0]!, oldLines.length, ...replacement(doc.lines, items, found.at[0]!, found.tier));
      tree.put(p, fromDoc(doc));
    });
    i = end + 1;
  }
  return edits;
}

// ---- section 8: V4A patches ----
interface Chunk {
  anchor: string | null;
  items: Item[];
  eof: boolean;
  open: boolean;
}

function v4aEdits(lines: string[], strict: boolean): Edit[] {
  const nonBlank: number[] = [];
  lines.forEach((l, k) => {
    if (!blank(l)) nonBlank.push(k);
  });
  if (nonBlank.length === 0 || lines[nonBlank[0]!]!.trim() !== '*** Begin Patch') throw new Exit2(`error: parse ${nonBlank.length === 0 ? 1 : nonBlank[0]! + 1}`);
  const last = nonBlank[nonBlank.length - 1]!;
  if (lines[last]!.trim() !== '*** End Patch' || last === nonBlank[0]) throw new Exit2(`error: parse ${lines.length + 1}`);
  const edits: Edit[] = [];
  const kinds = ['*** Add File: ', '*** Delete File: ', '*** Update File: '];
  const startOf = (l: string): number => kinds.findIndex((k) => l.startsWith(k));
  let i = nonBlank[0]! + 1;
  while (i < last) {
    const head = lines[i]!;
    if (blank(head)) {
      i += 1;
      continue;
    }
    const kind = startOf(head);
    if (kind < 0) throw new Exit2(`error: parse ${i + 1}`);
    const path = head.slice(kinds[kind]!.length).replace(/^ +| +$/g, '');
    let j = i + 1;
    while (j < last && startOf(lines[j]!) < 0) j += 1;
    let stop = j;
    while (stop > i + 1 && blank(lines[stop - 1]!)) stop -= 1;
    const body = lines.slice(i + 1, stop);
    const at = (k: number): number => i + 2 + k; // 1-based number of body line k
    if (kind === 0) {
      const out = body.map((l, k) => {
        if (l === '') return '';
        if (l[0] !== '+') throw new Exit2(`error: parse ${at(k)}`);
        return l.slice(1);
      });
      edits.push((tree) => {
        if (!safe(path)) throw new Fail('unsafe', path);
        if (tree.get(path) !== null) throw new Fail('exists', path);
        tree.put(path, out.length === 0 ? '' : out.join('\n') + '\n');
      });
    } else if (kind === 1) {
      if (body.length > 0) throw new Exit2(`error: parse ${at(0)}`);
      edits.push((tree) => {
        if (!safe(path)) throw new Fail('unsafe', path);
        if (tree.get(path) === null) throw new Fail('missing', path);
        tree.put(path, null);
      });
    } else {
      let moveTo: string | null = null;
      let from = 0;
      if (body.length > 0 && body[0]!.startsWith('*** Move to: ')) {
        moveTo = body[0]!.slice(13).replace(/^ +| +$/g, '');
        from = 1;
      }
      const chunks: Chunk[] = [];
      for (let k = from; k < body.length; k++) {
        const l = body[k]!;
        const top = chunks.length > 0 ? chunks[chunks.length - 1]! : null;
        if (l.startsWith('@@')) {
          const a = l.slice(2).replace(/^[ \t]+|[ \t]+$/g, '');
          chunks.push({ anchor: a === '' ? null : a, items: [], eof: false, open: true });
        } else if (l === '*** End of File') {
          if (top !== null && top.open) {
            top.eof = true;
            top.open = false;
          } else chunks.push({ anchor: null, items: [], eof: true, open: false });
        } else if (l === '' || l[0] === ' ' || l[0] === '-' || l[0] === '+') {
          let cur = top;
          if (cur === null) {
            cur = { anchor: null, items: [], eof: false, open: true };
            chunks.push(cur);
          } else if (!cur.open) throw new Exit2(`error: parse ${at(k)}`);
          cur.items.push({ kind: l === '' ? ' ' : (l[0] as Item['kind']), text: l.slice(1) });
        } else throw new Exit2(`error: parse ${at(k)}`);
      }
      if (chunks.length === 0 && moveTo === null) throw new Exit2(`error: parse ${i + 1}`);
      const target = moveTo;
      edits.push((tree) => {
        if (!safe(path)) throw new Fail('unsafe', path);
        if (target !== null && !safe(target)) throw new Fail('unsafe', target);
        const text = tree.get(path);
        if (text === null) throw new Fail('missing', path);
        if (target !== null && tree.get(target) !== null) throw new Fail('exists', target);
        const doc = toDoc(text);
        let cursor = 0;
        for (const c of chunks) {
          if (c.anchor !== null) {
            const found = occurrences(doc.lines.slice(cursor), [c.anchor], strict);
            if (found === null) throw new Fail('no-match', path);
            cursor += found.at[0]! + 1;
          }
          const O = oldOf(c.items);
          const N = newOf(c.items);
          let pos: number;
          let tier = 0;
          if (O.length === 0) pos = c.eof ? doc.lines.length : cursor;
          else {
            const found = occurrences(doc.lines, O.map((x) => x.text), strict, cursor, c.eof);
            if (found === null) throw new Fail('no-match', path);
            pos = found.at[0]!;
            tier = found.tier;
          }
          const repl = O.length === 0 ? N.map((x) => x.text) : replacement(doc.lines, c.items, pos, tier);
          doc.lines.splice(pos, O.length, ...repl);
          cursor = pos + repl.length;
        }
        if (target !== null) {
          tree.put(path, null);
          tree.moves.push([path, target]);
          tree.put(target, fromDoc(doc));
        } else tree.put(path, fromDoc(doc));
      });
    }
    i = j;
  }
  return edits;
}

function unifiedEdits(lines: string[], strict: boolean): Edit[] {
  return parseUnified(lines).map((s): Edit => {
    const oldP = s.paired ? s.minus : (s.renFrom ?? s.gitOld);
    const newP = s.paired ? s.plus : (s.renTo ?? s.gitNew);
    const parseFault = new Exit2(`error: parse ${s.start + 1}`);
    if (s.isNew || oldP === null) {
      const p = newP;
      if (p === null || p === undefined) throw parseFault;
      return (tree) => {
        if (!safe(p)) throw new Fail('unsafe', p);
        if (tree.get(p) !== null) throw new Fail('exists', p);
        const adds = s.hunks.flatMap((h) => h.items.filter((x) => x.kind === '+'));
        const nonl = adds.length > 0 && adds[adds.length - 1]!.nonl === true;
        tree.put(p, adds.length === 0 ? '' : adds.map((x) => x.text).join('\n') + (nonl ? '' : '\n'));
      };
    }
    if (s.isDel || newP === null) {
      const p = oldP;
      if (p === null || p === undefined) throw parseFault;
      return (tree) => {
        if (!safe(p)) throw new Fail('unsafe', p);
        if (tree.get(p) === null) throw new Fail('missing', p);
        tree.put(p, null);
      };
    }
    if (oldP === undefined || newP === undefined) throw parseFault;
    return (tree) => {
      if (!safe(oldP)) throw new Fail('unsafe', oldP);
      if (!safe(newP)) throw new Fail('unsafe', newP);
      const text = tree.get(oldP);
      if (text === null) throw new Fail('missing', oldP);
      const move = oldP !== newP;
      if (move && tree.get(newP) !== null) throw new Fail('exists', newP);
      const doc = toDoc(text);
      applyHunks(doc, s.hunks, strict, oldP);
      if (move) {
        tree.put(oldP, null);
        tree.moves.push([oldP, newP]);
      }
      tree.put(newP, fromDoc(doc));
    };
  });
}

function detect(lines: string[]): string | null {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) return null;
  if (lines[first]!.trim() === '*** Begin Patch') return 'v4a';
  const c = lines[first]!.trimStart()[0];
  if (c === '[' || c === '{') return 'json';
  if (lines.some((l) => l.trimEnd() === '<<<<<<< SEARCH')) return 'search-replace';
  if (lines.some((l, i) => l.startsWith('diff --git ') || (l.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')))) return 'unified';
  return null;
}

/** One JSON edit object (SPEC.md section 9), or null when it is not one. */
function jsonEdit(v: unknown): Edit | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const p = o.path;
  if (typeof p !== 'string') return null;
  const exists = (tree: Tree): string => {
    if (!safe(p)) throw new Fail('unsafe', p);
    const t = tree.get(p);
    if (t === null) throw new Fail('missing', p);
    return t;
  };
  if (o.command === 'create' && typeof o.file_text === 'string') {
    const text = o.file_text;
    return (tree) => {
      if (!safe(p)) throw new Fail('unsafe', p);
      if (tree.get(p) !== null) throw new Fail('exists', p);
      tree.now.set(p, text);
    };
  }
  if (o.command === 'str_replace' && typeof o.old_str === 'string' && o.old_str !== '' && (o.new_str === undefined || typeof o.new_str === 'string')) {
    const oldStr = o.old_str;
    const newStr = (o.new_str as string | undefined) ?? '';
    return (tree) => {
      const before = exists(tree);
      const nl = before.indexOf('\n');
      const crlf = nl > 0 && before[nl - 1] === '\r';
      const lf = (s: string): string => (crlf ? s.replaceAll('\r\n', '\n') : s);
      const t = lf(before);
      const old = lf(oldStr);
      let count = 0;
      for (let k = t.indexOf(old); k >= 0; k = t.indexOf(old, k + 1)) count += 1;
      if (count === 0) throw new Fail('no-match', p);
      if (count > 1) throw new Fail('ambiguous', p);
      const at = t.indexOf(old);
      const out = t.slice(0, at) + lf(newStr) + t.slice(at + old.length);
      tree.now.set(p, crlf ? out.replaceAll('\n', '\r\n') : out);
    };
  }
  if (o.command === 'insert' && typeof o.insert_line === 'number' && Number.isInteger(o.insert_line) && typeof o.new_str === 'string') {
    const line = o.insert_line;
    const add = patchLines(o.new_str);
    return (tree) => {
      const before = exists(tree);
      const nl = before.indexOf('\n');
      const br = nl > 0 && before[nl - 1] === '\r' ? '\r\n' : '\n';
      const lines = before === '' ? [] : before.split(br);
      const final = before !== '' && before.endsWith(br);
      if (final) lines.pop();
      if (line < 0 || line > lines.length) throw new Fail('no-match', p);
      lines.splice(line, 0, ...add);
      tree.now.set(p, lines.length === 0 ? '' : lines.join(br) + (final ? br : ''));
    };
  }
  return null;
}

function jsonEdits(text: string, lines: string[]): Edit[] {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) throw new Exit2('error: parse 1');
  const edits: Edit[] = [];
  if (lines[first]!.trimStart().startsWith('[')) {
    let v: unknown;
    try {
      v = JSON.parse(text);
    } catch {
      throw new Exit2(`error: parse ${first + 1}`);
    }
    if (!Array.isArray(v)) throw new Exit2(`error: parse ${first + 1}`);
    for (const x of v) {
      const e = jsonEdit(x);
      if (e === null) throw new Exit2(`error: parse ${first + 1}`);
      edits.push(e);
    }
    return edits;
  }
  lines.forEach((l, i) => {
    if (blank(l)) return;
    let e: Edit | null = null;
    try {
      e = jsonEdit(JSON.parse(l));
    } catch {
      e = null;
    }
    if (e === null) throw new Exit2(`error: parse ${i + 1}`);
    edits.push(e);
  });
  return edits;
}

function run(args: string[]): { code: number; out: string[] } {
  let format: string | null = null;
  let check = false;
  let strict = false;
  const pos: string[] = [];
  let ended = false;
  for (const a of args) {
    if (!ended && a === '--') ended = true;
    else if (!ended && a.startsWith('-') && a !== '-') {
      if (a.startsWith('--format=') && format === null && FORMATS.includes(a.slice(9))) format = a.slice(9);
      else if (a === '--check' && !check) check = true;
      else if (a === '--strict' && !strict) strict = true;
      else return { code: 2, out: ['error: usage'] };
    } else pos.push(a);
  }
  if (pos.length > 1) return { code: 2, out: ['error: usage'] };
  const file = pos.length === 0 || pos[0] === '-' ? null : pos[0]!;
  let text = '';
  try {
    text = readFileSync(file ?? 0, 'utf8');
  } catch {
    if (file !== null) return { code: 2, out: ['error: no-patch'] };
  }
  const lines = patchLines(text);
  const kind = format === null || format === 'auto' ? detect(lines) : format;
  if (kind === null) return { code: 2, out: ['error: format'] };
  let edits: Edit[];
  try {
    edits = kind === 'json' ? jsonEdits(text, lines) : kind === 'unified' ? unifiedEdits(lines, strict) : kind === 'search-replace' ? searchReplaceEdits(lines, strict) : kind === 'v4a' ? v4aEdits(lines, strict) : [];
    if (edits.length === 0) throw new Exit2('error: parse 1');
  } catch (e) {
    if (e instanceof Exit2) return { code: 2, out: [e.line] };
    throw e;
  }
  const tree = new Tree();
  const fails: Fail[] = [];
  for (const edit of edits) {
    const before = new Map(tree.now);
    const moved = tree.moves.length;
    try {
      edit(tree);
    } catch (e) {
      if (!(e instanceof Fail)) throw e;
      tree.moves.length = moved;
      tree.now.clear();
      for (const [k, v] of before) tree.now.set(k, v);
      fails.push(e);
    }
  }
  if (fails.length > 0) return { code: 1, out: [...fails.map((f) => `error: ${f.code} ${f.path}`), `failed: ${fails.length} of ${edits.length} edits`] };
  // R lines: a move edit whose old path is gone and whose new path is new.
  const renamed = new Map<string, string>(); // new -> old
  const renamedOld = new Set<string>();
  for (const [o, n] of tree.moves) {
    if (renamed.has(n) || renamedOld.has(o)) continue;
    if (tree.original(o) !== null && tree.get(o) === null && tree.original(n) === null && tree.get(n) !== null) {
      renamed.set(n, o);
      renamedOld.add(o);
    }
  }
  const rows: Array<[string, string]> = [];
  const todo: Array<[string, string | null]> = [];
  for (const [p, now] of tree.now) {
    const was = tree.original(p);
    if (was === now) continue;
    todo.push([p, now]);
    if (renamedOld.has(p)) continue;
    if (renamed.has(p)) rows.push([p, `R ${renamed.get(p)} -> ${p}`]);
    else rows.push([p, `${was === null ? 'A' : now === null ? 'D' : 'M'} ${p}`]);
  }
  rows.sort((a, b) => Buffer.compare(Buffer.from(a[0]), Buffer.from(b[0])));
  if (!check) {
    for (const [p, now] of todo) {
      if (now === null) rmSync(p, { force: true });
      else {
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, now);
      }
    }
  }
  return { code: 0, out: [...rows.map((r) => r[1]), `ok: ${rows.length} ${rows.length === 1 ? 'file' : 'files'}`] };
}


const trialEnv = process.env.MAKEFUN_ENV_URL;
if (trialEnv !== undefined && trialEnv !== '') {
  // A trial: the kit's runner reads the checks from the env and runs this file on each one, without this variable.
  const { runTrial } = await import('./runner.ts');
  await runTrial(trialEnv);
} else {
  const r = run(process.argv.slice(2));
  writeSync(1, r.out.map((l) => `${l}\n`).join(''));
  process.exitCode = r.code;
}
