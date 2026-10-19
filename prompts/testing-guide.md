# Test Generation Guide

## 0. Per-Requirement Test Coverage (MANDATORY)

Before any implementation code, **list every requirement from the user's request and assign a test to each one**.

### Planning template

```text
Req 1: "Label chip shown immediately"
  → E2E: open editor, type new label, press Enter → chip visible without blurring

Req 2: "Down arrow moves to next row"
  → E2E: open editor on row 1, press ↓ → row 2 enters edit mode

Req N: ...
  → Unit/E2E: ...
```

### Rules

- User-facing behavior change (UI interaction, keyboard shortcut, visible state) → an E2E test.
- Logic/utility change (pure functions, filters, transforms) → a unit test. Bug fix → a regression test; refactor → tests pinning the existing behavior BEFORE the change (`prompts/refactoring.md`).
- **Non-runtime updates (pre-approved manual-only exception):** a change touching no executable runtime code path — docs, non-executable config, editor/IDE files, cosmetic asset swaps with no selector/path change — may be verified by hand; declare it in Step 0 with the reason. The mechanically exempt (`*.md`, `.editorconfig`, `.idea/**`, `.vscode/**`, `prompts/**`) need no declaration. A runtime change whose test is infeasible needs the reason and user approval.
- **basic で kit がテストできない言語だけの変更:** `package.json` に `josh.profile: basic`（改名前の `static` も同じ）があり、変更が HTML/CSS や Lua などのソースだけなら自動テストは不要。HTML/CSS はブラウザーで対象ページを開き、想定する画面幅でレイアウト・リンク・HTML 内の操作を確認する。そのほかのソースは変更した処理を実際に動かす。どちらも結果を記録する。JavaScript または TypeScript のファイルを含む変更は自動テストを行う。
- Test infeasible (e.g., a native OS date-picker Playwright cannot drive) → comment why in the test file and test the closest observable behavior (e.g., the editor stays open after `change`).
- A requirement without its test is not done.

### Verification checklist (add to the completion gate)

- [ ] Requirement count equals the count of tests added/updated (each gap documented as infeasible).
- [ ] UI changes: a screenshot of the affected screen was checked (`CLAUDE.md` → UI verification); if impossible here, say so and ask the user to check.

---

## 1. Test Type Selection

| Condition                                                         | Type                      |
| ----------------------------------------------------------------- | ------------------------- |
| `src/routes/` pages, UI components with user interaction          | E2E (Playwright)          |
| `.ts`/`.js` utilities, `src/lib/server/`, display-only components | Unit/Integration (Vitest) |

**The type is decided from the path, not by asking**: under `src/routes/` → E2E; every other runtime path → Unit (an interactive component is reached through its route). `pnpm josh test:declared` prints the type per untested runtime file on its `required` line.

### Test file naming & placement (one unambiguous rule)

| Test kind           | Required filename        | Routed to                        |
| ------------------- | ------------------------ | -------------------------------- |
| Unit / integration  | `*.test.ts`              | node/unit vitest project         |
| Component / browser | `*.svelte.test.ts`       | browser/component vitest project |
| E2E                 | `src/routes/**/*.e2e.ts` | Playwright                       |

- **Never `*.spec.ts`** — lint-enforced by `eslint/rules/test-filename.js` (wired into `eslint/base.js`) for every JS/TS extension.
- **Keep the `.svelte.` infix** on component/browser tests: `*.svelte.test.ts` matches the browser project (`include: src/**/*.svelte.{test,spec}.{js,ts}`), plain `*.test.ts` the node project (`include: src/**/*.{test,spec}.{js,ts}`); dropping it silently moves the file to the wrong project.
- **Colocate** each test beside its code (`foo.test.ts` next to `foo.ts`); no top-level `tests/` (lint-enforced by the same rule). E2E specs go under `src/routes/**` — enforced by review only, since `playwright.config.ts` `testMatch: '**/*.e2e.{ts,js}'` runs them anywhere.

---

## 2. Test Guidelines

### Naming

- Variables/functions: `snake_case` | Constants: `UPPER_SNAKE_CASE`
- Boolean prefix: `is_`, `has_`, `should_`, `can_`, `will_`, `did_`

### Test Functions

- Outside `describe`: `test`; inside `describe`: `it`
- `describe` only when grouping multiple tests

### Parameterized Tests

- Playwright: `for` loop; Vitest: `test.each` / `it.each`
- Cases: a `cases` or `*_cases` array at file top, outside test functions

### Constants

- Magic numbers → `no-magic-numbers` (`eslint/rules/typescript.js`), off in tests (`eslint/base.js`)

### Imports

- Always the `.js` extension: `import { foo } from './bar.js'`
- Type imports: `import { type Foo } from '...'`

### Playwright

- Select with `page.getByTestId('id')`; add `data-testid` to the implementation
- Test functions always `async`
- `playwright.config.ts` projects, each depending on the previous: `e2e-guest` (no auth: `src/routes/**/dash-guest.e2e.ts`, `src/routes/**/demo.e2e.ts`) → `e2e-main` → `e2e-leak-check`. Authenticated ones restore `storageState` from `src/routes/.auth/user.json` when it exists — no UI login per test.
- `workers: 1` — authenticated E2E shares one storage state and DB user.
- Guest/main/leak projects set per-project test timeouts so tab switches and dash actions are not cut off.

### Regression fix workflow (E2E data / cleanup bugs)

When tests leave persistent state behind:

1. Add or extend a guard and confirm it fails (e.g. `dash_leak_guard.scrub_then_assert_clean` in `src/routes/dash/dash-leak-check.e2e.ts` scrubs `E2E_`-prefixed tasks, then asserts none remain).
2. Fix production code or teardown — prefer `data-testid` over locale-specific `aria-label`; do not swallow cleanup errors unless intended.
3. Confirm green with full `pnpm test:e2e` (or a targeted Playwright run).
4. Document any new invariant here or in the E2E helper module.

### Error Messages

- State expected and actual values
- Wrap `number` in template literals with `String()`
- No `?? ''` unless the value can be `undefined`

### Type Safety

- No `any`; use every loop variable
- `@ts-expect-error`, not `@ts-ignore`

### Statement Limit

- Max 10 statements per test function; split beyond that

### No live network

- **A unit test must not reach the network** — mock every read leaving the process (`gh` call, HTTP request, CLI subprocess that makes one).
- **Mock the whole read**: a stub of one call leaving a second on its default still passes, slowly and against the remote (joshuafolkken/kit#1353: a 10-second CI timeout).
- kit's `vitest.config.ts` fails such a run, listing the `gh` invocations (`docs/josh-commands.md` → `josh test:unit`); elsewhere the rule holds unguarded.

### A josh command that writes state runs through the integration harness (kit only)

- A new or changed state-writing josh command needs a test in all three environments of `tools/test/josh-harness.ts` — kit, a consumer without `docs/`, a lane worktree (joshuafolkken/kit#2402). Packed suite: `vitest.harness.config.ts`

---

## 3. Checklist

- [ ] `pnpm josh gate`, then E2E per § 6: the CI E2E job where a pull request is open; where there is none, run `pnpm josh test:e2e` with `CI` unset (DEV: `pnpm run dev` on the port `playwright.config.ts` derives from `PORT_SEED`); no `pnpm build` or `CI=true` unless asked. Playwright cannot run here → report the E2E result missing and the gate not closed
- [ ] `pnpm josh lint:related`: 0 errors on touched files; Playwright: no failures and no flaky runs
- [ ] § 2 holds: `.js` imports, `data-testid` selectors, correct `async`/`await`, no `any`, ≤10 statements, `String()` / no needless `?? ''`

---

## 4. Reference Files

E2E: `src/routes/**/page.e2e.ts`, `src/routes/**/praise.e2e.ts` · Unit: `src/lib/data/phrases/phrases.test.ts`, `src/lib/data/praise-audio.test.ts` · ESLint: `eslint.config.js`

---

## 5. Unit Test Example — Stateful Functions

Reset module state at the start of each test (`reset_praise_audio_index()` in `src/lib/data/praise-audio.test.ts`), then assert each call of the sequence in order.

---

## 6. Closing the E2E gate without a human run

No human E2E run closes the gate, and nothing a red local run stopped is let through.

### Which result closes the gate

Decided by whether a pull request is open:

| Situation                                                                                    | What closes the gate                                                                                             |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| A pull request is open — `fullrun`, `prrun`, `backlogrun`                                    | The CI E2E job. `pnpm josh followup` waits for the checks and refuses to merge while any of them is non-passing. |
| No pull request — `halfrun`'s stop before commit, a completion reported outside any workflow | `pnpm josh test:e2e`, run by **you**, output read by you.                                                        |

**Never ask the user to run it**, in either row, and never report completion on an unread E2E result — unread is not a pass.

Second row: prefer an integrated gate when the installed toolkit's printed command list has one (not by toolkit or version) — `@joshuafolkken/app-kit`'s `pnpm josh-app verify` builds and boots once for E2E and the DAST scan, delegating E2E to `josh test:e2e` (so the skip below applies).

### A project with no E2E suite

`pnpm josh test:e2e` runs through `scripts/test/test-e2e-guard.ts`, which skips and exits 0, naming the reason, when `@playwright/test` is not installed or no `*.e2e.{ts,js}` file exists. That is a defined outcome; **a skip you did not see printed is an unread result**.

CI uses the same rule: the `e2e-detect` job in `templates/workflows/ci.yml` enables the `e2e` job when any `*.e2e.{ts,js}` exists outside `node_modules` (the guard's glob), whatever the config's filename — on the spec alone, so a spec that cannot run ends red, not silently green. `scripts/ci/ci-yml-e2e-detect.test.ts` pins the agreement.

### The gate is not weakened

- **A non-passing check keeps the merge closed.** `evaluate_pr_state` returns `success` only when GitHub reports the pull request `CLEAN` and every required check passes; the only exception is a non-passing set made entirely of CodeRabbit checks (the temporary kit#753 policy). A failing check ends the wait on the poll that sees it, by name (`PR checks failed (failed checks: E2E).`).
- **Filtering, narrowing or reinterpreting E2E output to get past it is a workaround** (`CLAUDE.md` → "Cross-package problems"), however honestly reported.
- `E2E` stays off the default required-check list; a project opts in through `JOSH_REQUIRED_CHECKS`. `scripts/gh/git-pr-checks-e2e-gate.test.ts` pins both properties.
