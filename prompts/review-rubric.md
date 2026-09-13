# Code Review Rubric

This document is the **rubric the reviewer applies**: how a finding earns its severity, the output
format for each round, the nine categories that must all be checked, and the conditions that stop a
review. It is handed to `/code-review` by `pnpm josh review:brief`, which prints its absolute path
and instructs the review to read and apply it — `/code-review` runs in a forked process that reads
none of this repository's other documents, so this file has to stand on its own.

The orchestration around a review — when it runs, which round is due, how the gate runs beside it,
when the pull request opens — is not here; it lives in `prompts/review.md` and the
`workflow-commands` skill, and the run has already resolved it into the brief. This file is only what
the reviewer needs to read the diff.

**Default hypothesis: this diff contains at least one non-trivial issue.** Your job is not to confirm
the implementation is correct — it is to find the issue. Work through each category assuming the code
is wrong until you can prove otherwise. Do not declare a category clean unless you have actively
tried to break it.

**In the second round that hypothesis is aimed at the fix delta, not at the whole diff again.**
Applied twice to one diff it returns new findings whether or not the code changed, because returning
none is what it rules out — see "The second round is a verification pass" below.

---

## Severity (decided by a test, never by discretion)

The output format below demands a severity on every finding. `medium` is a blocker — it must be
fixed before the PR is opened — so a borderline finding rated `medium` costs a whole round, and
whether it got one must not be left to whoever happened to be reviewing.

**A finding is `medium` or higher only when both of these hold:**

1. **It reaches something real** — a runtime code path, a distributed artifact a consumer reads, **or
   the verification that guards either**: a test, fixture or CI check whose defect lets one of the
   first two ship unnoticed. The third member is not decoration. `package.json` excludes
   `**/*.test.ts` and `**/*-fixture.ts` from what it ships, so without it a vacuous or wrongly-pinned
   suite — the failure mode this repository's marker suites exist to prevent — could never exceed
   `low` and would always be skippable in one line.
2. **You can write the concrete failure scenario** — the inputs or state, and the wrong output,
   breakage or misreading that follows. Not "this could be confusing": the actual sequence.

**Fail either test and the finding is `low`.** In particular, **a finding whose failure scenario you
cannot write is `low` however uncomfortable it looks** — that is the whole of the second test, and it
is the one that decides borderline cases.

**Test 2 asks whether a scenario can be written, not whether you wrote one.** The cheap action — not
attempting it — produces the non-blocking severity. So the obligation is to **attempt the scenario
for every finding that passes test 1, and to say so when the attempt failed**: "no failure scenario —
<what you tried>" is the evidence, and a `low` on a test-1 finding without it is not a severity, it
is a skipped step.

**A distributed artifact is on that list deliberately.** `CLAUDE.md`, `prompts/**`, `.claude/**` and
`docs/**` are reviewed at the same level as runtime code: measured on real documentation-only diffs,
a review found ten real defects each — dangling pointers into removed sections, citations naming the
wrong file, in artifacts distributed to every consumer — that no test covered, because prose is what
they were. A severity rule that ranked documentation below runtime code would contradict that.

**`high` and `low`.** A `high` is fixed before committing and blocks the merge regardless of round
count; a `low` that does not reach the user may be skipped with a one-line reason. This section
decides which findings reach `medium`, not what a severity then does.

**A `low` is not automatically droppable.** A finding that passed test 1 and was rated `low` only for
want of a failure scenario still reaches the user, so where it closes in a few lines inside a file
the diff already touches it is fixed rather than dropped. A `low` that fails test 1 — one that does
not reach the user — is the droppable kind.

---

## The second round is a verification pass, not a second full review

**The second round asks a different question from the first.** Read one diff twice under the
"assume it is wrong" instruction and the two readings return different findings whether or not the
code changed, because returning none is what the instruction rules out. So a Medium would stand at
the second round even where the fixes were sufficient. The second round is narrowed to remove that.

**What changes is the question, never the standard.** A confirmed High still blocks the merge
whatever the round count, the cap is still two rounds, and every rule here applies to this pass
unchanged.

|                | The first round      | The second round                                                                                                                                                               |
| -------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Scope**      | the whole change     | the **fix delta**: what the first round's fixes wrote, plus the call sites of any signature they changed                                                                       |
| **Question**   | "review this change" | "did each first-round finding actually close, and did the fix itself introduce a defect?"                                                                                      |
| **Categories** | all nine             | category 1 (Bug risks & logic errors), plus the categories the fix delta actually touches — i18n only if a fix added a user-visible string, Tests only if a fix changed a test |
| **Output**     | the full template    | one line per first-round finding with its resolution, then any new finding **inside the fix delta**                                                                            |

The brief for round 2 names the exact files that are in scope. Do not re-read the parts of the diff
no fix touched.

Template for the second round:

```md
### First-round findings

1. `src/foo.ts:42` (was high) — resolved — <how the fix closes it>
2. `src/bar.ts:8` (was medium) — **not resolved** (medium) — <what still stands>

### New findings in the fix delta

- `src/foo.ts:47` (medium) — <problem> — <fix>

### Summary

<counts by severity across both sections, and overall go/no-go>
```

**A first-round finding the fix did not close is still a finding, at its original severity.** The
pass narrows what is read, not what counts — an unresolved High blocks exactly as it did in the first
round.

---

## Review output format

Output every category below with an explicit verdict. Do **not** omit categories.

**This is the first round's format.** The second round is a verification pass and has its own,
narrower one — see above.

For each finding:

- Cite `file_path:line_number`
- State **severity** (`high` / `medium` / `low`) — decided by the two tests in "Severity" above, not
  by discretion
- Explain the concrete problem and the minimal fix
- On a finding that passes test 1 of "Severity" but is rated `low`, write the attempt: `no failure
scenario — <what you tried>`

For categories with no findings, you **must** write a brief proof statement — not just `No issues`.
Example: `No issues — checked null returns on X, verified Y edge case, Z is guarded by type.` A bare
`No issues` is only acceptable for Security, Performance, i18n, and Comments when there is genuinely
nothing to check (no auth code, no hot paths, no user strings, no comments touched).

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

All nine are checked in the first round. **The second round checks category 1 plus the categories its
fix delta actually touches** — the verification pass above is the only thing that narrows this list.

### 1. Bug risks & logic errors

Actively try to break the changed code before concluding it is correct.

- **Off-by-one, nullability, promise handling, race conditions**: for every modified function that
  has branching logic, trace at least one non-happy-path scenario. Write the trace explicitly:
  `Traced [input/state] → [result] — confirmed/flagged because [reason]`.
- **Broken invariants, wrong return types, mishandled edge cases**
- **Boundary values and concurrency**: empty / zero / max inputs, unawaited promises, shared state,
  re-entrancy
- **Impact outside the diff**: for every changed export or signature, open its callers and verify
  they still hold; flag duplication the change introduces
- **Regressions**: does the change break any existing behavior covered elsewhere?

`No issues` requires at least one explicit trace statement. Stating `No issues` without a trace is not
allowed.

### 2. Security

- Injection (SQL, command, path traversal), XSS, CSRF
- Auth / authorization gaps, secret or token handling, unsafe deserialization
- Unsafe `as` casts that widen trust boundaries

### 3. Performance

- Obvious hotspots, N+1 queries, unnecessary re-renders / reactive churn
- Large payloads, unbounded loops, blocking I/O on request paths
- Avoid speculative micro-optimization — flag only concrete impact

### 4. Project conventions (`CLAUDE.md`)

**The gate has already run — do not re-verify what lint enforces.** `pnpm josh gate` precedes this
review, and `pnpm josh format:edited` runs `eslint --fix` and `prettier --write` after every `Edit` /
`Write`, so anything ESLint decides has already failed as an error or been corrected before you read
the diff. Re-checking it inflates the first round's finding count.

**Settled by lint, and therefore not checked here** — each one verified against the rule that
enforces it, never assumed:

- **Naming** — `@typescript-eslint/naming-convention` (`eslint/rules/naming-convention.js`).
- **`export default`** — `import/no-default-export` is `error` project-wide (`eslint/rules/import.js`),
  switched off only for `*.d.ts` in `eslint/base.js`.
- **Individually named exports of function declarations, and of consts that are not `UPPER_CASE`** —
  `no-restricted-syntax` in `eslint/rules/code-quality.js`. **Its selector exempts
  `ArrowFunctionExpression`**, so `export const helper = (s: string): string => s` passes it; that
  gap is a reader's job, below.
- **File names** — kebab-case through `unicorn/filename-case`.
- **The `*.spec.*` suffix, and a top-level `tests/` directory** — `eslint/rules/test-filename.js`,
  wired into `eslint/base.js` itself, so it holds in kit and in every project built on that base
  config. **Both bans cover every JS/TS extension** (`.ts` `.tsx` `.mts` `.cts` `.js` `.jsx` `.mjs`
  `.cjs`) and neither covers `.svelte`. **A trailing block switching `no-restricted-syntax` off is
  what can still take it away** — so read a diff that adds one as a gate defect, per the last
  paragraph of this category.
- **Magic numbers** — `@typescript-eslint/no-magic-numbers`; **`any`, unused vars, floating promises
  and explicit param and return types** — `eslint/rules/typescript.js` and `eslint/rules/promise.js`.
- **Identical functions and repeated string literals** — `eslint/rules/sonarjs.js`.
- **Every quality limit below.**

- **Quality limits**: a reference, enforced by `eslint/rules/code-quality.js` and
  `eslint/rules/sonarjs.js` rather than re-checked here — function complexity ≤5, nesting ≤2,
  function ≤25 lines, file ≤300 lines, params ≤4, statements per function ≤10,
  cognitive complexity ≤4 — **the line counts are code lines, not physical lines**: `max-lines` and
  `max-lines-per-function` run with `skipBlankLines` and `skipComments`, so read what
  `pnpm josh lint` reports rather than `wc -l`, and test files (`*.test.ts` / `*.e2e.ts`) allow
  35 code lines per function instead of 25 — **`*.spec.ts` is not on that list**, because the same
  config bans the name outright.

**What only a reader can see — check these:**

- **`function` syntax rather than an arrow const** — **no rule enforces this**: there is no
  `func-style` and no arrow selector anywhere in `eslint/`, and the named-export selector above
  explicitly exempts `ArrowFunctionExpression`. So `const do_thing = (n: number): number => n + 1` and
  `export const helper = (s: string): string => s` both lint clean, and this review is the only thing
  between either and the default branch. The route-file exemption in `CLAUDE.md` covers the named
  route handlers and nothing else.
- **The early-return one-liner** — `curly` is configured `['error', 'multi-line']`, which requires
  braces on a multi-line body and never requires the one-liner form. A short `if (x) { return y }`
  passes lint, so "single `return` under 100 chars → one-liner `if (x) return y`" is a reader's check.
- **Duplication that is not identical** — `sonarjs/no-identical-functions` sees only functions that
  match. Two implementations of one idea in different shapes are invisible to it, and they are exactly
  what "No clones — single-source" is about, package boundaries included.
- **A name that satisfies the convention and says the wrong thing** — `naming-convention` checks the
  shape, never the meaning. An `is_` prefix on a function that returns a parsed value passes lint and
  misleads every caller.
- **Grouping and layout** — a namespace object that collects unrelated functions, or a file whose
  contents no longer match what its name says. Structure is not something lint judges.
- **Svelte semantics** — `$state` reassignment, `Props` as an interface name, restricted DOM
  manipulation, and `PascalCase.svelte` / `PascalCase.svelte.ts` file names where the project's lint
  does not cover them.
- **Test placement beyond the two banned patterns** — the ban above decides the `*.spec.*` suffix and
  the top-level `tests/` directory, and nothing else. **A `tests/Foo.svelte` is outside both**, so it
  is a reader's check. Colocation itself is what it cannot see: a test that avoids both and still sits
  in a directory away from the code it exercises lints clean, and so does an `*.e2e.ts` placed outside
  `src/routes/**`.

**A gate finding that got through is still a finding.** If lint could have caught something and did
not — a disabled rule, an ignored path, an `// eslint-disable` the change added — say so. That is a
defect in the gate, and no other step is looking at it.

### 5. i18n

- All user-visible strings (labels, buttons, toasts, validation errors, page titles) use message keys
- Message keys are added to **all** locale message files, not just one
- No hardcoded user-visible strings slipped in

### 6. Tests

- Every code change has a corresponding test (unit or E2E) per `CLAUDE.md` Code Change Rules Step 0
- Test titles are English only
- Test names describe behavior, not implementation
- **Mutation check**: for the most critical test added or changed, ask: "If I inverted or removed the
  key assertion/condition in the implementation, would this test fail?" If the answer is no or
  uncertain, the test does not verify the behavior — rewrite it.
- **Requirement check**: does the test verify the behavior described in the issue/task, or just that
  code executes without error?

### 7. Comments & content

- Comments are English only
- No narration comments (`// Added for issue #123`, `// TODO: refactor later`) — only comments
  explaining non-obvious _why_
- No duplicated logic that should be extracted

### 8. Assumptions audit

List 2–3 implicit assumptions the implementation makes. For each, state what would break if the
assumption were violated. This section cannot be empty or say "No assumptions."

Examples of assumptions worth naming:

- "The API always returns an array (not null)" — would break with a null-ref if the API changes
- "The locale file always has this key" — would silently show a key string if a locale is missing
- "The animation completes before the next interaction" — race condition if the user acts fast

### 9. Confidence floor

State the **one concrete thing** in this change you are least confident about, and explain why. This
section cannot say "Nothing" or "No concerns." If genuinely nothing is uncertain, trace the exact
logic path that gives you that confidence — that trace itself is the proof.

---

## Stop conditions

- **A checkout that cannot be attested** → report `REVIEW TARGET MISMATCH` and **no findings**, and
  do not report a verdict of any kind. `pnpm josh review:attest <nonce>` exiting non-zero means this
  review read a tree the brief did not describe, so everything it would say — "no findings" above all
  — is about somebody else's code.
- **High** findings → must fix before committing
- **Medium** findings → must fix before opening the PR
- **Low** findings → document in the PR body if skipped

If the diff is empty or trivial (e.g. whitespace only), state that explicitly and skip the review.
