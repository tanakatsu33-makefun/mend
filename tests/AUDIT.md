# SPEC.md audit: rule -> implementation -> test

Tests are in `tests/run.mjs` (ids below; `node tests/run.mjs [id-prefix]`). "practice" = `../practice.json` families.
Functions are in `main.ts`.

## 1. Invocation
| Rule | Where | Test |
|---|---|---|
| unknown `-x` option, duplicate option, bad `--format` value, >1 positional are usage errors | `run()` argument loop | cli-unknown-option, cli-twice-check, cli-twice-format, cli-bad-format, cli-two-positionals |
| `--` ends options, later args positional | `run()` (`ended`) | cli-dashdash-positional |
| PATCH absent or `-` reads stdin | `run()` | cli-stdin-dash |
| options and PATCH in any order | `run()` | cli-options-any-order |
| `--check` same output, nothing written | `run()` write phase | cli-check-writes-nothing, practice c-check |
| `--strict` tier 0 only | `occurrences(strict)` | uni-strict-no-tier1, practice |

## 2. Output and exit codes
| Rule | Where | Test |
|---|---|---|
| order usage > no-patch > format > parse | `run()` | cli-usage-beats-nopatch, cli-no-patch, cli-format-undetected |
| no edit at all is `parse 1` | `run()` (`edits.length === 0`) | json-empty-array, v4a-missing-begin |
| one `error:` line per failed edit, then `failed: k of n edits` | `run()` | cli-all-or-nothing, sr-missing-and-nomatch, uni-two-sections-one-fails |
| A/D/M lines sorted by UTF-8 bytes; `ok: 1 file` / `ok: n files`; `ok: 0 files` | `run()` rows | cli-sorted-bytes, cli-noop-ok0 |
| R line replaces D+A, sorted by new path | `run()` (`renamed`, `tree.moves`) | uni-rename-hunks, v4a-move |

## 3. Files, lines, paths
| Rule | Where | Test |
|---|---|---|
| safe path | `safe()` | cli-unsafe-paths, uni-unsafe, v4a-unsafe |
| CRLF detection, lines, final break, empty file | `toDoc`/`fromDoc` | uni-crlf-file, sr-crlf, json-insert-crlf |
| created files LF, final break | creation code per format | uni-create-no-newline, sr-create, v4a-add-delete-update |
| patch lines: split at `\n`, one `\r` removed, numbering | `patchLines` | practice u-crlf |

## 4. Detection
`detect()` — v4a-whitespace-around-markers, cli-format-undetected, practice c-format.

## 5. Matching
| Rule | Where | Test |
|---|---|---|
| three tiers, first tier with an occurrence | `occurrences` / `TIERS` | uni-tier1-trailing-ws, uni-tier2-reindent, sr-tier2-reindent |
| context lines written as file's own | `replacement` | uni-tier1-context-is-files-own |
| tier 2 re-indent F/P | `replacement` | uni-tier2-reindent, sr-tier2-reindent |

## 6. Unified
| Rule | Where | Test |
|---|---|---|
| section start, header paths, a/ b/ removal, tab cut | `parseUnified`, `diffPath` | uni-wrong-line-number, practice u-* |
| rename from/to, new/deleted file mode | `parseUnified`, `unifiedEdits` | uni-rename-hunks, uni-delete-git |
| parse errors (`---` without `+++`, bad `@@`, hunk before section, bad `diff --git`) | `parseUnified` | uni-parse-* |
| body: empty line = context, trailing empties dropped, prose ignored | `parseUnified` | uni-blank-context-no-space, uni-prose-and-fences |
| creation/deletion/move/change codes | `unifiedEdits` | uni-create-exists, uni-missing, uni-move-target-exists |
| nearest occurrence to A-1+d, tie earlier | `applyHunks` | uni-nearest-second, uni-tie-earlier, uni-d-offset |
| empty O insertion after A+d lines | `applyHunks` | uni-insert-empty-o |
| `\` lines / final newline | `applyHunks`, creation | uni-nofinal-newline-kept, uni-run-to-end-adds-newline, uni-backslash-keeps-nofinal |

## 7. SEARCH/REPLACE
`searchReplaceEdits` — path rules: sr-fenced-path, sr-inherit-path, sr-first-block-no-path; parse: sr-no-divider; create/exists: sr-create, sr-create-and-exists; ambiguous: sr-ambiguous; missing/no-match: sr-missing-and-nomatch; marker trailing whitespace: sr-trailing-ws-markers.

## 8. V4A
`v4aEdits` — begin/end parse: v4a-missing-end, v4a-missing-begin; sections: v4a-add-delete-update, v4a-add-trailing-blank-dropped, v4a-stray-line; update without chunk: v4a-update-no-chunk; move: v4a-move; anchors: v4a-anchor-nomatch, v4a-anchor-then-chunk; cursor: v4a-cursor-moves; EOF chunk: v4a-eof-chunk; codes: v4a-exists-missing.

## 9. JSON
`jsonEdits`/`jsonEdit` — insert: json-insert-*; str_replace: json-str-replace-*; parse lines: json-lines-parse-line, json-array-parse-first-line; create: json-create-exists.

## 10. Order and atomicity
`run()` loop with snapshot/rollback per edit — cli-later-sees-earlier, cli-delete-then-create, cli-all-or-nothing, uni-two-sections-one-fails.
