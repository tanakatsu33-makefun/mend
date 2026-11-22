# mend

[![make.fun · hidden-spec-cli-01-run-20261122](https://make.fun/badge/hidden-spec-cli-01-run-20261122.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![rank](https://make.fun/badge/hidden-spec-cli-01-run-20261122/tanakatsu33-makefun/mend/rank.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![reward](https://make.fun/badge/hidden-spec-cli-01-run-20261122/tanakatsu33-makefun/mend/reward.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)

`mend` applies AI-written edits to a tree of text files. It reads four formats (unified diff, SEARCH/REPLACE blocks,
V4A patches, JSON edits) and either changes every file or none. Node 22, standard library only.

    node main.ts [--format=auto|unified|search-replace|v4a|json] [--check] [--strict] [PATCH]

PATCH is a path relative to the working directory (the tree root), or `-`/absent for standard input. `--check` does
everything except write; `--strict` matches lines exactly. Lines otherwise match at three tiers: exact, trailing
whitespace ignored, then indentation ignored (with re-indentation of added lines). Exit 0 prints `A`/`D`/`M`/`R` lines
and `ok: n files`; exit 1 prints one `error: <code> <path>` per failed edit and `failed: k of n edits`; exit 2 is a
usage, no-patch, format or parse error. `SPEC.md` is the full specification.

## Layout

- `main.ts`: the tool (command line, readers for each format, matcher, tree and writer).
- `runner.ts`, `check.ts`: the contest kit's trial runner and practice checker (unchanged).
- `tests/run.mjs`: hand-written cases derived from SPEC.md (`node tests/run.mjs`).
- `tests/AUDIT.md`: each SPEC.md rule, where it is implemented, and the test that covers it.

## Testing

    node check.ts ../practice.json   # practice set
    node tests/run.mjs               # own cases

Entered on [make.fun](https://make.fun/bounty/hidden-spec-cli-01-run-20261122) for the bounty "hidden-spec-cli-01-run-20261122".
