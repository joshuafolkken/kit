# Code Review Prompt

Review policy: the level, the round count, and what happens to a finding after the cap. Elsewhere:

- Rubric (severity tests, nine categories, output format, stop conditions): `prompts/review-rubric.md`,
  handed to `/code-review` by `pnpm josh review:brief`.
- Orchestration (gate beside the review, when the PR opens, the merge):
  `.claude/skills/workflow-commands/chain-rule.md` → "Orchestration facts single-sourced here".

---

## When to run

When: `CLAUDE.md` → "Pre-commit Self-Review"; inside a workflow, round 1 runs before the commit and
round 2 beside CI (`.claude/skills/workflow-commands/chain-rule.md`). Pass the review subagent the
`reviewer` profile's model and effort that `pnpm josh review:brief` prints; never substitute the review
level for effort.

Re-run after fixes until **no high or medium findings remain or the round cap below is reached** (the
first review counts), whichever comes first. Round 2 is a verification pass over the fixes
(`prompts/review-rubric.md` → "The second round is a verification pass, not a second full review").

---

## Before round 1 — the implementer's self-check

Answer these five over your own diff before the scoped pair that precedes round 1, and fix what an
answer turns up (about two in three of 135 sampled round-1 High/Medium findings fell under one). The
review, its severity tests and the round cap are unchanged.

1. **Tests pin the change** — for each condition, branch or call added or changed, name the test that
   turns red when it is deleted or inverted, and check its fixture reaches that branch (no assert on a
   string the code never draws, no comparison against a literal copy).
2. **Prose matches the code** — grep docs, prompts and comments for the old wording of every behavior,
   constant, command and heading you changed, moved or removed, `"the table above"` and rewritten
   sentences included.
3. **Failure is not a negative answer** — every timeout, non-zero exit or `gh` failure on a touched
   path returns something a caller can tell apart from `false`, `undefined` or "nothing found".
4. **Every caller moved with it** — grep every reference to a changed function, list or command, and
   update each sibling path (the other CLI, the registry, the consumer side) in the same change.
5. **The Issue is met on HEAD** — the premises you relied on hold on the current tree, and each
   acceptance criterion is checked against the diff.

The brief lists `Removed tests` → each needs a `## 消えたテストの処置` row in the PR body, or the
merge is refused: `prompts/collaboration-workflow/report-format.md` → "PR 本文の消えたテストの処置".

---

## Review level (decided by `pnpm josh review:brief --level-only`, never by judgement)

Run `pnpm josh review:brief --level-only` and use what it prints — `low` or `medium`, from the changed
paths only, never "this one is small". `--staged` classifies the staged diff, `--json` adds the reason;
inside a workflow `pnpm josh review:brief` prints the level on its first line. `low` gets 1 round,
`medium` up to 2. A diff that touches documentation is not inert: it stays at `medium`.

```bash
pnpm josh review:brief --level-only            # the branch diff
pnpm josh review:brief --level-only --staged   # the staged diff
```

**A confirmed High blocks regardless of round count**, whatever the cap.

---

## Review round cap (2 rounds)

Two rounds is the ceiling, not the schedule: every fix creates new surface a further round would find
something in. Whether round 2 is due is `pnpm josh review:round2`'s answer (below).

### A merge-conflict resolution review is not one of the two

When `pnpm josh followup` reports `PR checks failed (merge conflict)`, the child resolves the conflict
in its own lane and reviews the resolution — **that round does not count against the cap**, since it
reads what merging a moved `main` did, not the change. Procedure and the four step-back conditions:
`.claude/skills/workflow-commands/backlogrun-recovery.md` → "Conflicts are not predicted".
`pnpm josh review:attest --check` must answer `ok` before the merge is re-issued; a confirmed High parks
the child rather than buying a further round.

### When round 2 is skipped entirely, and when it is not

```bash
pnpm josh review:round2 --round-1-closed   # → required | skip ; the reason on stderr
```

Ask once round 1's fixes are in, before the commit. Pass `--round-1-closed` only when every round-1
High/Medium closed — fixed in this working tree or verified false positive — and none was filed or
deferred. Without the flag, and on any uncertainty (a missing round-1 snapshot included), the answer is
`required`.

`skip` has exactly two arms, and the reason line names which fired:

- **A** — the fix delta is empty.
- **B** — every path in the fix delta is inert by the review-level classification above:
  `docs/**/*.md`, the root `README.md`, under `prompts/`, or a `.ts` / `.js` / `.svelte` file outside
  `.claude/` changed only in comments (a lint, type-check, coverage or bundler directive comment counts
  as code).

One path outside that set makes it `required` — `.claude/**`, `CLAUDE.md`, a test, configuration, a
code line, or a source file whose comment-free text cannot be read.

Record a skipped round on the Issue with a comment under `## Round 2 skipped`, naming which arm fired
and quoting the command's reason line verbatim.

### Three-way disposition after the cap

After round 2, place every remaining non-High finding in exactly one exit, decided by what the finding
is. **The default exit is branch 3, and branch 2 has to be earned**. "It might matter later" is branch 3.

1. **Fix it in place** — it closes in a few lines inside a file the diff already changed, with no
   design decision (a stale comment, a name, an unused export). A fix-in-place never starts a new
   review round. A finding that cannot close under both limits is filed, not fixed in place.
2. **File it as an Issue** — a **confirmed defect that reaches a runtime code path** — both halves, and neither on its own.
   Confirmed: the failure scenario is stated in concrete inputs and state.
   **Reaching is read exactly as the rubric's Severity test 1 reads it** (a runtime code path, a
   distributed artifact a consumer reads, or the verification that guards either), so a defect in a
   distributed document is branch 2. `pnpm josh disposition <path>` answers `runtime` / `non-runtime`
   from the finding's paths (the review level's inert set). **"It needs a decision" is no longer a branch-2 condition on its own**:
   a design question with no defect under it takes branch 3.
3. **Drop it with a one-line note in the PR body** — **This is the default, and it takes everything the other two branches did not**:
   a Low that does not reach the user, a design preference, an unproven suspicion. **The note is not optional**:
   one line naming the finding and why it was dropped.

Findings that reduce to one root judgement are filed as one Issue with a section per symptom
(`## 現象 1` / `## 現象 2`).

Branch 2 only:

- File a follow-up Issue whose `parent: #N` line names the current one — a mention in its background
  is not read by `epic:bundle`; the current Issue completes.
- An Issue in no epic is never offered by `epic:next`, so filing continues to the epic. Run these steps
  inside the CI wait: in `fullrun` / `backlogrun` after `pnpm josh git -y` and before
  `pnpm josh followup`; in `halfrun` or a standalone pre-commit self-review as soon as the disposition
  is decided. They may run delegated — `pnpm josh delegate followup-filing`.
- A second follow-up from one round folds into the first by default
  (`.claude/skills/workflow-commands/split-assessment.md` → "The same two questions decide the
  filing-time fold"). `pnpm josh issue:file` asks the fold question on the run's second filing and holds
  a `fold`; the first filing asks nothing.

  1. Before the current Issue closes, file it tagged `route:review-cap`:
     `pnpm josh issue:file "<title>" --body-file <body-file> --route review-cap`. It lints
     the body, applies the declared labels, runs the duplicate scan and `epic:bundle`
     (`docs/josh-commands-backlog.md` → `josh issue:file`). `epic:bundle` reads open issues only, so
     after the parent closes it answers `none` permanently.
  2. Act on the printed `epic:bundle` answer with `pnpm josh epic:bundle <new> --apply` — never a
     hand edit of the epic body, which leaves the task list and `blocked-by` relations disagreeing
     (`epic:next` returns `error`). Tier A, no confirmation:
     - `add_to_epic` / `create_epic` → `--apply` writes it, with any recorded order.
     - `ask` (candidates across two or more epics) → `--apply` writes nothing; place it in the
       recommended epic with `pnpm josh epic --add <E> <new> --decision-file <path>`
       (`.claude/skills/epic-commands/epic-bundle.md`).
     - `none` → nothing.
     - Non-zero exit, or any ⚠ warning above `Nothing to bundle.` → stop and report what it said; a
       `none` after such a warning is not "nothing to bundle".

**A confirmed High is never deferred** — it blocks the merge, never fixed-in-place, filed or dropped.
If one still stands after round 2, do not start a third: stop, send a `confirmation` Telegram, and put
the scope back to the user (usually: split the Issue).
