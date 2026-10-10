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
- **Every logic/utility change** (pure functions, filters, transforms) must have a unit test. A bug fix takes a regression test; a refactor takes tests pinning the existing behavior BEFORE the change (`prompts/refactoring.md`).
- **Non-runtime updates (pre-approved manual-only exception):** a change touching no executable runtime code path — docs, non-executable config, editor/IDE files, cosmetic asset swaps with no selector/path change — may be verified by hand; declare it in Step 0 with the reason. The mechanically exempt (`*.md`, `.editorconfig`, `.idea/**`, `.vscode/**`, `prompts/**`) need no declaration. A runtime change whose test is infeasible needs the reason and user approval.
- **basic で kit がテストできない言語だけの変更:** `package.json` に `josh.profile: basic`（改名前の `static` も同じ）が記録され、変更が HTML/CSS や Lua などのソースだけなら自動テストは不要。HTML/CSS はブラウザーで対象ページを開き、想定する画面幅でレイアウト・リンク・HTML 内の操作を確認する。そのほかのソースは変更した処理を実際に動かす。どちらも結果を記録する。同じ変更に JavaScript または TypeScript のファイルが含まれれば自動テストを行う。
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

**The type is decided from the path, not by asking.** A change under `src/routes/` takes E2E; every other runtime path takes Unit — a component with interaction is reached through the route that renders it, and that route is under `src/routes/`. `pnpm josh test:declared` prints the type each untested runtime file calls for on its `required` detail line, so the choice never becomes a stop.

### Test file naming & placement (one unambiguous rule)

There is exactly **one** convention for every test file — never choose between two. The rules below are mandatory; some are config-enforced (a violating file runs under the wrong vitest project or not at all), others are enforced by convention/review — each rule states which.

| Test kind           | Required filename        | Routed to                        |
| ------------------- | ------------------------ | -------------------------------- |
| Unit / integration  | `*.test.ts`              | node/unit vitest project         |
| Component / browser | `*.svelte.test.ts`       | browser/component vitest project |
| E2E                 | `src/routes/**/*.e2e.ts` | Playwright                       |

- **Use `*.test.ts` — never `*.spec.ts`.** **Lint-enforced** by `eslint/rules/test-filename.js` (wired into `eslint/base.js`) for every JS/TS extension; how the ban is wired and why: `docs/maintainers/testing-guide-history.md` → "Why the `*.spec.*` ban is a lint rule".
- **The `.svelte.` infix is required for component/browser tests and must be preserved.** `*.svelte.test.ts` routes the file to the **browser/component** vitest project (`include: src/**/*.svelte.{test,spec}.{js,ts}`); plain `*.test.ts` routes to the **node/unit** project (`include: src/**/*.{test,spec}.{js,ts}`). Renaming `Foo.svelte.test.ts` → `Foo.test.ts` silently moves it to the wrong project — do not drop the `.svelte.` infix.
- **Colocate every test next to the code it exercises.** A top-level `tests/` directory is **not used** — place `foo.test.ts` beside `foo.ts`, and E2E specs under the relevant `src/routes/**` path. The top-level `tests/` ban is **lint-enforced** by the same rule (`eslint/rules/test-filename.js`). Note: `playwright.config.ts` discovers E2E via `testMatch: '**/*.e2e.{ts,js}'`, so an `*.e2e.ts` placed outside `src/routes/**` would still run — that specific `src/routes/**` placement is enforced by **convention/review, not config**, and must be upheld manually.

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

### A josh command that writes state runs through the integration harness (kit only)

- **A new or changed state-writing josh command needs a test in all three environments of `scripts/test/josh-harness.ts`** — kit, a consumer without `docs/`, a lane worktree (joshuafolkken/kit#2402). Packed suite: `vitest.harness.config.ts`

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

No human E2E run closes the gate, and nothing a red local run stopped is let through
(`docs/maintainers/testing-guide-history.md`).

### Which result closes the gate

Decided by whether a pull request is open, never by judgement:

| Situation                                                                                    | What closes the gate                                                                                             |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| A pull request is open — `fullrun`, `prrun`, `backlogrun`                                    | The CI E2E job. `pnpm josh followup` waits for the checks and refuses to merge while any of them is non-passing. |
| No pull request — `halfrun`'s stop before commit, a completion reported outside any workflow | `pnpm josh test:e2e`, run by **you**, output read by you.                                                        |

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

`pnpm josh test:e2e` runs through `scripts/test/test-e2e-guard.ts`, which **skips and exits 0**, naming
the reason, when `@playwright/test` is not installed or no `*.e2e.{ts,js}` file exists. That skip is
a **defined** outcome, not an accident: a project with no E2E suite has nothing for the gate to
read, and the run says so out loud. **A skip you did not see printed is not one** — it is an unread
result, and it falls under the previous paragraph.

**CI decides the same question by the same rule.** The `e2e-detect` job in
`templates/workflows/ci.yml` enables the `e2e` job when any `*.e2e.{ts,js}` exists outside
`node_modules` — the guard's own glob — whatever the config's filename;
`scripts/ci/ci-yml-e2e-detect.test.ts` pins the agreement. CI enables the job on the spec alone, even
where the guard skips for a missing `@playwright/test`, so a spec that cannot run ends red rather than
silently green.

### The gate is not weakened

- **A non-passing check keeps the merge closed.** `evaluate_pr_state` returns `success` only when
  GitHub reports the pull request `CLEAN` **and** every required check passes; the only exception is a
  non-passing set made entirely of CodeRabbit checks (the temporary kit#753 policy). A failing check
  ends the wait on the poll that sees it, by name (`PR checks failed (failed checks: E2E).`).
- **Filtering, narrowing or reinterpreting E2E output to get past it is a workaround** —
  `CLAUDE.md` → "Cross-package problems"; reporting the filtered result honestly does not make it
  compliant.
- **`E2E` stays off the default required-check list**; a project opts in through
  `JOSH_REQUIRED_CHECKS`. `scripts/gh/git-pr-checks-e2e-gate.test.ts` pins both properties.
