# Code Review Prompt

This document is the **single source of truth** for reviewing a diff. The implementing session runs it inline, before committing — both for the pre-commit self-review and for the review step inside `fullrun` / `halfrun` / `queue`.

**Default hypothesis: this diff contains at least one non-trivial issue.** Your job is not to confirm the implementation is correct — it is to find the issue. Work through each category assuming the code is wrong until you can prove otherwise. Do not declare a category clean unless you have actively tried to break it.

**In the second round that hypothesis is aimed at the fix delta, not at the whole diff again.** Applied twice to one diff it returns new findings whether or not the code changed, because returning none is what it rules out — see "The second round is a verification pass, not a second full review" below.

---

## When to run

- **Pre-commit self-review** (implementing session, inline): before every `git commit` on a feature branch — scope: the staged diff (`git diff --staged`)
- **Workflow review step** (same session, inline): the last stage of the verification gate in `fullrun` / `halfrun` / `queue`, before `pnpm josh bump minor` and the commit — scope: `git diff main`

Re-run after applying fixes until **no high or medium findings remain — or until two reviews have run in total — the first one included — whichever comes first.** Low findings may be acknowledged and skipped with a reason. The cap is spelled out below and it is not optional.

**The re-run is not this review a second time.** The second round is a **verification pass over the fixes** — its scope, its question, its categories and its output all differ from the first round's. Definition: "The second round is a verification pass, not a second full review" below.

---

## Review level (decided by `josh review:level`, never by judgement)

**Run `pnpm josh review:level` and use what it prints.** It reads the changed paths and answers `low` or `medium`; `--staged` classifies the staged diff instead of the branch diff, and `--json` adds the reason.

```bash
pnpm josh review:level            # alias: josh rl
pnpm josh review:level --staged
```

**The level is decided from the changed paths and nothing else.** "This one is small" is a judgement made under cost pressure, and cost pressure resolves it toward "small" exactly when a defect is most likely to be shipped — the same reason the cross-package interrupt removed its own "does this block?" evaluation. A rule an agent applies from memory is a rule an agent can talk itself out of; one it has to run answers the same way every time.

| Every changed path is…                                                                   | Level    | Rounds                  |
| ---------------------------------------------------------------------------------------- | -------- | ----------------------- |
| **inert** — `.editorconfig`, `.gitignore`, `LICENSE`, `CHANGELOG.md`, `*.code-workspace` | `low`    | 1                       |
| anything else                                                                            | `medium` | up to 2 (the cap below) |

**One non-inert path decides the whole change.** A review reads the change, not a subset of it, so there is no per-file level. An empty diff also takes `medium` — answering `low` to "nothing changed" would hand a reduced level to a caller that failed to read the diff.

**Three things that look inert are not.** `.vscode/**`, `.gitattributes` and `.prettierignore` are all in `package.json`'s `files` and are written into every consumer project by `josh init` / `josh sync`, so a defect in one reaches a consumer and is reviewed at `medium` like any other shipped file.

**Documentation is not inert either, and that is deliberate.** `CLAUDE.md`, `prompts/**`, `.claude/**` and `docs/**` are all reviewed at `medium`. The "Non-runtime updates" exception in `CLAUDE.md` exempts them from _testing_, which is a different question: that exception asks whether an automated test could have caught the defect, and this asks whether a human reading the diff is the only thing that can. Measured on joshuafolkken/kit#963 and #965 — both documentation-only by that classification — a `medium` review found ten real defects in each: pointers into sections that had been removed, and citations naming the wrong file, in artifacts distributed to every consumer. Nothing else would have caught them.

**The round cap below is unchanged**, and so is the rule that a confirmed High blocks regardless of round count.

## Review round cap (2 rounds)

The severity rule above is not a stopping condition on its own. Every fix creates new surface, and a review whose scope is the whole change finds something in it — so the loop is bounded by how much new code the fixes produce, which is unbounded.

This is measured, not theorized. On joshuafolkken/kit#854 four rounds produced 18 findings; on joshuafolkken/kit#855 two rounds produced 19. Almost none of them was a repeat: each round found new things, and many of those were about code the **previous round's fix** had just written. One fix replaced a line-based check with a proximity window, and the next two rounds each found a new defect in that window. Another moved a rule into a skill, and a later round moved it back. Two rounds of that is diligence; a third is the review chasing its own tail.

### The second round is a verification pass, not a second full review

**The second round asks a different question from the first.** Until joshuafolkken/kit#1219 it asked the same one — read the whole diff adversarially — inside a document whose opening line forbids declaring anything clean without proof. Read one diff twice under that instruction and the two readings return different findings whether or not the code changed, because returning none is what the instruction rules out. So a Medium stood at the second round even where the fixes were sufficient, and the three-way disposition below had to be run every single time.

**What changes is the question, never the standard.** A confirmed High still blocks the merge whatever the round count, the cap is still two rounds, and every rule below applies to this pass unchanged.

|                | The first round                    | The second round                                                                                                                                                               |
| -------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Scope**      | `git diff main` — the whole change | the **fix delta**: what the first round's fixes wrote, plus the call sites of any signature they changed                                                                       |
| **Question**   | "review this change"               | "did each first-round finding actually close, and did the fix itself introduce a defect?"                                                                                      |
| **Categories** | all nine                           | category 1 (Bug risks & logic errors), plus the categories the fix delta actually touches — i18n only if a fix added a user-visible string, Tests only if a fix changed a test |
| **Output**     | the full template                  | one line per first-round finding with its resolution, then any new finding **inside the fix delta**                                                                            |

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

**A first-round finding the fix did not close is still a finding, at its original severity.** The pass narrows what is read, not what counts — an unresolved High blocks exactly as it did in the first round.

**This is a generalization of a rule already written, not a relaxation of one.** Branch 1 of the three-way disposition below already states that **a fix-in-place never starts a new review round** — so the document has already accepted that a fix does not oblige anyone to read the whole diff again. The second round applies that same reasoning to the rest of the fixes: what has to be read is what the fix wrote, and re-reading the code no fix touched is what manufactures the artificial findings above.

**It converges because the fix delta shrinks.** Each round's fixes are smaller than the last, so the scope is monotonically decreasing — which the whole-diff scope never was, and which is why the cap had to bound the loop from outside rather than the loop ending on its own.

### Three-way disposition after the cap

**The cap needed three exits, not one.** For a long time it had exactly one: after the second round, every non-High finding was filed as a follow-up Issue. That is the largest single manufacturing line of follow-up Issues in this workflow, and it files Issues that are not worth one — joshuafolkken/kit#1069 corrected three comments that changed no executable line and still took six Issues across two REST-migration cleanups to do it, each carried over because a per-child scope check dropped it. **A finding's disposition is decided from what it is, mechanically — not from the filer's discretion.** After the second round, place every remaining non-High finding in exactly one of these:

1. **Fix it in place.** The finding closes in a few lines inside a file the diff already touches, with no design judgement — a stale comment, a name, an unused export. **A fix-in-place never starts a new review round.** This is the ceiling that keeps the exit from buying back the round cap: the fix widens the diff, so a naive re-review would find it and re-open the loop the cap just closed. The bound is written into the exit itself — the fix must stay **inside a file the diff already changed** and carry **no design decision**; a finding that cannot close under both limits is not a fix-in-place, it is filed.
2. **File it as an Issue.** The finding reaches a runtime code path, or it needs a decision. This is the branch the old blanket rule collapsed everything into, and the filing procedure below — reference the current Issue, then bundle — is unchanged for it.
3. **Drop it with a one-line note in the PR body.** A Low finding that does not reach the user. This is the same disposition the pre-commit self-review already permits for a Low ("Low findings may be skipped with a one-line reason"), extended past the round cap — the two documents no longer disagree about what happens to a Low.

**Findings that reduce to one root judgement are filed as one Issue, not several.** When two or more findings are the same underlying design decision seen from different call sites, they belong in a single follow-up Issue with a section per symptom (`## 現象 1` / `## 現象 2`), the shape joshuafolkken/kit#1077, #1068 and #1069 already use. Deciding this from the findings rather than the filer's discretion is the point: without the rule, whether they collapse is left to whoever happens to be filing.

Only branch 2 files an Issue. What follows applies to that branch.

- **A finding routed to branch 2 is filed as a follow-up Issue, and the current Issue completes.** Filing is mandatory for that branch — a finding that reaches a runtime path or needs a decision is never silently dropped — and the new Issue references the current one. (A confirmed High is not a branch-2 finding: it blocks the merge rather than being deferred — see below.)
- **Filing does not end at the Issue.** `epic:next` only ever offers a child an epic's task list names, so an Issue in no epic is never handed to a running `epicrun` — picking it up takes a person who already knows its number. The deferred finding is not dropped, it is parked forever, which reads the same from the backlog. The step belongs here rather than only in the epic rules, because a procedure that ends at "file it" is followed to its end:

  1. File the follow-up Issue referencing the current one (above), tagged `route:review-cap` so the backlog stays countable by filing route rather than by grepping issue bodies (joshuafolkken/kit#1083): `gh api repos/{owner}/{repo}/issues -f title="<title>" -f 'labels[]=route:review-cap' -f body="<body referencing the current Issue>"`.
  2. Run `pnpm josh epic:bundle <new>` — **before the current Issue closes.** The candidate search reads open issues only, so once the parent has closed the command answers `none` permanently and the relation can no longer be found (joshuafolkken/kit#947).
  3. Act on its answer. **`epic:bundle` recommends and writes nothing**, so acting means running the write command yourself — never a hand edit of the epic body, which leaves the task list and the `blocked-by` relations disagreeing and `epic:next` returning `error`.

  | Answer                                                                                                                                                                                                                                                                                                                                                                                                     | Do                                                                                                                                                                                                                                                                   | Tier                    |
  | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
  | `add_to_epic`                                                                                                                                                                                                                                                                                                                                                                                              | `pnpm josh epic --add <E> <new>` — add `--before <M>` / `--after <M>` when the relation carries an order                                                                                                                                                             | **A — no confirmation** |
  | `create_epic`                                                                                                                                                                                                                                                                                                                                                                                              | `pnpm josh epic "<title>" <new> <other> [--ordered]`                                                                                                                                                                                                                 | **A — no confirmation** |
  | `ask` — candidates spread across two or more epics                                                                                                                                                                                                                                                                                                                                                         | Stop and ask; merging epics is the one branch that is not reversible. **Inside an `epicrun`, park the child with `needs-decision` and continue** rather than stopping the batch, exactly as any other Tier B does there                                              | **B**                   |
  | `none`                                                                                                                                                                                                                                                                                                                                                                                                     | Nothing                                                                                                                                                                                                                                                              | —                       |
  | **The command could not answer** — non-zero exit, or **any** ⚠ warning above a `Nothing to bundle.` verdict: a truncated listing, or an issue whose relations could not be read. A recorded dependency is one of the two strong signals, so a failed relation read turns a real `add_to_epic` into `none`. A definitive answer (`Add it to the epic …`, `Already in an epic`) stands even beside a warning | Stop and report, naming what it said. **A `none` printed after such a warning is not "nothing to bundle"** — the search was incomplete, and reading it as an answer files the Issue into no epic on the exact path this rule exists to close (joshuafolkken/kit#950) | —                       |

  **`none` is a real answer, not a failure.** A standalone pre-commit review has no current Issue for the new one to reference, so no candidate exists and the Issue stays in the backlog for a person to place. What the step requires is that the command is run while the parent is still open and its answer acted on, never that an epic is found.

  Measured, not theorized: joshuafolkken/kit#943 was filed from a second review round with `親: joshuafolkken/kit#891` written in its body, and belonged to no epic. Its parent closed three minutes later. Where the step _was_ taken — joshuafolkken/kit#911, out of the same round cap — `epic:bundle` named the epic and the Issue was added to it. The only difference was whether the command was run (joshuafolkken/kit#946).

- **A confirmed High is never deferred.** The three-way disposition covers Low and Medium only: a real defect does not ship because a round counter ran out, so a standing High blocks the merge — it is never fixed-in-place, filed, or dropped as one of the three exits.
- **Blocking the merge is not the same as buying more rounds.** If a High is still standing after the second round, do not start a third — two rounds of fixing failed to close it, and a third is the review chasing its own tail. It says the change itself is not ready: stop, send a `confirmation` Telegram, and put the scope back to the user, where splitting the Issue is usually the answer.

The cap is deliberately mechanical rather than a judgement call, because judgement is what fails here: on #854 the third and fourth rounds were spent on findings that the Low rule already permitted skipping — a misplaced comment, an unused export, a stale comment — treated as blockers because the review returned them without severities.

---

## Review output format

Output every category below with an explicit verdict. Do **not** omit categories.

**This is the first round's format.** The second round is a verification pass and has its own, narrower one — see "The second round is a verification pass, not a second full review" above.

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

All nine are checked in the first round. **The second round checks category 1 plus the categories its fix delta actually touches** — the verification pass above, which is the only thing that narrows this list.

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

### 4. Project conventions (`CLAUDE.md`)

Verify **every** rule below. These are non-standard, so call out any violation.

- **Naming**: `snake_case` for variables / functions / params; `PascalCase` for types / classes / interfaces / enums; `UPPER_CASE` for enum members and constants; booleans prefixed `is_` / `has_` / `should_` / `can_` / `will_` / `did_`
- **Functions & exports**: `function` syntax (not arrow); multiple functions grouped into a namespace object `export { my_module }`; no `export default`
- **Files**: Svelte → `PascalCase.svelte` / `PascalCase.svelte.ts`; TypeScript → `kebab-case.ts` (route files exempt)
- **Quality limits**: function complexity ≤5, nesting ≤2, function ≤25 lines, file ≤300 lines, params ≤4, statements per function ≤10, cognitive complexity ≤4 — **the line counts are code lines, not physical lines**: `max-lines` and `max-lines-per-function` run with `skipBlankLines` and `skipComments`, so review against what `pnpm josh lint` reports rather than `wc -l`, and test files (`*.test.ts` / `*.spec.ts` / `*.e2e.ts`) allow 35 code lines per function instead of 25; magic numbers extracted to `UPPER_CASE` constants except `0`, `1`, `-1`; no `any`, no unused vars, no floating promises; explicit param and return types
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
2. If **any** high/medium findings exist → fix them in place and run the **second-round verification pass** — `/code-review` at the level `pnpm josh review:level` prints, scoped to the fix delta and asking whether each finding closed, not a second full read of the diff (see "The second round is a verification pass, not a second full review"). Nothing is committed yet, so a round costs no commit, push, or CI run. **Stop at two rounds** — after the second, route each remaining non-High finding through the three-way disposition (see "Review round cap"): fix it in place without starting a new review round, file it, or drop it with a one-line PR note. For a finding that is filed, run `pnpm josh epic:bundle <new>` on it **before this Issue closes** and act on its answer — `add_to_epic` / `create_epic` are Tier A, run the matching `pnpm josh epic` write command without asking; `ask` stops (or parks the child inside an `epicrun`); `none` is a no-op — then continue the pipeline; a standing High blocks the merge but does not authorize a third round. **Do NOT call `followup --merge` yet.**
3. If **no** high/medium findings exist (Low-only or completely clean) → your response MUST continue the pipeline in tool calls **after** the review markdown, in the same response: `pnpm josh bump minor`, then `pnpm josh git -y "<title> #<N>"`, then `pnpm josh followup "<title> #<N>" --merge --notify-message "..."`. **Do NOT end the turn with review markdown as the final assistant text.**

### Concrete failure pattern to self-recognize

If you are about to send a response whose final text is the `/code-review` Markdown — with sections, severity-tagged findings, and a recommendation line — and **no tool call follows**, that response is a chain-rule violation. Cancel it. Add the `pnpm josh bump minor` → `pnpm josh git -y` → `pnpm josh followup --merge` tool calls to the same response before sending.

This rule mirrors the chain-rule decision table in `.claude/skills/workflow-commands/chain-rule.md`, which is its single source. It is repeated here because the violation point is at the moment the review skill finishes producing markdown — the rule must be visible in the skill's own context, not just in the always-loaded project docs.
