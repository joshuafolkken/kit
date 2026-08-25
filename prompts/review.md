# Code Review Prompt

This document is the **single source of truth** for reviewing a diff. The implementing session runs it inline, before committing — both for the pre-commit self-review and for the review step inside `fullrun` / `halfrun` / `queue`.

**Default hypothesis: this diff contains at least one non-trivial issue.** Your job is not to confirm the implementation is correct — it is to find the issue. Work through each category assuming the code is wrong until you can prove otherwise. Do not declare a category clean unless you have actively tried to break it.

---

## When to run

- **Pre-commit self-review** (implementing session, inline): before every `git commit` on a feature branch — scope: the staged diff (`git diff --staged`)
- **Workflow review step** (same session, inline): the last stage of the verification gate in `fullrun` / `halfrun` / `queue`, before `pnpm josh bump minor` and the commit — scope: `git diff main`

Re-run after applying fixes until **no high or medium findings remain — or until two reviews have run in total — the first one included — whichever comes first.** Low findings may be acknowledged and skipped with a reason. The cap is spelled out below and it is not optional.

---

## Review round cap (2 rounds)

The severity rule above is not a stopping condition on its own. Every fix creates new surface, and a review whose scope is the whole change finds something in it — so the loop is bounded by how much new code the fixes produce, which is unbounded.

This is measured, not theorized. On joshuafolkken/kit#854 four rounds produced 18 findings; on joshuafolkken/kit#855 two rounds produced 19. Almost none of them was a repeat: each round found new things, and many of those were about code the **previous round's fix** had just written. One fix replaced a line-based check with a proximity window, and the next two rounds each found a new defect in that window. Another moved a rule into a skill, and a later round moved it back. Two rounds of that is diligence; a third is the review chasing its own tail.

- **After the second round, every remaining finding that is not a confirmed High is filed as a follow-up Issue, and the current Issue completes.** Filing is mandatory — a deferred finding is never silently dropped — and the new Issue references the current one.
- **A confirmed High is never deferred.** The filing rule above covers Low and Medium only: a real defect does not ship because a round counter ran out, so a standing High blocks the merge.
- **Blocking the merge is not the same as buying more rounds.** If a High is still standing after the second round, do not start a third — two rounds of fixing failed to close it, and a third is the review chasing its own tail. It says the change itself is not ready: stop, send a `confirmation` Telegram, and put the scope back to the user, where splitting the Issue is usually the answer.

The cap is deliberately mechanical rather than a judgement call, because judgement is what fails here: on #854 the third and fourth rounds were spent on findings that the Low rule already permitted skipping — a misplaced comment, an unused export, a stale comment — treated as blockers because the review returned them without severities.

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
- **Boundary values and concurrency**: empty / zero / max inputs, unawaited promises, shared state, re-entrancy
- **Impact outside the diff**: for every changed export or signature, open its callers and verify they still hold; flag duplication the change introduces
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

---

## Auto-continue rule (fullrun-conditional) — read this BEFORE sending the review

**This rule fires only when `/code-review` was invoked inside a `fullrun` / `fullrun new` / `queue` workflow.** Standalone `/code-review <PR>` invocations are exempt — for those, stop after the review markdown as normal. **A `halfrun` invocation NEVER enters fullrun mode** — halfrun runs this same review inside its verification gate, but it ends at the confirmation stop without committing: once the review settles, send the `confirmation` Telegram and stop with the work uncommitted.

### How to tell which mode you are in

You are in **fullrun mode** if BOTH of the following hold:

1. The user's recent message (within the current conversation) contained `fullrun`, `fullrun new`, or `queue` as a typed command. The keyword is the only valid signal: pipeline markers (issue normalized, `josh latest` run, branch created, `pnpm josh git -y` invoked) no longer distinguish `fullrun` from `halfrun` and MUST NOT be used to infer fullrun mode.
2. The implementation is finished and the verification gate has reached its review step. The review runs **before** the commit, so neither a commit nor a PR exists yet — their absence is not a signal about the mode.

If either condition is false, you are in **standalone mode** (or the halfrun confirmation stop) — do not call `followup --merge`.

### What to do in fullrun mode

Before your response (the one containing the review markdown) is sent, run this self-check:

1. Count high/medium-severity findings across all categories.
2. If **any** high/medium findings exist → fix them in place and re-run `/code-review medium`. Nothing is committed yet, so a round costs no commit, push, or CI run. **Stop at two rounds** — after the second, file every remaining Low/Medium finding as a follow-up Issue and continue the pipeline; a standing High blocks the merge but does not authorize a third round (see "Review round cap"). **Do NOT call `followup --merge` yet.**
3. If **no** high/medium findings exist (Low-only or completely clean) → your response MUST continue the pipeline in tool calls **after** the review markdown, in the same response: `pnpm josh bump minor`, then `pnpm josh git -y "<title> #<N>"`, then `pnpm josh followup "<title> #<N>" --merge --notify-message "..."`. **Do NOT end the turn with review markdown as the final assistant text.**

### Concrete failure pattern to self-recognize

If you are about to send a response whose final text is the `/code-review` Markdown — with sections, severity-tagged findings, and a recommendation line — and **no tool call follows**, that response is a chain-rule violation. Cancel it. Add the `pnpm josh bump minor` → `pnpm josh git -y` → `pnpm josh followup --merge` tool calls to the same response before sending.

This rule mirrors the chain-rule decision table in `CLAUDE.md` / `AGENTS.md` / `GEMINI.md` / `prompts/collaboration-workflow.md`. It is repeated here because the violation point is at the moment the review skill finishes producing markdown — the rule must be visible in the skill's own context, not just in the always-loaded project docs.
