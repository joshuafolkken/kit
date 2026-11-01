# Code Review Prompt

Review policy: the level, the round count, and what happens to a finding after the cap. Elsewhere:

- Rubric (severity tests, nine categories, output format, stop conditions): `prompts/review-rubric.md`,
  handed to `/code-review` by `pnpm josh review:brief`.
- Orchestration (gate beside the review, when the PR opens, the merge):
  `.claude/skills/workflow-commands/chain-rule.md` → "Orchestration facts single-sourced here".

---

## When to run

When: `CLAUDE.md` → "Pre-commit Self-Review"; in a workflow, round 1 runs before the commit, round 2
in `ship --review` (`.claude/skills/workflow-commands/chain-rule.md`). Launch a `reviewer` agent
type (round 2: `reviewer-verification`), never nested, with the model `pnpm josh review:brief` prints.
Reviewer's last step → `pnpm josh review:submit --review <absolute-path>` (`.claude/agents/reviewer.md`).

Re-run after fixes until **no high or medium findings remain or the round cap below is reached** (the
first review counts), whichever comes first. Round 2 is a verification pass over the fixes
(`prompts/review-rubric.md` → "The second round is a verification pass, not a second full review").

---

## Before round 1 — the implementer's self-check

Answer these ten over your own diff before the scoped pair that precedes round 1 — question 1 once
`pnpm josh run:review --join` prints its lines after the review, or, under `--join --fixing` or a
check `--join` restarted on a moved tree, the ship's pre-detach — and fix what an
answer turns up (about four in five of 100 sampled High/Medium findings that stopped lane reviews
fell under one; `pnpm josh lane:stats` counts the kinds that still stop). The review, its severity
tests and the round cap are unchanged.

1. **Tests pin the change** — read the `unpinned` and `unchecked` lines `pnpm josh run:review --join`
   prints from `pnpm josh test:pinned` (each unchecked place is listed in its `full output:` log) (`docs/josh-commands.md` → "`josh test:pinned`"), and check a pinning test's fixture reaches its branch (no assert on a string the code
   never draws, no comparison against a literal copy).
2. **Prose matches the code** — grep docs, prompts and comments for the old wording of every behavior,
   constant, command and heading you changed, moved or removed (`pnpm josh review:selfcheck` → `q2`),
   `"the table above"` and rewritten sentences included.
3. **Failure is not a negative answer** — every timeout, non-zero exit or `gh` failure on a touched
   path returns something a caller can tell apart from `false`, `undefined` or "nothing found".
4. **Every caller moved with it** — grep every reference to a changed function, list or command, and
   update each sibling path (the other CLI, the registry, the consumer side) in the same change.
   The readers outside the diff: `pnpm josh review:selfcheck` → `q4`; where the interaction review is
   due, answer the questions it prints under `q4 interaction review questions` too.
5. **The Issue is met on HEAD** — the premises you relied on hold on the current tree, and each
   acceptance criterion is checked against the diff.
6. **State is read fresh** — for every record, stamp, snapshot, memo or ledger a decision reads, name
   its writer and check it cannot be older than the decision (a past `success`, a tick's shared
   snapshot, a sync before the commit) or written by another run in between.
7. **The rule covers its whole input space** — list every kind of input a scan, pattern, matcher or
   lookup must accept or reject (the sibling file type, the consumer's config beside the root, quoted
   text, a subshell, a pipe, a heredoc) and pin one test row per kind.
8. **Edge inputs and environments** — say what the change does when its input is empty, absent or
   new, and outside a TTY, a lane or the default agent runtime.
9. **Claims about other components are checked in their code** — for every claim your code or a
   comment makes about another component's behavior (what a stage does, who enforces a limit, which
   repository it runs in), open that component's code and confirm it; then name each context the
   change runs in — kit and a consumer, and a predecessor that died midway leaving its record behind.
10. **Commands your prose tells a reader to run are run** — for every command a refusal, hint or
    document you added or changed tells a reader to run, run it as written from a cwd other than the
    root, with an absolute path, a relative path and an empty input (`pnpm josh review:selfcheck` →
    `q10`), and check each result — in a scratch copy (`mktemp -d`) when it writes, deletes, files or pushes, never on the lane's files.

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

## Interaction review

`pnpm josh run:review` writes its brief to a file beside round 1's where it is due, printing both paths; one still owed after round 1
takes `pnpm josh review:brief --interaction`. Hand it to a reviewer subagent, dispose of the findings
by the three-way disposition below, and record the pass with
`pnpm josh review:record --from-slot --interaction --issue <N> [<n>=<disposition> ...]`.

`pnpm josh followup` refuses a due change with none recorded; `pnpm josh ship --review` runs it itself, beside round 1, and stops once on the findings of both.

## Review round cap (2 rounds)

Two rounds is the ceiling, not the schedule: every fix creates new surface a further round would find
something in. Whether round 2 is due is `pnpm josh review:round2`'s answer (below). The interaction
review is not one of the two.

### A merge-conflict resolution review is not one of the two

When `pnpm josh followup` reports `PR checks failed (merge conflict)`, the child resolves the conflict
in its own lane and reviews the resolution — **that round does not count against the cap**, since it
reads what merging a moved `main` did, not the change. Procedure and the four step-back conditions:
`.claude/skills/workflow-commands/backlogrun-recovery.md` → "Conflicts are not predicted".
`pnpm josh review:attest --check` must answer `ok` before the merge is re-issued; a confirmed High parks
the child rather than buying a further round.

### When round 2 is skipped entirely, and when it is not

```bash
pnpm josh review:round2 --record <N>   # → required | skip ; the reason on stderr
```

Ask once round 1's fixes are in and the round is recorded with each finding's disposition
(`pnpm josh review:record`'s usage), before the commit. Round 1 is closed only when the ledger shows
every round-1 High/Medium as `fixed` or `false-positive`. Anything else, including a missing round-1
snapshot, answers `required`.

`skip` has exactly two arms, and the reason line names which fired:

- **A** — the fix delta is empty.
- **B** — every path in the fix delta is inert by the review-level classification above:
  `docs/**/*.md`, the root `README.md`, under `prompts/`, a metrics approval under
  `.josh/metrics-accepted/`, or a `.ts` / `.js` / `.svelte` file outside
  `.claude/` changed only in comments (a lint, type-check, coverage or bundler directive comment counts
  as code).

One path outside that set makes it `required` — `.claude/**`, `CLAUDE.md`, a test, configuration, a
code line, or a source file whose comment-free text cannot be read.

`--record <N>` records a skipped round on the Issue itself: a comment under `## Round 2 skipped`
naming which arm fired and quoting the reason line verbatim, written once however often it is asked.

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

Two or more findings remain after branch 1 → `pnpm josh disposition --batch <file>` prints each one's branch and
the drop notes for the PR body (`docs/josh-commands-backlog.md` → `josh disposition`).

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

  1. Before the current Issue closes, run the `issue:file` line `disposition --batch <file> --found-during <N>`
     printed, its drafted body read first (no batch: write the body, same line):
     `pnpm josh issue:file "<title>" --body-file <body-file> --route review-cap --label run:lane --found-during <N>`
     (`--found-during` leaves the deferral note on the current Issue the ship reviewer reads). It lints
     the body, applies the declared labels, runs the duplicate scan and `epic:bundle`
     (`docs/josh-commands-backlog.md` → `josh issue:file`). A security finding declares its
     `- セキュリティ:` line (`issue-template.md` → H). `epic:bundle` reads open issues only, so
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
