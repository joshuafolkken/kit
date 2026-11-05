# Code Review Prompt

Review policy: the level, the round count, and what happens to a finding after the cap. Elsewhere:

- Rubric (severity tests, nine categories, output format, stop conditions): `prompts/review-rubric.md`,
  handed to `/code-review` by `pnpm josh review:brief`.
- Orchestration (gate before round 1, when the PR opens, the merge):
  `.claude/skills/workflow-commands/chain-rule.md` → "Orchestration facts single-sourced here".

---

## When to run

When: `CLAUDE.md` → "Pre-commit Self-Review"; in a workflow, as `run:chain` and `run:review` print.
The reviewer is a `reviewer` agent (round 2: `reviewer-verification`), never nested, on the model
`pnpm josh review:brief` prints.

Re-run after fixes until **no high or medium findings remain or the round cap below is reached** (the
first review counts).

---

## Before round 1 — the implementer's self-check

Answer these ten over your own diff before the scoped pair that precedes round 1 — question 1 once
`pnpm josh run:review --join` prints its lines after the review, or, under `--join --fixing` or a
check `--join` restarted on a moved tree, the ship's pre-detach — and fix what an
answer turns up. The review, its severity tests and the round cap are unchanged.

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
   due, answer the questions it prints under `q4 interaction review questions` too, then record
   them: `pnpm josh review:selfcheck --interaction-answered` (`scripts/review/selfcheck-cli.ts`).
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

Use the level `pnpm josh review:brief --level-only [--staged] [--json]` prints: `low` gets 1 round with Sonnet (Anthropic default), `medium` up to 2. Documentation, prompts and tests only get `low`; executable changes also get `low` at 20 added/deleted lines or fewer, including tests. Larger executable diffs, binary files and unreadable sizes stay `medium`. Model overrides still apply.

---

## Interaction review

`pnpm josh run:review` writes its brief to a file beside round 1's where it is due, printing both paths; one still owed after round 1
takes `pnpm josh review:brief --interaction`. Hand it to a reviewer subagent, dispose of the findings
by the three-way disposition below, and record the pass with
`pnpm josh review:record --from-slot --interaction --issue <N> [<n>=<disposition> ...]`.

`pnpm josh followup` refuses a due change with none recorded; `pnpm josh ship --review` runs it itself, beside round 1, and stops once on the findings of both.

## Review round cap (2 rounds)

Two rounds is the ceiling, not the schedule; whether round 2 is due is `pnpm josh review:round2`'s
answer (below). The interaction review is not one of the two.

A bare `review:brief` starts at full-change final round 2 when both declared size axes fit, no
High/Medium exists in the issue's history, and the gate is local; it records `round1: skipped-in-size`.
Missing or unreadable inputs keep round 1; explicit round flags win. Final disposition and the
independent interaction review still apply.

### A merge-conflict resolution review is not one of the two

When `pnpm josh followup` reports `PR checks failed (merge conflict)`, the child resolves the conflict
in its own lane and reviews the resolution — **that round does not count against the cap**. Procedure
and the four step-back conditions:
`.claude/skills/workflow-commands/backlogrun-recovery.md` → "Conflicts are not predicted".
`pnpm josh review:attest --check` must answer `ok` before the merge is re-issued; a confirmed High parks
the child rather than buying a further round.

### When round 2 is skipped entirely, and when it is not

```bash
pnpm josh review:round2 --record <N>   # → required | skip ; the reason on stderr
```

Ask once round 1's fixes are in and recorded (`pnpm josh review:record`'s usage), before the commit;
the reason line says why. The `required` cases and the two `skip` arms are defined in
`scripts/review/review-round2.ts` (`decide`, `is_unexecuted`); the skip comment `--record` posts, in
`scripts/review/review-round2-skip-comment.ts`.

### Three-way disposition after the cap

After round 2, place every remaining non-High finding in exactly one exit, decided by what the finding
is. **The default exit is branch 3; branch 2 has to be earned.**

1. **Fix it in place** — it closes in a few lines inside a file the diff already changed, with no
   design decision (a stale comment, a name, an unused export). A fix-in-place never starts a new
   review round; a finding that cannot close under both limits is not fixed in place.
2. **File it as an Issue** — a **confirmed defect that reaches a runtime code path**, both halves.
   Confirmed: the failure scenario is stated in concrete inputs and state. Reaching is the rubric's
   Severity test 1 (a runtime code path, a distributed artifact a consumer reads, or the verification
   that guards either); `pnpm josh disposition <path>` answers `runtime` / `non-runtime` from the
   finding's paths. A design question with no defect under it is branch 3.
3. **Drop it with a one-line note in the PR body** — everything the other two did not take: a Low that
   does not reach the user, a design preference, an unproven suspicion, "it might matter later". The
   note, naming the finding and why it was dropped, is required.

Two or more findings remain after branch 1 → `pnpm josh disposition --batch <file>` prints each one's branch and
the drop notes for the PR body (`docs/josh-commands-backlog.md` → `josh disposition`).

Findings that reduce to one root judgement are filed as one Issue with a section per symptom
(`## 現象 1` / `## 現象 2`).

Branch 2 only:

- File a follow-up Issue whose `parent: #N` line names the current one — a mention in its background
  is not read by `epic:bundle`; the current Issue completes.
- Filing continues to the epic: run these steps inside the CI wait — in `fullrun` / `backlogrun` after `pnpm josh git -y` and before
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
     `- セキュリティ:` line (`issue-template.md` → H).
  2. Act on the printed `epic:bundle` answer with `pnpm josh epic:bundle <new> --apply` — never a
     hand edit of the epic body. Tier A, no confirmation; what each answer does is
     `.claude/skills/epic-commands/SKILL.md` → "`josh epic:bundle <N>` — does this new issue belong
     with one already filed?". Non-zero exit, or any ⚠ warning above `Nothing to bundle.` → stop and
     report what it said; a `none` after such a warning is not "nothing to bundle".

**A confirmed High blocks regardless of round count** — never deferred, fixed-in-place, filed or dropped.
If one still stands after round 2, do not start a third: stop, send a `confirmation` Telegram, and put
the scope back to the user (usually: split the Issue).
