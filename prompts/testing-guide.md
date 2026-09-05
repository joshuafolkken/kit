# Test Generation Guide

## 0. Per-Requirement Test Coverage (MANDATORY)

Before writing any implementation code, **list every requirement from the user's request and assign a test to each one**. This step is non-negotiable.

### Planning template

For a user request with N requirements, enumerate each one before touching any source files:

```text
Req 1: "Label chip shown immediately"
  → E2E: open editor, type new label, press Enter → chip visible without blurring

Req 2: "Down arrow moves to next row"
  → E2E: open editor on row 1, press ↓ → row 2 enters edit mode

Req N: ...
  → Unit/E2E: ...
```

### Rules

- **Every user-facing behavior change** (UI interaction, keyboard shortcut, visible state change) must have a corresponding E2E test.
- **Every logic/utility change** (pure functions, filters, transforms) must have a unit test.
- If a test is genuinely infeasible (e.g., native OS date-picker popup cannot be driven by Playwright), write a comment in the test file explaining why and test the closest observable behavior instead (e.g., that the editor remains open after the `change` event fires).
- Do **not** report a requirement as done if its test is missing.

### Verification checklist (add to the completion gate)

- [ ] Count requirements in the user's request.
- [ ] Count tests added/updated for those requirements.
- [ ] The two counts match (or each gap is documented as infeasible with a comment).
- [ ] **UI changes only:** a screenshot of the affected screen was captured and visually confirmed before reporting completion (passing tests are not proof the UI looks correct — see the **UI verification (screenshot)** rule in the completion gate). If a screenshot is impossible in this environment, that is stated and the user is asked to verify visually.

---

## 1. Test Type Selection

| Condition                                                         | Type                      |
| ----------------------------------------------------------------- | ------------------------- |
| `src/routes/` pages, UI components with user interaction          | E2E (Playwright)          |
| `.ts`/`.js` utilities, `src/lib/server/`, display-only components | Unit/Integration (Vitest) |

When ambiguous, ask the user.

### Test file naming & placement (one unambiguous rule)

There is exactly **one** convention for every test file — never choose between two. The rules below are mandatory; some are config-enforced (a violating file runs under the wrong vitest project or not at all), others are enforced by convention/review — each rule states which.

| Test kind           | Required filename        | Routed to                        |
| ------------------- | ------------------------ | -------------------------------- |
| Unit / integration  | `*.test.ts`              | node/unit vitest project         |
| Component / browser | `*.svelte.test.ts`       | browser/component vitest project |
| E2E                 | `src/routes/**/*.e2e.ts` | Playwright                       |

- **Use `*.test.ts` — never `*.spec.ts`.** The `.spec.ts` suffix is forbidden for unit/integration tests. This is **lint-enforced**: the test-filename rule building blocks (`eslint/rules/test-filename.js`) are wired into `eslint/base.js` itself, so every project built on `create_base_config` — kit included, since joshuafolkken/kit#1233 — flags any `*.spec.ts` / `*.spec.js` file, and any file under a top-level `tests/` directory, and fails `josh lint`. A config that does not use the base can still import the blocks alone, as `@joshuafolkken/kit/eslint/test-filename`. (A vitest `{test,spec}` matcher would still accept both, but the lint rule fails loudly before a stray `.spec.ts` can drift in.)
- **The `.svelte.` infix is required for component/browser tests and must be preserved.** `*.svelte.test.ts` routes the file to the **browser/component** vitest project (`include: src/**/*.svelte.{test,spec}.{js,ts}`); plain `*.test.ts` routes to the **node/unit** project (`include: src/**/*.{test,spec}.{js,ts}`). Renaming `Foo.svelte.test.ts` → `Foo.test.ts` silently moves it to the wrong project — do not drop the `.svelte.` infix.
- **Colocate every test next to the code it exercises.** A top-level `tests/` directory is **not used** — place `foo.test.ts` beside `foo.ts`, and E2E specs under the relevant `src/routes/**` path. The top-level `tests/` ban is **lint-enforced** by the same rule (`eslint/rules/test-filename.js`). Note: `playwright.config.ts` discovers E2E via `testMatch: '**/*.e2e.{ts,js}'`, so an `*.e2e.ts` placed outside `src/routes/**` would still run — that specific `src/routes/**` placement is enforced by **convention/review, not config**, and must be upheld manually.

> **Enforcement:** the `*.spec.ts` ban and the top-level `tests/` ban are enforced by the test-filename rule (`eslint/rules/test-filename.js`), wired into the shared `eslint/base.js`, so they fail loudly in `josh lint` for kit itself, for every consumer of that base config, and for every AI tool. Left as an export a consumer had to remember to wire in, the ban reached only the projects that did — and never the repository distributing it (joshuafolkken/kit#1233). This was chosen over tightening the vitest `{test,spec}` matchers to `{test}` only, because matcher-tightening causes **silent non-execution** of stray `*.spec.ts` files whereas a lint rule fails loudly. (Doc-only guidance had already failed to prevent this drift twice.)

---

## 2. Test Guidelines

### Naming

- Variables/functions: `snake_case` | Constants: `UPPER_SNAKE_CASE`
- Boolean prefix: `is_`, `has_`, `should_`, `can_`, `will_`, `did_`

### Test Functions

- Outside `describe`: `test`; inside `describe`: `it`
- Use `describe` only when grouping multiple tests is necessary

### Parameterized Tests

- Playwright: `for` loop; Vitest: `test.each` / `it.each`
- Test cases: define as `cases` or `*_cases` array at file top (outside test functions)

### Constants

- All magic numbers/strings except `0`, `1`, `-1` must be `UPPER_SNAKE_CASE` constants
- Place after imports at file top

### Imports

- Always include `.js` extension: `import { foo } from './bar.js'`
- Type imports: `import { type Foo } from '...'`

### Playwright

- Element selection: `page.getByTestId('id')` — add `data-testid` to implementation files
- Test functions always `async`
- **Project split:** `playwright.config.ts` defines **`e2e-guest`** (no auth: `src/routes/**/dash-guest.e2e.ts`, `src/routes/**/demo.e2e.ts`), then **`e2e-main`** (depends on `e2e-guest`), then **`e2e-leak-check`** (depends on `e2e-main`). Authenticated projects set `storageState` to `src/routes/.auth/user.json` when that file exists — **there is no UI login on every test**; cookies/session are restored from disk.
- **Workers:** Playwright uses `workers: 1` because authenticated E2E shares one storage state; higher parallelism races on the same DB user.
- **Timeouts:** Guest/main/leak projects use **per-project test timeouts** in `playwright.config.ts` so switching tabs and dash actions are not cut off by the global default.

### Regression fix workflow (E2E data / cleanup bugs)

When fixing bugs where tests leave data behind (or similar persistent state):

1. **Add or extend a failing guard** — e.g. `src/routes/dash/dash-leak-check.e2e.ts` exports `dash_leak_guard.scrub_then_assert_clean`: it scrubs tasks whose titles contain the `E2E_` automation prefix, then asserts none remain. Confirm it **fails** while scrub or per-test teardown is broken (red).
2. **Fix production code or test teardown** — cleanup must be reliable (prefer `data-testid` over locale-specific `aria-label` for automation; avoid swallowing cleanup errors unless explicitly intended).
3. **Confirm the guard passes** (green) with full `pnpm test:e2e` (or targeted Playwright command above).
4. **Document** any new invariant in this guide or the relevant E2E helper module.

### Error Messages

- Include expected and actual values explicitly
- Wrap `number` in template literals with `String()`
- Don't add `?? ''` unless the value can genuinely be `undefined`

### Type Safety

- No `any`; always use loop variables (avoids unused-variable lint errors)
- Use `@ts-expect-error`, not `@ts-ignore`

### Statement Limit

- Max 10 statements per test function; split complex tests if exceeded

### No live network

- **A unit test must not reach the network.** Mock every read that leaves the process — a `gh` call, an HTTP request, a CLI subprocess that makes one
- **Mock the whole read, not the first half of it.** A helper that stubs one call and leaves a second one on its default calls through, and the test still **passes** — slower, and against whatever the remote answers. That is how joshuafolkken/kit#1353 reached a 10-second timeout in CI on a change that had nothing to do with it
- In kit's own checkout `vitest.config.ts` arms a guard that fails the run and lists the `gh` invocations it recorded — the commands, not the test that made them, which the command text is usually enough to find (`docs/josh-commands.md` → `josh test:unit`). Elsewhere the rule holds without one

---

## 3. Checklist

- [ ] **Before “done”:** **Completion gate** in `CLAUDE.md` — `pnpm josh gate` (lint, type check, spell check and unit tests), then E2E per § 6 below: the CI E2E job where a pull request is open, **`pnpm josh test:e2e`** run by you where there is none. **Do not** stop at `pnpm josh test:unit` when E2E applies, and **never** ask the user to run it. Run it with `CI` unset so Playwright uses **DEV** (`pnpm run dev` on the port `playwright.config.ts` resolves from `PORT_SEED`), matching the VS Code Test plugin. ReadLints **0 errors** on touched files; Playwright **no failures and no flaky** runs in what you report. **If Playwright cannot run in your environment:** do **not** use `pnpm build` or `CI=true` unless the user asked — say the E2E result is missing and that the gate is therefore not closed
- [ ] Magic numbers/strings → constants (except `0`, `1`, `-1`)
- [ ] `.js` on all import paths
- [ ] Playwright: `data-testid` selectors only
- [ ] `async`/`await` used correctly
- [ ] No `any`; all loop variables used
- [ ] Max 10 statements per test function
- [ ] `read_lints` run; 0 errors before reporting done
- [ ] No unnecessary `?? ''`; `String()` for numbers in template literals

---

## 4. Reference Files

**E2E:** `src/routes/**/page.e2e.ts`, `src/routes/**/praise.e2e.ts`
**Unit:** `src/lib/data/phrases/phrases.test.ts`, `src/lib/data/praise-audio.test.ts`
**ESLint:** `eslint.config.js`

---

## 5. Unit Test Example — Stateful Functions

```typescript
import { expect, test } from 'vitest'
import { get_praise_audio_file, reset_praise_audio_index } from './praise-audio.js'

test('returns expected values in sequence', () => {
	reset_praise_audio_index() // reset state at the start of each test

	const first_result = get_praise_audio_file()
	expect(first_result).toBe('expected-value-1')

	const second_result = get_praise_audio_file()
	expect(second_result).toBe('expected-value-2')
})
```

---

## 6. Closing the E2E gate without a human run

The completion gate used to end by asking the user to run `pnpm josh test` and paste the output.
That step is gone (joshuafolkken/kit#902). It is the rule below that replaces it, and the
replacement is **not** a relaxation — nothing that a red local run stopped is allowed through.

### Why it existed, and why it no longer does

The reason was never that a human reads E2E output better. It was that `followup` waited 180
seconds for CI, which no suite containing E2E can finish in — so the command exited red beside a CI
that was still running, and the only reliable E2E signal left was a person's terminal. That budget
is now derived from the distributed `templates/workflows/ci.yml` rather than picked as a round
number: 1920 seconds, the longest run its `needs` graph permits plus runner-queue headroom, with a
unit test that fails if a declared job budget outgrows it (joshuafolkken/kit#851). CI can now be
waited on, so it can be relied on.

### Which result closes the gate

Decided by whether a pull request is open, never by judgement:

| Situation                                                                                    | What closes the gate                                                                                                     |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| A pull request is open — `fullrun`, `queue`, `epicrun`                                       | The CI E2E job. `pnpm josh followup --merge` waits for the checks and refuses to merge while any of them is non-passing. |
| No pull request — `halfrun`'s stop before commit, a completion reported outside any workflow | `pnpm josh test:e2e`, run by **you**, output read by you.                                                                |

**Never ask the user to run it, in either row.** A completion report is not allowed to depend on
somebody being at the keyboard; that dependency is what made a `fullrun` chain stall at its last
step. And never report completion on an E2E result nobody read — an unread result is not a pass.

**Where the application layer ships an integrated gate, prefer it** over a bare `pnpm josh test:e2e`
for the second row: `@joshuafolkken/app-kit` ships `pnpm josh-app verify`, which builds once and
boots once to run the E2E suite and the DAST scan against that one server — and which delegates E2E
to `josh test:e2e`, so the skip below still applies. **Decide by the command list the installed
toolkit prints, not by which toolkit is installed and not by a version number written here**: the
same rule the UI gate uses, and the only one that survives a release.

### A project with no E2E suite

`pnpm josh test:e2e` runs through `scripts/test-e2e-guard.ts`, which **skips and exits 0**, naming
the reason, when `@playwright/test` is not installed or no `*.e2e.{ts,js}` file exists. That skip is
a **defined** outcome, not an accident: a project with no E2E suite has nothing for the gate to
read, and the run says so out loud. **A skip you did not see printed is not one** — it is an unread
result, and it falls under the previous paragraph.

**CI decides the same question, and now by the same rule.** The `e2e-detect` job in
`templates/workflows/ci.yml` enables the `e2e` job when any `*.e2e.{ts,js}` exists outside
`node_modules` — the guard's own glob, dot-directories left out the way the guard's default leaves
them out — and it does not look at the config's filename at all (joshuafolkken/kit#991). Before
that it required a file named exactly `playwright.config.ts` **and** an `*.e2e.{ts,js}` under `tests` or
`src/routes`, so a suite kept anywhere else, or a config named `playwright.config.js`, read as
"no E2E" in CI while `josh test:e2e` ran it locally: the job's `if:` went false, GitHub recorded it
as `skipped`, the rollup parser counted the skip as passing exactly as it does for every other
conditional job, and the first row of the table above closed the gate on a suite nobody ran.
**Where the specs live was a precondition on the CI signal; it is now a property of the workflow.**
The agreement is executed rather than described — `scripts/ci-yml-e2e-detect.test.ts` runs the
workflow's own script against each layout and compares its verdict to the guard's, and asserts over
the whole matrix that no layout containing specs can yield `enabled=false`. § 1's placement
convention still stands on its own merits (`eslint/rules/test-filename.js` bans a top-level
`tests/` directory outright), but the CI signal no longer depends on following it.

**One difference from the guard remains, and it is deliberate and one-sided.** The guard also skips
when `@playwright/test` is not installed, which is what keeps that optional peer optional for the
pre-push hook; CI enables the job on the spec alone, so a spec that cannot run ends red rather than
silently green. Enabling more than the guard costs a failed job, enabling less costs a merge — so
the difference may widen in that direction and never narrow.

### The gate is not weakened

Two properties carry the verification the human step used to carry, and both are asserted by tests
rather than left to prose:

- **A non-passing check keeps the merge closed.** `evaluate_pr_state` returns `success` only when
  GitHub reports the pull request `CLEAN` **and** every required check passes. A failing E2E job
  makes GitHub report `UNSTABLE`, and the one opening in that wall — `is_unstable_only_from_coderabbit`,
  the temporary kit#753 policy — applies only when _every_ non-passing check is CodeRabbit's. So a
  red E2E can never reach `success`, and `followup` exits non-zero instead of merging.
- **Weakening the gate is a workaround, and the workaround rules apply to it.** Filtering,
  narrowing or reinterpreting E2E output to get past it is the violation `CLAUDE.md` names under
  "Cross-package problems"; reporting the filtered result honestly does not make it compliant.

**`E2E` stays off the required-check list, and that is a decision rather than an oversight**
(joshuafolkken/kit#991). A required check is satisfied by a _skipped_ job — the rollup parser maps
`SKIPPED` to `pass` — so requiring `E2E` would have passed on exactly the skipped job described
above, which is the failure it looks like it would have caught. It adds nothing to the failure path
either: a red E2E already ends the wait on the poll that sees it. What it would add is a cost —
a repository whose CI reports no `E2E` context at all resolves the required entry to `missing`,
which is never `pass`, so the evaluation stays `pending` until the 32-minute wait times out with
nothing actually wrong. What guarantees the job runs is the detection rule above, not the required
list. A project that wants it required opts in through `JOSH_REQUIRED_CHECKS`, which
`scripts/git/git-pr-checks-eval.test.ts` covers; the decision itself — `E2E` off the default list,
and a repository reporting no `E2E` check still mergeable — is pinned in
`scripts/git/git-pr-checks-e2e-gate.test.ts`.

**A red E2E is reported as soon as it goes red, and by name.** `E2E` is not on the required list, so
until joshuafolkken/kit#990 nothing ended the wait when it failed: the rollup read as pending,
`followup` ran out its 32-minute budget, and the run ended in `Timed out while waiting for PR checks
to complete.` — a message naming neither the job nor the cause. Any failing check now ends the wait
on the poll that sees it, and the error names it (`PR checks failed (failed checks: E2E).`).
The poll loop keeps CodeRabbit exempt under the temporary kit#753 policy. **This is a change to how fast the gate
reports, never to what it lets through** — no failing check gained a path to `success`, which
`scripts/git/git-pr-checks-e2e-gate.test.ts` continues to assert.
