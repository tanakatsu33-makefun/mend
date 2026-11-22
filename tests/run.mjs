// Hand-written cases derived from SPEC.md. Run: node tests/run.mjs
// Each case runs `node main.ts ...args` in a fresh directory and compares exit code, stdout and every file.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const MAIN = resolve(dirname(new URL(import.meta.url).pathname), '..', 'main.ts');
const L = (...lines) => lines.join('\n') + '\n';
const cases = [];
/** t(id, rule, {args, stdin, files, exit, out: [lines], after: {path: text|null}}) */
const t = (id, rule, c) => cases.push({ id, rule, args: [], files: {}, exit: 0, after: {}, ...c });
const ok = (...rows) => [...rows, `ok: ${rows.length} ${rows.length === 1 ? 'file' : 'files'}`];
const fail = (n, ...rows) => [...rows, `failed: ${rows.length} of ${n} edits`];

// ---------- section 1/2: command line and output ----------
t('cli-unknown-option', '1 usage', { args: ['--bogus'], exit: 2, out: ['error: usage'] });
t('cli-twice-check', '1 usage', { args: ['--check', '--check', 'p'], exit: 2, out: ['error: usage'] });
t('cli-twice-format', '1 usage', { args: ['--format=json', '--format=json', 'p'], exit: 2, out: ['error: usage'] });
t('cli-bad-format', '1 usage', { args: ['--format=xml', 'p'], files: { p: '' }, exit: 2, out: ['error: usage'] });
t('cli-two-positionals', '1 usage', { args: ['a', 'b'], files: { a: '', b: '' }, exit: 2, out: ['error: usage'] });
t('cli-usage-beats-nopatch', '2 order', { args: ['--bogus', 'nofile'], exit: 2, out: ['error: usage'] });
t('cli-no-patch', '2 no-patch', { args: ['nofile.patch'], exit: 2, out: ['error: no-patch'] });
t('cli-format-undetected', '4 format', { args: ['p'], files: { p: 'just some prose\n' }, exit: 2, out: ['error: format'] });
t('cli-dashdash-positional', '1 --', {
  args: ['--', '-x.json'],
  files: { '-x.json': '[{"command":"create","path":"n.txt","file_text":"hi"}]' },
  out: ok('A n.txt'),
  after: { 'n.txt': 'hi' },
});
t('cli-stdin-dash', '1 stdin', { args: ['-'], stdin: '{"command":"create","path":"s.txt","file_text":"x\\n"}\n', out: ok('A s.txt'), after: { 's.txt': 'x\n' } });
t('cli-check-writes-nothing', '1 --check', {
  args: ['--check', 'p'],
  files: { p: '[{"command":"create","path":"n.txt","file_text":"hi"}]', 'e.txt': 'a\n' },
  out: ok('A n.txt'),
});
t('cli-options-any-order', '1 order', {
  args: ['p', '--check', '--strict'],
  files: { p: '[{"command":"create","path":"n.txt","file_text":"hi"}]' },
  out: ok('A n.txt'),
});
t('cli-noop-ok0', '2 ok', {
  args: ['p'],
  files: { p: '[{"command":"str_replace","path":"f","old_str":"a","new_str":"a"}]', f: 'a\n' },
  out: ['ok: 0 files'],
});
t('cli-sorted-bytes', '2 order', {
  args: ['p'],
  files: { p: '[{"command":"create","path":"b.txt","file_text":"1"},{"command":"create","path":"B.txt","file_text":"2"},{"command":"create","path":"a/z","file_text":"3"}]' },
  out: ok('A B.txt', 'A a/z', 'A b.txt'),
  after: { 'b.txt': '1', 'B.txt': '2', 'a/z': '3' },
});
t('cli-all-or-nothing', '10 atomic', {
  args: ['p'],
  files: { p: '[{"command":"create","path":"ok.txt","file_text":"1"},{"command":"str_replace","path":"nofile","old_str":"a","new_str":"b"}]' },
  exit: 1,
  out: fail(2, 'error: missing nofile'),
});
t('cli-unsafe-paths', '3 safe', {
  args: ['p'],
  files: { p: '[{"command":"create","path":"../x","file_text":""},{"command":"create","path":"a//b","file_text":""},{"command":"create","path":"/abs","file_text":""},{"command":"create","path":"a\\\\b","file_text":""},{"command":"create","path":"./a","file_text":""}]' },
  exit: 1,
  out: fail(5, 'error: unsafe ../x', 'error: unsafe a//b', 'error: unsafe /abs', 'error: unsafe a\\b', 'error: unsafe ./a'),
});
t('cli-later-sees-earlier', '10 order', {
  args: ['p'],
  files: { p: '{"command":"create","path":"f","file_text":"one\\n"}\n\n{"command":"str_replace","path":"f","old_str":"one","new_str":"two"}\n' },
  out: ok('A f'),
  after: { f: 'two\n' },
});
t('cli-delete-then-create', '10 order', {
  args: ['p'],
  files: { p: L('*** Begin Patch', '*** Delete File: f', '*** Add File: f', '+new', '*** End Patch'), f: 'old\n' },
  out: ok('M f'),
  after: { f: 'new\n' },
});

// ---------- section 9: JSON ----------
t('json-insert-top-and-end-nofinal', '9 insert', {
  args: ['p'],
  files: { p: '[{"command":"insert","path":"f","insert_line":2,"new_str":"c"},{"command":"insert","path":"f","insert_line":0,"new_str":"z\\n"}]', f: 'a\nb' },
  out: ok('M f'),
  after: { f: 'z\na\nb\nc' },
});
t('json-insert-out-of-range', '9 insert', {
  args: ['p'],
  files: { p: '[{"command":"insert","path":"f","insert_line":5,"new_str":"c"}]', f: 'a\nb\n' },
  exit: 1,
  out: fail(1, 'error: no-match f'),
});
t('json-insert-crlf', '9 insert', {
  args: ['p'],
  files: { p: '[{"command":"insert","path":"f","insert_line":1,"new_str":"x\\r\\ny\\n"}]', f: 'a\r\nb\r\n' },
  out: ok('M f'),
  after: { f: 'a\r\nx\r\ny\r\nb\r\n' },
});
t('json-str-replace-overlap-ambiguous', '9 str_replace', {
  args: ['p'],
  files: { p: '[{"command":"str_replace","path":"f","old_str":"aa","new_str":"b"}]', f: 'aaa\n' },
  exit: 1,
  out: fail(1, 'error: ambiguous f'),
});
t('json-str-replace-crlf', '9 str_replace', {
  args: ['p'],
  files: { p: '[{"command":"str_replace","path":"f","old_str":"a\\r\\nb","new_str":"x\\ny"}]', f: 'a\r\nb\r\nc\r\n' },
  out: ok('M f'),
  after: { f: 'x\r\ny\r\nc\r\n' },
});
t('json-lines-parse-line', '9 lines', {
  args: ['p'],
  files: { p: '{"command":"create","path":"a","file_text":""}\n\n{"command":"create","path":"b"}\n' },
  exit: 2,
  out: ['error: parse 3'],
});
t('json-array-parse-first-line', '9 array', {
  args: ['p'],
  files: { p: '\n\n[\n{"command":"nope","path":"a"}\n]\n' },
  exit: 2,
  out: ['error: parse 3'],
});
t('json-create-exists', '9 create', {
  args: ['p'],
  files: { p: '[{"command":"create","path":"f","file_text":"x"}]', f: '' },
  exit: 1,
  out: fail(1, 'error: exists f'),
});
t('json-empty-array', '2 parse 1', { args: ['p'], files: { p: '[]' }, exit: 2, out: ['error: parse 1'] });

// ---------- section 6: unified diffs ----------
t('uni-wrong-line-number', '6 nearest', {
  args: ['p'],
  files: { p: L('--- a/f', '+++ b/f', '@@ -90,3 +90,3 @@', ' b', '-c', '+C', ' d'), f: 'a\nb\nc\nd\n' },
  out: ok('M f'),
  after: { f: 'a\nb\nC\nd\n' },
});
t('uni-nearest-second', '6 nearest', {
  args: ['p'],
  files: { p: L('--- f', '+++ f', '@@ -4,2 +4,2 @@', ' k', '-v', '+V'), f: 'k\nv\nz\nk\nv\nz\nk\nv\nz\n' },
  out: ok('M f'),
  after: { f: 'k\nv\nz\nk\nV\nz\nk\nv\nz\n' },
});
t('uni-tie-earlier', '6 nearest', {
  args: ['p'],
  files: { p: L('--- f', '+++ f', '@@ -3 +3 @@', ' m', '-n', '+N'), f: 'm\nn\nx\nx\nm\nn\n' },
  out: ok('M f'),
  after: { f: 'm\nN\nx\nx\nm\nn\n' },
});
t('uni-blank-context-no-space', '6 body', {
  args: ['p'],
  files: { p: L('--- f', '+++ f', '@@ -1,4 +1,4 @@', ' a', '', '-b', '+B', ' c'), f: 'a\n\nb\nc\n' },
  out: ok('M f'),
  after: { f: 'a\n\nB\nc\n' },
});
t('uni-prose-and-fences', '6 outside', {
  args: ['p'],
  files: { p: 'Here is the fix:\n```diff\n--- a/f\n+++ b/f\n@@ -1 +1 @@\n-one\n+two\n```\nDone.\n', f: 'one\n' },
  out: ok('M f'),
  after: { f: 'two\n' },
});
t('uni-create-no-newline', '6 create', {
  args: ['p'],
  files: { p: L('--- /dev/null', '+++ b/n.txt', '@@ -0,0 +1,2 @@', '+l1', '+l2', '\\ No newline at end of file') },
  out: ok('A n.txt'),
  after: { 'n.txt': 'l1\nl2' },
});
t('uni-create-exists', '6 create', {
  args: ['p'],
  files: { p: L('--- /dev/null', '+++ b/n.txt', '@@ -0,0 +1 @@', '+x'), 'n.txt': 'old\n' },
  exit: 1,
  out: fail(1, 'error: exists n.txt'),
});
t('uni-delete-git', '6 delete', {
  args: ['p'],
  files: { p: L('diff --git a/old.txt b/old.txt', 'deleted file mode 100644', 'index 1..2', '--- a/old.txt', '+++ /dev/null', '@@ -1 +0,0 @@', '-x'), 'old.txt': 'x\n' },
  out: ok('D old.txt'),
  after: { 'old.txt': null },
});
t('uni-rename-hunks', '6 move', {
  args: ['p'],
  files: { p: L('diff --git a/a.txt b/b.txt', 'similarity index 90%', 'rename from a.txt', 'rename to b.txt', '@@ -1,2 +1,2 @@', ' one', '-two', '+TWO'), 'a.txt': 'one\ntwo\n' },
  out: ok('R a.txt -> b.txt'),
  after: { 'a.txt': null, 'b.txt': 'one\nTWO\n' },
});
t('uni-move-target-exists', '6 move', {
  args: ['p'],
  files: { p: L('--- a/a.txt', '+++ b/b.txt', '@@ -1 +1 @@', '-x', '+y'), 'a.txt': 'x\n', 'b.txt': 'z\n' },
  exit: 1,
  out: fail(1, 'error: exists b.txt'),
});
t('uni-nofinal-newline-kept', '6 eof', {
  args: ['p'],
  files: { p: L('--- f', '+++ f', '@@ -1,2 +1,2 @@', '-a', '+A', ' b'), f: 'a\nb\nc' },
  out: ok('M f'),
  after: { f: 'A\nb\nc' },
});
t('uni-run-to-end-adds-newline', '6 eof', {
  args: ['p'],
  files: { p: L('--- f', '+++ f', '@@ -2,2 +2,2 @@', ' b', '-c', '+C'), f: 'a\nb\nc' },
  out: ok('M f'),
  after: { f: 'a\nb\nC\n' },
});
t('uni-backslash-keeps-nofinal', '6 eof', {
  args: ['p'],
  files: { p: L('--- f', '+++ f', '@@ -2,2 +2,2 @@', ' b', '-c', '+C', '\\ No newline at end of file'), f: 'a\nb\nc' },
  out: ok('M f'),
  after: { f: 'a\nb\nC' },
});
t('uni-tier1-trailing-ws', '5 tier1', {
  args: ['p'],
  files: { p: L('--- f', '+++ f', '@@ -1,2 +1,2 @@', '-x = 1', '+x = 2', ' y'), f: 'x = 1  \ny\n' },
  out: ok('M f'),
  after: { f: 'x = 2\ny\n' },
});
t('uni-tier1-context-is-files-own', '5 context', {
  args: ['p'],
  files: { p: L('--- f', '+++ f', '@@ -1,2 +1,2 @@', ' keep', '-old', '+new'), f: 'keep \t\nold\n' },
  out: ok('M f'),
  after: { f: 'keep \t\nnew\n' },
});
t('uni-tier2-reindent', '5 tier2', {
  args: ['p'],
  files: { p: L('--- f', '+++ f', '@@ -1,2 +1,3 @@', ' if a:', '-    b', '+    B', '+    extra'), f: '    if a:\n        b\n    c\n' },
  out: ok('M f'),
  after: { f: '    if a:\n        B\n        extra\n    c\n' },
});
t('uni-strict-no-tier1', '1 --strict', {
  args: ['--strict', 'p'],
  files: { p: L('--- f', '+++ f', '@@ -1,2 +1,2 @@', '-x = 1', '+x = 2', ' y'), f: 'x = 1  \ny\n' },
  exit: 1,
  out: fail(1, 'error: no-match f'),
});
t('uni-parse-minus-no-plus', '6 parse', {
  args: ['p'],
  files: { p: L('diff --git a/f b/f', '--- a/f', 'not plus') },
  exit: 2,
  out: ['error: parse 3'],
});
t('uni-parse-bad-hunk-header', '6 parse', {
  args: ['p'],
  files: { p: L('--- a/f', '+++ b/f', '@@ nonsense') },
  exit: 2,
  out: ['error: parse 3'],
});
t('uni-parse-hunk-before-section', '6 parse', {
  args: ['p'],
  files: { p: L('@@ -1 +1 @@', '-a', '+b', '--- a/f', '+++ b/f') },
  exit: 2,
  out: ['error: parse 1'],
});
t('uni-parse-bad-diff-git', '6 parse', {
  args: ['p'],
  files: { p: L('hello', 'diff --git nonsense') },
  exit: 2,
  out: ['error: parse 2'],
});
t('uni-missing', '6 change', {
  args: ['p'],
  files: { p: L('--- a/nofile', '+++ b/nofile', '@@ -1 +1 @@', '-a', '+b') },
  exit: 1,
  out: fail(1, 'error: missing nofile'),
});
t('uni-d-offset', '6 offset', {
  args: ['p'],
  files: { p: L('--- f', '+++ f', '@@ -1 +1,3 @@', ' s', '+a', '+b', '@@ -4,2 +6,2 @@', ' t', '-u', '+U'), f: 's\nt\nu\nt\nu\n' },
  out: ok('M f'),
  after: { f: 's\na\nb\nt\nu\nt\nU\n' },
});
t('uni-insert-empty-o', '6 insert', {
  args: ['p'],
  files: { p: L('--- f', '+++ f', '@@ -2,0 +3,1 @@', '+X'), f: 'a\nb\nc\n' },
  out: ok('M f'),
  after: { f: 'a\nb\nX\nc\n' },
});
t('uni-unsafe', '3 safe', {
  args: ['p'],
  files: { p: L('--- a/../x', '+++ b/../x', '@@ -1 +1 @@', '-a', '+b') },
  exit: 1,
  out: fail(1, 'error: unsafe ../x'),
});
t('uni-crlf-file', '3 crlf', {
  args: ['p'],
  files: { p: L('--- f', '+++ f', '@@ -2 +2 @@', '-b', '+B'), f: 'a\r\nb\r\nc\r\n' },
  out: ok('M f'),
  after: { f: 'a\r\nB\r\nc\r\n' },
});
t('uni-two-sections-one-fails', '10 continue', {
  args: ['p'],
  files: { p: L('--- f', '+++ f', '@@ -1 +1 @@', '-zzz', '+y', '--- g', '+++ g', '@@ -1 +1 @@', '-a', '+b'), f: 'a\n', g: 'a\n' },
  exit: 1,
  out: fail(2, 'error: no-match f'),
});

// ---------- section 7: SEARCH/REPLACE ----------
t('sr-fenced-path', '7 path', {
  args: ['p'],
  files: { p: L('```', 'f.txt', '<<<<<<< SEARCH', 'old', '=======', 'new', '>>>>>>> REPLACE', '```'), 'f.txt': 'old\nkeep\n' },
  out: ok('M f.txt'),
  after: { 'f.txt': 'new\nkeep\n' },
});
t('sr-ambiguous', '7 ambiguous', {
  args: ['p'],
  files: { p: L('f.txt', '<<<<<<< SEARCH', 'x', '=======', 'y', '>>>>>>> REPLACE'), 'f.txt': 'x\nx\n' },
  exit: 1,
  out: fail(1, 'error: ambiguous f.txt'),
});
t('sr-inherit-path', '7 path', {
  args: ['p'],
  files: { p: L('f.txt', '<<<<<<< SEARCH', 'a', '=======', 'A', '>>>>>>> REPLACE', '<<<<<<< SEARCH', 'b', '=======', 'B', '>>>>>>> REPLACE'), 'f.txt': 'a\nb\n' },
  out: ok('M f.txt'),
  after: { 'f.txt': 'A\nB\n' },
});
t('sr-first-block-no-path', '7 parse', {
  args: ['p'],
  files: { p: '\n\n<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE\n' },
  exit: 2,
  out: ['error: parse 3'],
});
t('sr-no-divider', '7 parse', {
  args: ['p'],
  files: { p: L('f', '<<<<<<< SEARCH', 'a', '>>>>>>> REPLACE') },
  exit: 2,
  out: ['error: parse 2'],
});
t('sr-create-and-exists', '7 create', {
  args: ['p'],
  files: { p: L('n.txt', '<<<<<<< SEARCH', '=======', 'hello', 'world', '>>>>>>> REPLACE', 'e.txt', '<<<<<<< SEARCH', '=======', 'x', '>>>>>>> REPLACE'), 'e.txt': 'q\n' },
  exit: 1,
  out: fail(2, 'error: exists e.txt'),
});
t('sr-create', '7 create', {
  args: ['p'],
  files: { p: L('n.txt', '<<<<<<< SEARCH', '=======', 'hello', 'world', '>>>>>>> REPLACE') },
  out: ok('A n.txt'),
  after: { 'n.txt': 'hello\nworld\n' },
});
t('sr-tier2-reindent', '5 tier2', {
  args: ['p'],
  files: { p: L('f', '<<<<<<< SEARCH', 'if x:', '    y()', '=======', 'if x:', '    z()', '>>>>>>> REPLACE'), f: '\tif x:\n\t\ty()\n' },
  out: ok('M f'),
  after: { f: '\tif x:\n\t    z()\n' },
});
t('sr-crlf', '3 crlf', {
  args: ['p'],
  files: { p: L('f', '<<<<<<< SEARCH', 'b', '=======', 'B', 'B2', '>>>>>>> REPLACE'), f: 'a\r\nb' },
  out: ok('M f'),
  after: { f: 'a\r\nB\r\nB2' },
});
t('sr-missing-and-nomatch', '7 codes', {
  args: ['p'],
  files: { p: L('zz.txt', '<<<<<<< SEARCH', 'a', '=======', 'b', '>>>>>>> REPLACE', 'f.txt', '<<<<<<< SEARCH', 'nope', '=======', 'b', '>>>>>>> REPLACE'), 'f.txt': 'a\n' },
  exit: 1,
  out: fail(2, 'error: missing zz.txt', 'error: no-match f.txt'),
});
t('sr-trailing-ws-markers', '7 markers', {
  args: ['p'],
  files: { p: 'f\n<<<<<<< SEARCH  \na\n=======\t\nb\n>>>>>>> REPLACE   \n', f: 'a\n' },
  out: ok('M f'),
  after: { f: 'b\n' },
});

// ---------- section 8: V4A ----------
t('v4a-add-delete-update', '8 sections', {
  args: ['p'],
  files: {
    p: L('*** Begin Patch', '*** Add File: new/n.txt', '+hello', '+', '+world', '*** Delete File: gone.txt', '*** Update File: a.txt', '@@', ' 1', '-2', '+two', '*** End Patch'),
    'a.txt': '1\n2\n3\n',
    'gone.txt': 'x\n',
  },
  out: ok('M a.txt', 'D gone.txt', 'A new/n.txt'),
  after: { 'a.txt': '1\ntwo\n3\n', 'gone.txt': null, 'new/n.txt': 'hello\n\nworld\n' },
});
t('v4a-missing-end', '8 parse', { args: ['p'], files: { p: L('*** Begin Patch', '*** Delete File: x') }, exit: 2, out: ['error: parse 3'] });
t('v4a-missing-begin', '8 parse', { args: ['--format=v4a', 'p'], files: { p: 'garbage\n' }, exit: 2, out: ['error: parse 1'] });
t('v4a-move', '8 move', {
  args: ['p'],
  files: { p: L('*** Begin Patch', '*** Update File: src.txt', '*** Move to: dst/d.txt', '@@', '-a', '+A', '*** End Patch'), 'src.txt': 'a\nb\n' },
  out: ok('R src.txt -> dst/d.txt'),
  after: { 'src.txt': null, 'dst/d.txt': 'A\nb\n' },
});
t('v4a-anchor-nomatch', '8 anchor', {
  args: ['p'],
  files: { p: L('*** Begin Patch', '*** Update File: a.txt', '@@ nothere', '-1', '+x', '*** End Patch'), 'a.txt': '1\n' },
  exit: 1,
  out: fail(1, 'error: no-match a.txt'),
});
t('v4a-eof-chunk', '8 eof', {
  args: ['p'],
  files: { p: L('*** Begin Patch', '*** Update File: f', '-x', '+X', '*** End of File', '*** End Patch'), f: 'x\ny\nx\n' },
  out: ok('M f'),
  after: { f: 'x\ny\nX\n' },
});
t('v4a-update-no-chunk', '8 parse', {
  args: ['p'],
  files: { p: L('*** Begin Patch', '*** Update File: a.txt', '*** End Patch') },
  exit: 2,
  out: ['error: parse 2'],
});
t('v4a-exists-missing', '8 codes', {
  args: ['p'],
  files: { p: L('*** Begin Patch', '*** Add File: a.txt', '+x', '*** Delete File: zz', '*** End Patch'), 'a.txt': 'q\n' },
  exit: 1,
  out: fail(2, 'error: exists a.txt', 'error: missing zz'),
});
t('v4a-whitespace-around-markers', '4/8 detect', {
  args: ['p'],
  files: { p: '\n  *** Begin Patch  \n*** Delete File: a.txt\n*** End Patch\n\n', 'a.txt': 'x\n' },
  out: ok('D a.txt'),
  after: { 'a.txt': null },
});
t('v4a-cursor-moves', '8 cursor', {
  args: ['p'],
  files: { p: L('*** Begin Patch', '*** Update File: f', '@@', ' k', '-m', '+M', '@@', ' k', '-m', '+Q', '*** End Patch'), f: 'k\nm\nk\nm\n' },
  out: ok('M f'),
  after: { f: 'k\nM\nk\nQ\n' },
});
t('v4a-add-trailing-blank-dropped', '8 add', {
  args: ['p'],
  files: { p: '*** Begin Patch\n*** Add File: n\n+a\n\n*** End Patch\n' },
  out: ok('A n'),
  after: { n: 'a\n' },
});
t('v4a-unsafe', '3 safe', {
  args: ['p'],
  files: { p: L('*** Begin Patch', '*** Add File: ../x', '+a', '*** End Patch') },
  exit: 1,
  out: fail(1, 'error: unsafe ../x'),
});
t('v4a-stray-line', '8 parse', {
  args: ['p'],
  files: { p: L('*** Begin Patch', '*** Delete File: a', 'garbage', '*** End Patch'), a: '' },
  exit: 2,
  out: ['error: parse 3'],
});
t('v4a-anchor-then-chunk', '8 anchor', {
  args: ['p'],
  files: { p: L('*** Begin Patch', '*** Update File: f', '@@ def b', ' x', '-y', '+Y', '*** End Patch'), f: 'x\ny\ndef b\nx\ny\n' },
  out: ok('M f'),
  after: { f: 'x\ny\ndef b\nx\nY\n' },
});

// ---------- run ----------
function snapshot(dir, rel = '') {
  const out = {};
  for (const name of readdirSync(join(dir, rel))) {
    const p = rel === '' ? name : `${rel}/${name}`;
    if (statSync(join(dir, p)).isDirectory()) Object.assign(out, snapshot(dir, p));
    else out[p] = readFileSync(join(dir, p), 'utf8');
  }
  return out;
}

const only = process.argv.slice(2);
let passed = 0;
let ran = 0;
for (const c of cases) {
  if (only.length > 0 && !only.some((o) => c.id.startsWith(o))) continue;
  ran += 1;
  const dir = mkdtempSync(join(tmpdir(), 'mend-'));
  for (const [p, v] of Object.entries(c.files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), v);
  }
  const want = { ...c.files };
  for (const [p, v] of Object.entries(c.after)) {
    if (v === null) delete want[p];
    else want[p] = v;
  }
  const r = spawnSync('node', [MAIN, ...c.args], { cwd: dir, input: c.stdin ?? '', encoding: 'utf8' });
  const why = [];
  if (r.status !== c.exit) why.push(`exit ${r.status}, want ${c.exit}`);
  const wantOut = c.out === undefined ? '' : c.out.map((l) => `${l}\n`).join('');
  if (r.stdout !== wantOut) why.push(`stdout ${JSON.stringify(r.stdout)}, want ${JSON.stringify(wantOut)}`);
  const got = snapshot(dir);
  for (const p of new Set([...Object.keys(got), ...Object.keys(want)])) {
    if (got[p] !== want[p]) why.push(`file ${p}: got ${JSON.stringify(got[p])}, want ${JSON.stringify(want[p])}`);
  }
  rmSync(dir, { recursive: true, force: true });
  if (why.length === 0) passed += 1;
  else console.log(`FAIL ${c.id} [${c.rule}]\n  ${why.join('\n  ')}`);
}
console.log(`${passed} of ${ran} cases passed`);
process.exitCode = passed === ran ? 0 : 1;
