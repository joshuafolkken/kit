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

---

## 1. Test Type Selection

| Condition                                                         | Type                      |
| ----------------------------------------------------------------- | ------------------------- |
| `src/routes/` pages, UI components with user interaction          | E2E (Playwright)          |
| `.ts`/`.js` utilities, `src/lib/server/`, display-only components | Unit/Integration (Vitest) |

When ambiguous, ask the user.

**Output paths:** E2E → `e2e/*.test.ts` / Unit → `src/**/*.spec.ts`

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
- **Project split:** `playwright.config.ts` defines **`e2e-guest`** (no auth: `e2e/dash-guest.test.ts`, `e2e/demo.test.ts`), then **`e2e-main`** (depends on `e2e-guest`), then **`e2e-leak-check`** (depends on `e2e-main`). Authenticated projects set `storageState` to `e2e/.auth/user.json` when that file exists (path constant: `e2e/saved-auth-storage-path.ts`) — **there is no UI login on every test**; cookies/session are restored from disk.
- **Workers:** Playwright uses `workers: 1` because authenticated E2E shares one storage state; higher parallelism races on the same DB user.
- **Timeouts:** Guest/main/leak projects use **per-project test timeouts** in `playwright.config.ts` so switching tabs and dash actions are not cut off by the global default.

### Regression fix workflow (E2E data / cleanup bugs)

When fixing bugs where tests leave data behind (or similar persistent state):

1. **Add or extend a failing guard** — e.g. `e2e/dash-leak-check.ts` exports `dash_leak_guard.scrub_then_assert_clean` (used by `e2e/dash-leak-check.test.ts`): it scrubs tasks whose titles contain the `E2E_` automation prefix, then asserts none remain. Confirm it **fails** while scrub or per-test teardown is broken (red).
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

---

## 3. Checklist

- [ ] **Before “done”:** **Completion gate** in `AGENTS.md` / `CLAUDE.md` — `pnpm run lint`, `pnpm run check`, `pnpm cspell:dot`, then **`pnpm test`** (Vitest **and** Playwright). **Do not** stop at `pnpm test:unit --run` when E2E applies. For local verification, run **`pnpm test` with `CI` unset** so Playwright uses **DEV** (`pnpm run dev` on port 5173 per `playwright.config.ts`), matching the VS Code Test plugin. ReadLints **0 errors** on touched files; Playwright **no failures and no flaky** runs in what you report. **If Playwright cannot run in the agent environment:** do **not** use `pnpm build` or `CI=true` unless the user asked; say Playwright did not complete and ask for local **`pnpm test`** (see **Agent / sandbox** in `AGENTS.md`)
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

**E2E:** `e2e/page.test.ts`, `e2e/praise.test.ts`
**Unit:** `src/lib/data/phrases/phrases.spec.ts`, `src/lib/data/praise-audio.spec.ts`
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
