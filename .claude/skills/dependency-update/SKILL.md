---
name: dependency-update
description: Checks after `pnpm update`, `josh latest`, `josh adopt`, `pnpm josh overrides` or any dependency update — the `overrides` survived, the one expected `devEngines` change. Read it before reporting the pins intact or pinning a bump back.
---

# After a dependency-update command

`CLAUDE.md` → "Decision autonomy" keeps both prohibitions resident as Tier C: never touch `overrides`,
never touch `devEngines`, without explicit user approval. This skill is the single source of how to check
whether a command touched them, after `pnpm update`, `josh latest`, `josh adopt` (which runs
`josh latest`), `pnpm josh overrides`, a Dependabot merge, or any command that rewrites dependency
versions. Overrides exist on purpose (e.g. `"esbuild@<=0.24.2": ">=0.25.0"` for Workers builds).

## 1. Effective overrides live in the workspace — inspect both files

**pnpm 11 and 12 read effective overrides only from `pnpm-workspace.yaml`.** `pnpm.overrides` in
**`package.json` is ignored** (verified with pnpm 12.6.0). Inspect both to preserve existing
declarations, but an absent package field says nothing about workspace overrides.

## 2. The check is a command you run, not a conclusion you reach

```bash
git diff -- pnpm-workspace.yaml package.json
```

(after `josh adopt`, which has already committed and returned to the default branch:
`git diff <default>...<branch> -- pnpm-workspace.yaml package.json`). Confirm both overrides blocks
are untouched **and** `devDependencies` still respect the effective overrides. A removed, modified or
over-bumped entry: restore it immediately, investigate, and report — never keep it without approval.

`josh latest` prints its verdict as its last overrides line (`✔ overrides unchanged (<n> from
<file>)` or `⚠ overrides changed`); `pnpm josh overrides` compares against a saved snapshot —
**quote what one printed.**

## 3. `devEngines` — the one expected change

**Exception — the `josh latest` lockstep pnpm bump is expected, NOT a violation.** **KEEP** a
`devEngines.packageManager.version` change **if and only if** it equals everything after `pnpm@` in
the new `packageManager` pin — **byte-identical, `+sha512…` Corepack integrity suffix included**
(`scripts/version/latest-corepack.ts` → `sync_development_engines`). Reverting it would re-introduce
the mismatch.

**Restore + ask** when `devEngines` changed any other way: the version no longer matches
`packageManager` (a dropped or truncated suffix counts), its structure changed (`name` / `onFail` /
fields), or something other than `josh latest` touched it. One structural change is expected and
kept: `josh sync` moving `devEngines.packageManager.onFail` from `"error"` to `"download"`.

## 4. When the bump breaks something — fix forward

Single source: `prompts/collaboration-workflow/principles.md` → "latest-first". Fix-forward never
authorizes a silent edit to a protected pin; sections 1–3 still apply.
