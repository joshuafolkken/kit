---
name: dependency-update
description: Checks after `pnpm update`, `josh latest`, `pnpm josh overrides` or any dependency update — the `overrides` survived, the one expected `devEngines` change. Read it before reporting the pins intact or pinning a bump back.
---

# After a dependency-update command

`CLAUDE.md` → "Decision autonomy" keeps both prohibitions resident as Tier C — never touch `overrides`
in either file, never touch `devEngines`, without explicit user approval. This skill is the other
half: what you actually run to find out whether a command already touched them, and how to read the
one change that is expected. It applies after `pnpm update`, `josh latest`, `pnpm josh overrides`,
a Dependabot merge, or any other command that can rewrite dependency versions.

This skill is the single source of the overrides protection's procedure;
`prompts/collaboration-workflow/operating-rules.md` only points here. Overrides were added on
purpose — for security, compatibility or a working guarantee (for example
`"esbuild@<=0.24.2": ">=0.25.0"` for Workers build compatibility).

## 1. Effective overrides live in the workspace — inspect both files

**pnpm 11 and 12 read effective overrides only from `pnpm-workspace.yaml`.** The old
`pnpm.overrides` field in **`package.json` is ignored**, as verified with pnpm 12.6.0. Inspect both
files to preserve any existing declarations, but do not count the package field as an effective
override. An absent or empty package field says nothing about workspace overrides: app-kit's
`package.json` has no `pnpm` field, while its workspace has a real override.

## 2. The check is a command you run, not a conclusion you reach

**The check is a command you run, not a conclusion you reach.** After `pnpm update`, `josh latest`,
or any dependency-update command, verify the overrides in both `pnpm-workspace.yaml` and
`package.json` by running

```bash
git diff -- pnpm-workspace.yaml package.json
```

and confirm the effective `overrides:` block in `pnpm-workspace.yaml` and any historical
`pnpm.overrides` declarations in `package.json` are untouched, **and** that `devDependencies`
versions still respect the effective overrides. If any entry was removed, modified, or bumped past
an override, restore it immediately, investigate why it changed, and report that to the user — never
keep the change without explicit approval.

`josh latest` prints its own verdict as its last overrides line (`✔ overrides unchanged (<n> from
<file>)`, or a `⚠ overrides changed` warning), and `pnpm josh overrides` compares effective workspace
entries against a saved snapshot and reports ignored package entries — **quote what one printed.**

## 3. `devEngines` — the one expected change

Verify `devEngines` was not changed **outside the legitimate `josh latest` pnpm bump**. If it changed
in any other way, restore it immediately and ask the user before making any change.

**Exception — the `josh latest` lockstep pnpm bump is expected, NOT a violation.** `josh latest`
deliberately bumps `devEngines.packageManager.version` in lockstep with the top-level
`packageManager` pin (see `scripts/version/latest-corepack.ts` → `sync_development_engines`); the two
MUST stay exactly equal — **byte-identical, `+sha512…` Corepack integrity suffix included**. pnpm
compares them as raw strings, so a bare `11.18.0` paired with `pnpm@11.18.0+sha512…` is a mismatch
and the dual-declaration warning fires; only a character-for-character match suppresses it.

So after `josh latest`, **KEEP** a `devEngines.packageManager.version` change **if and only if** it
now equals everything after `pnpm@` in the new `packageManager` pin (same version string **and** same
integrity suffix; only the `version` field moved). Reverting it would both undo a valid toolchain
update **and** re-introduce a `packageManager`/`devEngines` mismatch — the opposite of the rule's
intent.

**Restore + ask only** when `devEngines` changed in some OTHER way: its version no longer matches
`packageManager` (a dropped, stale, or truncated integrity suffix counts as a mismatch), its
structure changed (`name` / `onFail` / fields added or removed), or it was touched by something other
than `josh latest`. The one structural change that is expected is `josh sync` moving
`devEngines.packageManager.onFail` from `"error"` to `"download"` — a user-approved migration that
leaves `name` and `version` untouched; keep it.

## 4. When the bump breaks something — fix forward

The procedure — latest-first, fix forward at the correct layer, pin back only as a last resort with a
tracking issue — has its single source in
`prompts/collaboration-workflow/principles.md` → "latest-first". Fix-forward never authorizes a silent edit to a protected pin: the
approval gates in sections 1–3 still apply.
