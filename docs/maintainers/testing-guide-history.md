# Why the E2E gate closes the way it does

The history and justification behind `prompts/testing-guide.md` → "6. Closing the E2E gate without a
human run", kept off every run's read path.

## Why the human E2E run existed, and why it no longer does

The completion gate used to end by asking the user to run `pnpm josh test` and paste the output. That
step is gone (joshuafolkken/kit#902), and its replacement is not a relaxation — nothing that a red
local run stopped is allowed through.

The reason was never that a human reads E2E output better. It was that `followup` waited 180 seconds
for CI, which no suite containing E2E can finish in — so the command exited red beside a CI that was
still running, and the only reliable E2E signal left was a person's terminal. That budget is now
derived from the distributed `templates/workflows/ci.yml` rather than picked as a round number: 1920
seconds, the longest run its `needs` graph permits plus runner-queue headroom, with a unit test that
fails if a declared job budget outgrows it (joshuafolkken/kit#851). CI can now be waited on, so it can
be relied on.

## How CI's E2E detection came to match the guard

Before joshuafolkken/kit#991 the `e2e-detect` job required a file named exactly
`playwright.config.ts` **and** an `*.e2e.{ts,js}` under `tests` or `src/routes`, so a suite kept
anywhere else, or a config named `playwright.config.js`, read as "no E2E" in CI while `josh test:e2e`
ran it locally: the job's `if:` went false, GitHub recorded it as `skipped`, the rollup parser counted
the skip as passing, and the gate closed on a suite nobody ran. The agreement is now executed rather
than described — `scripts/ci/ci-yml-e2e-detect.test.ts` runs the workflow's own script against each
layout and compares its verdict to the guard's.

CI enables the job on the spec alone, while the guard also skips when `@playwright/test` is not
installed (which keeps that optional peer optional for the pre-push hook). Enabling more than the
guard costs a failed job, enabling less costs a merge — so the difference may widen in that direction
and never narrow.

## The gate is not weakened

Two properties carry the verification the human step used to carry, both asserted by tests:

- **A non-passing check keeps the merge closed.** `evaluate_pr_state` returns `success` only when
  GitHub reports the pull request `CLEAN` **and** every required check passes. A failing E2E job makes
  GitHub report `UNSTABLE`, and the one opening in that wall — `is_unstable_only_from_coderabbit`, the
  temporary kit#753 policy — applies only when _every_ non-passing check is CodeRabbit's.
- **Weakening the gate is a workaround**, and `CLAUDE.md` → "Cross-package problems" applies to it.

**`E2E` stays off the required-check list by decision** (joshuafolkken/kit#991). A required check is
satisfied by a _skipped_ job — the rollup parser maps `SKIPPED` to `pass` — so requiring `E2E` would
have passed on exactly the skipped job it looks like it would catch. It adds nothing to the failure
path either, and a repository whose CI reports no `E2E` context would stay `pending` until the
32-minute wait timed out. A project that wants it required opts in through `JOSH_REQUIRED_CHECKS`;
the decision is pinned in `scripts/gh/git-pr-checks-e2e-gate.test.ts`.

**A red E2E is reported as soon as it goes red, by name** (joshuafolkken/kit#990). Before it, nothing
ended the wait when the non-required `E2E` failed: `followup` ran out its 32-minute budget and ended in
`Timed out while waiting for PR checks to complete.`, naming neither the job nor the cause. This
changed how fast the gate reports, never what it lets through.

## Why the `*.spec.*` ban is a lint rule

`prompts/testing-guide.md` → "Test file naming & placement". Left as an export a consumer had to
remember to wire in, the ban reached only the projects that did — and never the repository
distributing it (joshuafolkken/kit#1233). Lint was chosen over tightening the vitest `{test,spec}`
matchers because matcher-tightening causes silent non-execution of a stray `*.spec.ts`, whereas a lint
rule fails loudly. Doc-only guidance had already failed to prevent this drift twice.

The building blocks (`eslint/rules/test-filename.js`) are wired into `eslint/base.js` itself, so every
project built on `create_base_config` — kit included — flags any `*.spec.*` file and any file under a
top-level `tests/` directory, and fails `josh lint` for kit, for every consumer of the base config, and
for every AI tool. **Both bans cover every JS/TS extension** — `.ts` `.tsx` `.mts` `.cts` `.js` `.jsx`
`.mjs` `.cjs` — since joshuafolkken/kit#1414; `.svelte` is deliberately outside them, because the base
config has no Svelte parser and a `tests/Foo.svelte` would report a parse error instead of the move
instruction.

A config that does not use the base can import the blocks alone, as
`@joshuafolkken/kit/eslint/test-filename` — but wire them through
`extend_restricted_syntax(<your own rules>, SPEC_FILENAME_ENTRY)`: flat config replaces
`no-restricted-syntax` rather than merging it, so the ready-made `spec_filename_rules` /
`centralized_tests_directory_rules` records drop whatever selectors that config already restricted, on
exactly the files the ban applies to (joshuafolkken/kit#1414).
