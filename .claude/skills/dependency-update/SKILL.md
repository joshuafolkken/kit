---
name: dependency-update
description: The verification procedure that runs after `pnpm update`, `josh latest`, `pnpm josh overrides` or any other dependency-update command — how to confirm the `overrides` entries in both `pnpm-workspace.yaml` and `package.json` survived, and which single `devEngines` change is the expected one rather than a violation. Read it before reporting that a dependency update left the pins intact, and whenever a bump has to be resolved forward or pinned back.
---

# After a dependency-update command

`CLAUDE.md` keeps the two prohibitions resident — never touch `overrides`
in either file, never touch `devEngines`, without explicit user approval. This skill is the other
half: what you actually run to find out whether a command already touched them, and how to read the
one change that is expected. It applies after `pnpm update`, `josh latest`, `pnpm josh overrides`,
a Dependabot merge, or any other command that can rewrite dependency versions.

The canonical extended reference is `prompts/collaboration-workflow/operating-rules.md` → the overrides protection
section; this skill is the operational procedure, and the two must agree.

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
an override, restore it immediately.

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
than `josh latest`.

## 4. When the bump breaks something — fix forward

Adopt the newest versions by default and resolve breakage **forward**: fix consumer code where a new
rule or error is legitimate, and add or scope rule overrides at the correct layer (the shared kit /
app-kit config), not as an ad-hoc consumer disable. When the breakage originates in a first-party
package, file an issue there rather than only working around it in the consumer.

Pinning back is a **last resort**, only when fixing forward is genuinely blocked. Record why, and
open a tracking issue to return to latest. Fix-forward never authorizes a silent edit to a protected
pin: the approval gates in sections 1–3 still apply.
