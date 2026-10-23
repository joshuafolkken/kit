# Code Review Rubric

The rubric the reviewer applies: severity, output format, the nine categories and stop conditions.
`pnpm josh review:brief` prints its absolute path for `/code-review`, which runs in a forked process
reading no other repository document, so this file stands alone. Orchestration (when a review runs,
which round is due, the gate, the PR) is in `prompts/review.md` and the `workflow-commands` skill,
already resolved into the brief.

**Default hypothesis: this diff contains at least one non-trivial issue.** Your job is to find it, not
to confirm correctness. Assume each category is wrong until proven otherwise; declare one clean only
after actively trying to break it. In the second round the hypothesis is aimed at the fix delta, not
the whole diff (see "The second round is a verification pass" below).

---

## Severity (decided by a test, never by discretion)

`medium` blocks opening the PR, so a borderline `medium` costs a whole round — decide it by test.

**A finding is `medium` or higher only when both of these hold:**

1. **It reaches something real** — a runtime code path, a distributed artifact a consumer reads, or
   the verification that guards either (a test, fixture or CI check whose defect lets one of the first
   two ship unnoticed). `package.json` does not ship `**/*.test.ts` or `**/*-fixture.ts`, so without
   this third member a vacuous or wrongly-pinned suite could never exceed `low`.
2. **You can write the concrete failure scenario** — the inputs or state, and the wrong output,
   breakage or misreading that follows. Not "this could be confusing": the actual sequence.

Fail either test and the finding is `low` — **a finding whose failure scenario you cannot write is
`low` however uncomfortable it looks**.

Test 2 asks whether a scenario can be written, not whether you wrote one: attempt it for every finding
that passes test 1, and when the attempt fails write "no failure scenario — <what you tried>". A `low`
on a test-1 finding without that line is a skipped step.

Distributed artifacts — `CLAUDE.md`, `prompts/**`, `.claude/**`, `docs/**` — are reviewed at the same
level as runtime code: a dangling pointer or a citation naming the wrong file reaches every consumer,
and no test covers prose.

`high` is fixed before committing and blocks the merge regardless of round count. A `low` that fails
test 1 (does not reach the user) may be dropped with a one-line reason; a `low` that passed test 1 and
lacks only a failure scenario still reaches the user, so if it closes in a few lines inside a file the
diff already touches, fix it.

---

## The second round is a verification pass, not a second full review

Read twice under "assume it is wrong", one diff returns new findings whether or not the code changed,
so round 2 asks a different question. **The question changes, never the standard**: a confirmed High
still blocks the merge, the cap in `prompts/review.md` → "Review round cap" still holds, and every rule
here applies unchanged.

|                | First round          | Second round                                                                                                          |
| -------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Scope**      | the whole change     | the fix delta: what round 1's fixes wrote, plus call sites of any signature they changed                              |
| **Question**   | "review this change" | "did each first-round finding close, and did the fix introduce a defect?"                                             |
| **Categories** | all nine             | category 1, plus categories the fix delta touches (i18n only for an added user-visible string, Tests only for a test) |
| **Output**     | the full template    | one line per first-round finding with its resolution, then new findings inside the fix delta                          |

The round-2 brief names the in-scope files; do not re-read parts no fix touched.

```md
### First-round findings

1. `src/foo.ts:42` (was high) — resolved — <how the fix closes it>
2. `src/bar.ts:8` (was medium) — **not resolved** (medium) — <what still stands>

### New findings in the fix delta

- `src/foo.ts:47` (medium) — <problem> — <fix>

### Summary

<counts by severity across both sections, and overall go/no-go>
```

An unclosed first-round finding keeps its original severity; an unresolved High blocks as before.

---

## Review output format

First-round format (round 2 uses the one above). Give every category an explicit verdict; omit none.

For each finding:

- Cite `file_path:line_number`
- State severity (`high` / `medium` / `low`) by the two tests in "Severity"
- Explain the concrete problem and the minimal fix
- On a `high` or `medium`, cite every other site of the same pattern in the change's files and their
  callers as `file_path:line_number`, so one fix pass closes them all
- On a test-1 finding rated `low`, write `no failure scenario — <what you tried>`

A category with no findings needs a proof statement, e.g. `No issues — checked null returns on X,
verified Y edge case, Z is guarded by type.` A bare `No issues` is allowed only for Security,
Performance, i18n and Comments when there is genuinely nothing to check (no auth code, hot paths, user
strings or comments touched).

Template — one `###` heading per category in the order of "Review categories", then `### Summary`:

```md
### Bug risks & logic errors

- `src/foo.ts:42` (high) — <problem> — <fix>

### Project conventions

No issues — `parse_ids` returns what its name says; no near-copy of `split_ids` added; tests sit beside the source.

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

Round 1 checks all nine; round 2 checks category 1 plus the categories its fix delta touches.

### 1. Bug risks & logic errors

Actively try to break the changed code.

- Off-by-one, nullability, promise handling, race conditions: for every modified function with
  branching, trace at least one non-happy path and write it:
  `Traced [input/state] → [result] — confirmed/flagged because [reason]`.
- Broken invariants, wrong return types, mishandled edge cases
- Boundary values and concurrency: empty / zero / max inputs, unawaited promises, shared state,
  re-entrancy
- Impact outside the diff: open the callers of every changed export or signature and verify they still
  hold; flag duplication the change introduces
- Regressions in existing behavior covered elsewhere

**`No issues` requires at least one explicit trace statement.**

### 2. Security

- Injection (SQL, command, path traversal), XSS, CSRF
- Auth / authorization gaps, secret or token handling, unsafe deserialization
- Unsafe `as` casts that widen trust boundaries

### 3. Performance

- Obvious hotspots, N+1 queries, unnecessary re-renders / reactive churn
- Large payloads, unbounded loops, blocking I/O on request paths
- Flag only concrete impact, not speculative micro-optimization

### 4. Project conventions (`CLAUDE.md`)

Do not re-check what lint enforces (the gate already ran). Check what lint misses: non-identical
duplication, a name whose shape passes but whose meaning misleads, grouping and file layout, Svelte
semantics, and test placement beyond the `*.spec.*` / top-level `tests/` bans. **A lint gap the change
opens is itself a finding** — a disabled rule, an ignored path, an added `eslint-disable`, a block
switching `no-restricted-syntax` off.

### 5. i18n

- All user-visible strings (labels, buttons, toasts, validation errors, page titles) use message keys
- Message keys are added to all locale message files, not just one
- No hardcoded user-visible strings

### 6. Tests

- Every code change has a corresponding test (unit or E2E) per `CLAUDE.md` Code Change Rules Step 0
- Test titles describe behavior, not implementation
- **Mutation check**: for the most critical test added or changed — if the key assertion/condition in
  the implementation were inverted or removed, would it fail? If no or uncertain, rewrite it.
- **Requirement check**: does the test verify the behavior the issue/task describes, or only that code
  runs without error?

### 7. Comments & content

- No narration comments (`// Added for issue #123`, `// TODO: refactor later`) — only non-obvious _why_
- No duplicated logic that should be extracted

### 8. Assumptions audit

List 2–3 implicit assumptions and what breaks if each is violated. Never empty or "No assumptions."

- "The API always returns an array (not null)" — null-ref if the API changes
- "The locale file always has this key" — shows a key string if a locale is missing
- "The animation completes before the next interaction" — race if the user acts fast

### 9. Confidence floor

State the **one concrete thing** you are least confident about, and why. Never "Nothing" or "No
concerns"; if nothing is uncertain, trace the logic path that gives that confidence as the proof.

---

## Stop conditions

- **A checkout that cannot be attested** (`pnpm josh review:attest <nonce>` exits non-zero) → report
  `REVIEW TARGET MISMATCH`, no findings and no verdict of any kind: the review read a tree the brief did
  not describe.
- High findings → must fix before committing
- Medium findings → must fix before opening the PR
- Low findings → document in the PR body if skipped

If the diff is empty or trivial (e.g. whitespace only), state that and skip the review.
