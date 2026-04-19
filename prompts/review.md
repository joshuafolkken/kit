# Code Review Prompt

This document is the **single source of truth** for Claude Code when reviewing the current diff before committing.

**Default hypothesis: this diff contains at least one non-trivial issue.** Your job is not to confirm the implementation is correct — it is to find the issue. Work through each category assuming the code is wrong until you can prove otherwise. Do not declare a category clean unless you have actively tried to break it.

---

## When to run

- Before every `git commit` on a feature branch
- Before running `pnpm josh git` / `pnpm josh git-followup` to open a PR
- Scope: the staged diff (`git diff --staged`) and the cumulative PR diff (`git diff main...HEAD`)

Re-run after applying fixes until **no high or medium findings remain**. Low findings may be acknowledged and skipped with a reason.

---

## Review output format

Output every category below with an explicit verdict. Do **not** omit categories.

For each finding:

- Cite `file_path:line_number`
- State **severity** (`high` / `medium` / `low`)
- Explain the concrete problem and the minimal fix

For categories with no findings, you **must** write a brief proof statement — not just `No issues`. Example: `No issues — checked null returns on X, verified Y edge case, Z is guarded by type.` A bare `No issues` is only acceptable for Security, Performance, i18n, and Comments when there is genuinely nothing to check (no auth code, no hot paths, no user strings, no comments touched).

Template:

```md
### Bug risks & logic errors

- `src/foo.ts:42` (high) — <problem> — <fix>

### Security

No issues — no auth code, no user input, no unsafe casts in diff.

### Performance

No issues — no loops, no reactive chains, no I/O on request paths.

### Project conventions

No issues — verified snake_case, no arrow functions, no magic numbers, i18n covered.

### i18n

No issues — no user-visible strings added.

### Tests

- `e2e/foo.test.ts:15` (medium) — assertion does not fail if implementation is inverted — rewrite to verify X not just that code runs

### Comments & content

No issues

### Assumptions audit

1. <assumption the implementation makes> — <what breaks if violated>
2. ...

### Confidence floor

<One concrete thing in this change I am least confident about, and why.>

### Summary

<total counts by severity and overall go/no-go>
```

---

## Review categories (must all be checked)

### 1. Bug risks & logic errors

Actively try to break the changed code before concluding it is correct.

- **Off-by-one, nullability, promise handling, race conditions**: for every modified function that has branching logic, trace at least one non-happy-path scenario. Write the trace explicitly: `Traced [input/state] → [result] — confirmed/flagged because [reason]`.
- **Broken invariants, wrong return types, mishandled edge cases**
- **Regressions**: does the change break any existing behavior covered elsewhere?

`No issues` requires at least one explicit trace statement. Stating `No issues` without a trace is not allowed.

### 2. Security

- Injection (SQL, command, path traversal), XSS, CSRF
- Auth / authorization gaps, secret or token handling, unsafe deserialization
- Unsafe `as` casts that widen trust boundaries

### 3. Performance

- Obvious hotspots, N+1 queries, unnecessary re-renders / reactive churn
- Large payloads, unbounded loops, blocking I/O on request paths
- Avoid speculative micro-optimization — flag only concrete impact

### 4. Project conventions (`CLAUDE.md` / `AGENTS.md` / `GEMINI.md`)

Verify **every** rule below. These are non-standard, so call out any violation.

- **Naming**: `snake_case` for variables / functions / params; `PascalCase` for types / classes / interfaces / enums; `UPPER_CASE` for enum members and constants; booleans prefixed `is_` / `has_` / `should_` / `can_` / `will_` / `did_`
- **Functions & exports**: `function` syntax (not arrow); multiple functions grouped into a namespace object `export { my_module }`; no `export default`
- **Files**: Svelte → `PascalCase.svelte` / `PascalCase.svelte.ts`; TypeScript → `kebab-case.ts` (route files exempt)
- **Quality limits**: function complexity ≤4, nesting ≤1, function ≤25 lines, file ≤300 lines, params ≤3; magic numbers extracted to `UPPER_CASE` constants except `0`, `1`, `-1`; no `any`, no unused vars, no floating promises; explicit param and return types
- **Early return**: single `return` under 100 chars → one-liner `if (x) return y`
- **Svelte**: `$state` is reassignable; `Props` interface name is allowed; DOM manipulation restricted

### 5. i18n

- All user-visible strings (labels, buttons, toasts, validation errors, page titles) use message keys
- Message keys are added to **all** locale message files, not just one
- No hardcoded user-visible strings slipped in

### 6. Tests

- Every code change has a corresponding test (unit or E2E) per `CLAUDE.md` Code Change Rules Step 0
- Test titles are English only
- Test names describe behavior, not implementation
- **Mutation check**: for the most critical test added or changed, ask: "If I inverted or removed the key assertion/condition in the implementation, would this test fail?" If the answer is no or uncertain, the test does not verify the behavior — rewrite it.
- **Requirement check**: does the test verify the behavior described in the issue/task, or just that code executes without error?

### 7. Comments & content

- Comments are English only
- No narration comments (`// Added for issue #123`, `// TODO: refactor later`) — only comments explaining non-obvious _why_
- No duplicated logic that should be extracted

### 8. Assumptions audit

List 2–3 implicit assumptions the implementation makes. For each, state what would break if the assumption were violated. This section cannot be empty or say "No assumptions."

Examples of assumptions worth naming:

- "The API always returns an array (not null)" — would break with a null-ref if the API changes
- "The locale file always has this key" — would silently show a key string if a locale is missing
- "The animation completes before the next interaction" — race condition if the user acts fast

### 9. Confidence floor

State the **one concrete thing** in this change you are least confident about, and explain why. This section cannot say "Nothing" or "No concerns." If genuinely nothing is uncertain, trace the exact logic path that gives you that confidence — that trace itself is the proof.

---

## Stop conditions

- **High** findings → must fix before committing
- **Medium** findings → must fix before opening the PR
- **Low** findings → document in the PR body if skipped

If the diff is empty or trivial (e.g. whitespace only), state that explicitly and skip the review.
