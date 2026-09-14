# `/code-review` → `followup` chain rule (MANDATORY)

Within `fullrun` / `fullrun new` / `backlogrun`, the `/code-review` output is **not** a turn boundary. It
is a polished Markdown review with severity-tagged findings and a final recommendation — an
intermediate step, not a finished deliverable.

**The review is spawned in a subagent, and the main line never loads the skill.** Run `/code-review`
through the `Agent` tool — a subagent that loads the skill in its own context, reviews the same diff at
the same level for the same rounds, and returns the findings — never through the `Skill` tool in the
main line, whose mid-run load rewrites the whole cached prompt prefix ("The review runs in a subagent,
never a main-line skill load", under "Orchestration facts single-sourced here" below). So everywhere below reads "the `/code-review`
output" as the findings that subagent returns.

**`fullrun` STOPPING CONDITIONS** (the chain ends only here):

1. **PR is merged, the `completion` Telegram has been sent, AND `pnpm josh ms` has returned the working
   tree to the default branch** — normal end state, report the PR URL and stop. **In a lane, `josh ms`
   refuses and that refusal is the answer**: a linked work tree cannot check the default branch out
   without taking it from another one, so the run ends at the merge and the lane is handed back for
   `pnpm josh lane:close <N>`.
2. **A genuine blocker requires user judgment** — exactly two count:
   - A CodeRabbit / Claude Review substantive finding that cannot be auto-verified as a false positive.
   - A CI failure that requires user input to resolve.

   **The managed config-file gate is no longer one of them.** `pnpm josh followup` now **reports** the
   claimed paths and the list that claimed each one, in the completion notification and in the
   completion report on the Issue, and merges.

   When a blocker fires, send a `confirmation` Telegram **before** stopping.

**Everything else — including `/code-review` producing a polished "Approve for merge" recommendation —
is NOT a stopping condition.** Continue straight through `pnpm josh gate` (only where the tree was
edited after the first gate started — a red check's fix or a round-1 finding's fix; with nothing
edited, join that one gate and go on) → `pnpm josh git -y "<title> #<N>"` → the follow-up filing and
`pnpm josh epic:bundle` → `pnpm josh followup` in the same turn. **The filing sits after the pull
request is open on purpose**, so it runs inside the CI wait (`prompts/review.md` → "Review round cap").
**The second review round sits in that same window** — after `pnpm josh git -y`, before `pnpm josh
followup` — which is why the commit comes before it. A clean first round has no second one.

**`pnpm josh git -y` is issued in the background, and the turn does not end when it is**
(`background-commands.md`). Its completion notification is what resumes the tail. `pnpm josh rule:guard`
refuses the foreground spelling.

**A dispatched lane child does end its turn once — before the gate, never at the push.** That pre-gate
cut relaunches a fresh process, which then runs the gate, the review, the commit and the merge without
ending. The boundary and its verdicts are `pre-gate-cut.md`.

**Join the gate before `pnpm josh git -y` — every row of the table below runs after that, not instead
of it.** `pnpm josh gate` is started alongside the review (`SKILL.md` → the verification gate), so when
the review settles the checks may still be running: read what the gate printed before continuing. **A
red gate is fixed and re-run whatever the review concluded.** **There is no row here that reaches a
commit on a gate nobody read.** Where anything was edited after that gate started, the join is followed
by a second `pnpm josh gate` over that edited tree, joined before `pnpm josh git -y`. **No version bump
goes in between**: a child's branch carries no `package.json` version change at all, because
`pnpm josh release` decides the version from main's own history.

**Decision table** (map `/code-review` result → next action mechanically):

| `/code-review` result                        | Findings severity  | Next action (same turn, no user input)                                                                                                                                                |
| --------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clean — every category says `No issues`, **and this was the first round** | None               | Immediately continue: `pnpm josh git -y "<title> #<N>"` → `pnpm josh followup "<title> #<N>" --notify-message "..."`. **No second round is due**, and with nothing edited since the gate started, no second gate either |
| Nothing to fix in place — **and this was the second round** | Any, so long as no finding took branch 1 | **Issue the merge in this same turn.** The pull request is already open: run any branch-2 filing and `pnpm josh epic:bundle` first, then `pnpm josh followup "<title> #<N>" --notify-message "..."` — never a turn of its own between reading the round and issuing the merge. **A Low-only second round is this row** |
| Low findings only, **and this was the first round** | Low                | Immediately continue: `git -y` → the follow-up filing and `epic:bundle` for any Low routed to branch 2 → `followup` (a Low that does not reach the user may be skipped with a one-line reason; one that does goes to a fix-in-place or an Issue) |
| A finding routed to branch 1 — **and this was the second round** | Any                | Fix it in place — **there is no third round** — then the push-first order: the single check the fix reaches → `pnpm josh git -y "<title> #<N>"` again, a follow-up commit → `pnpm josh gate` beside the CI it starts, **joined before `pnpm josh followup`**. The remaining findings take branch 2 or branch 3 |
| One or more High / Medium findings, **and this was the first round** | High and/or Medium | Fix in place, then **ask `pnpm josh review:round2 --round-1-closed` whether a second round is due — once those fixes are in and before the commit** (`prompts/review.md` → "When round 2 is skipped entirely, and when it is not"). On `skip`: continue `pnpm josh gate` → join → `pnpm josh git -y "<title> #<N>"` → record the skip on the Issue beside any branch-2 filing and `pnpm josh epic:bundle` → `pnpm josh followup`. **That gate re-run is not optional here** — round 1 edited the tree. On `required`, run the **second-round verification pass** — a subagent running `/code-review` with the brief `pnpm josh review:brief --round 2` prints, asking whether each first-round finding closed (`prompts/review-rubric.md` → "The second round is a verification pass, not a second full review") — **at most two reviews in total**. Open the PR first (`pnpm josh gate` → join → `pnpm josh git -y`), and run that pass beside the CI it starts. A finding the pass fixes in place is pushed before its gate. Do NOT report narratively and wait. |
| **The review could not attest its checkout** — `pnpm josh review:attest --check` answered `missing` or `mismatch` | n/a | **Not a review at all.** `/code-review` is forked into the session's checkout, so during a lane run it can read a tree holding the previous child's already-merged code. Re-run a subagent running `/code-review` with the brief `pnpm josh review:brief` prints, against the checkout that brief names, and do not count the round until `--check` answers `ok`. **A clean verdict from an unattested review is discarded**, and `pnpm josh followup` refuses the merge on its own if it is |
| `/code-review` itself errors / can't run     | n/a                | Report the error and stop with a `confirmation` Telegram (CI-level blocker)                                                                                                           |

The recommendation line at the bottom of `/code-review` is informational, not authoritative.
**Severity of findings drives the decision, not the recommendation sentence.**

**Anti-pattern catalog** — if you are about to emit text that resembles any of the following, you are
violating the chain rule. Cancel the message; continue through `pnpm josh gate` where round 1 produced
fixes → `pnpm josh git -y "<title> #<N>"` → the follow-up filing and `pnpm josh epic:bundle` → `pnpm
josh followup` instead, running the second review round beside the CI the commit started where one is
due.

- "The `/code-review` is clean — ready to merge. Shall I proceed with `followup`?"
- "`/code-review` found no high/medium findings. Approve for merge after you confirm."
- "Recommendation: Approve for merge. Let me know if you'd like me to continue."
- "All green. Awaiting your go-ahead to merge."
- "The review is complete. Should I run `pnpm josh followup` now?"
- Posting the `/code-review` Markdown output and then stopping the turn without a tool call.
- "Pushed — PR #<N> is open and CI is running. I will merge once it goes green." **Ending the turn at
  the push is the same violation as ending it at the review.** `pnpm josh git -y` is issued in the
  background (`background-commands.md`), its completion notification is what resumes the run, and the
  turn that reads it continues through any branch-2 filing and `pnpm josh epic:bundle` to `pnpm josh
  followup`.
- Listing low-severity findings narratively and asking whether they should block merge (Low findings
  are auto-skipped with a one-line reason; do not escalate).
- Treating CodeRabbit rate-limit warnings as findings (they are not — proceed).

All of these share one shape: presenting `/code-review` output to the user and waiting. **The user
invoked `fullrun`; merging is part of that invocation. The chain ends at a stopping condition above,
never at `/code-review` output.** This rule applies regardless of model (Claude / Gemini / Cursor) or
account.

**Turn-end self-check (fullrun-conditional) — run BEFORE sending any response that contains
`/code-review` output.** Run this check, in order, before sending:

0. **Target check — `pnpm josh review:attest --check`.** Ask it before you count the round at all.
   `missing` or `mismatch` means this was not a review of your change: discard the verdict, re-run a
   subagent running `/code-review` with the brief `pnpm josh review:brief` prints, and do not advance
   the round counter. **A clean verdict is exactly the shape this failure takes**, so a clean round is
   the case to check hardest.
1. **Mode check** — Is this `/code-review` part of a `fullrun` / `fullrun new` / `backlogrun` invocation?
   Decide by both signals: (a) the user's recent prompt contained one of those commands, AND (b) the
   implementation is finished and the verification gate has reached its review step. **A `halfrun`
   invocation never satisfies (a)** — it ends at the confirmation stop without committing. If either
   signal is false → **standalone mode**: stop after the review markdown and do NOT call `followup`.
2. **Severity check** — Count high/medium findings, using the two tests in `prompts/review-rubric.md` →
   "Severity". If ≥1 → fix in place, then ask **`pnpm josh review:round2 --round-1-closed`** whether the
   round is due, once those fixes are in and before the commit. `skip` means the round is not due and
   the run continues to the merge through `pnpm josh gate` → join → `git -y`, the gate re-running
   because round 1 edited the tree, and records the skip on the Issue inside the CI wait; the flag is
   passable only where every High/Medium of round 1 closed. On `required`, run the second-round
   verification pass (brief `pnpm josh review:brief --round 2`) after `pnpm josh git -y`, beside the CI
   the commit started; a follow-up fix is pushed before its own gate. Do NOT call `followup` yet.
   **Stop at two rounds:** after the second, route each remaining non-High finding through the three-way
   disposition — fix it in place without starting a new review round, file it referencing this one, or
   drop it with a one-line PR note; for a filed finding, run `pnpm josh epic:bundle <new>` before this
   Issue closes and act on its answer (`add_to_epic` / `create_epic` / `ask` are Tier A; `none` is a
   no-op). Do the filing and the bundle after `pnpm josh git -y` and before `pnpm josh followup`, inside
   the CI wait. A confirmed High still standing after the second round blocks — send a `confirmation`
   Telegram and put the scope back to the user instead of starting a third round.
3. **Append check** — If you are in fullrun mode AND there are 0 high/medium findings (Low-only or
   fully clean), the same response that contains the `/code-review` markdown MUST also continue the
   pipeline in tool calls, from wherever the run already is: where the PR is not open yet `pnpm josh
   gate` joined, then `pnpm josh git -y`; where it is already open (round 2 beside its CI) any
   fix-in-place is a follow-up commit — its single check, then `pnpm josh git -y`, then `pnpm josh gate`
   joined before the merge. Then, either way, the follow-up filing and `pnpm josh epic:bundle` if the
   cap routed anything to branch 2, then `pnpm josh followup "<title> #<N>" --notify-message "..."`.
   **A response whose final assistant text is `/code-review` Markdown with no follow-on tool call is a
   violation.** Cancel and append the tool call.

The check fires at the moment your response would end with review markdown and no follow-on tool call.
**The self-check is mirrored at the end of the `/code-review` skill prompt (`prompts/review.md`)**, so
it is visible inside the skill's own execution context.

**Tooling enforcement (investigated, not implemented).** A `pnpm josh review --auto-followup` CLI
wrapper is not feasible: `/code-review` is an interactive AI skill that returns Markdown for the agent
to interpret, so a shell command cannot host the skill, parse its severity verdicts, or decide "no
high/medium" on the agent's behalf. The strongest available enforcement is the decision table, the
anti-pattern catalog and the turn-end self-check above.

## Orchestration facts single-sourced here

These are the gate → review → PR → merge facts other documents cite. This file is their single source
(joshuafolkken/kit#1927 moved them out of `prompts/review.md`, which now carries only the review
_policy_ — level, round cap, disposition — and `prompts/review-rubric.md` the rubric). Each is stated
once here; the measurements that motivated each one live in the linked Issues.

- **The gate runs beside this review, not in front of it** — `pnpm josh gate` is started when the review
  starts and joined before the commit; the two read the same tree and neither writes to it, so running
  them serially is pure waiting. A red gate is fixed and re-run whatever the review concluded, and there
  is no path to a commit on a gate nobody read (joshuafolkken/kit#1242).
- **origin/main is merged in before the gate** — `pnpm josh main:merge` merges `origin/<default>` into
  the branch before the gate and the review start, so the gate verifies the tree that will actually
  merge rather than one that never existed (joshuafolkken/kit#1837). It is the last edit, so the scoped
  pair and the gate run once over it. A conflict here fires `backlogrun.md` → "Conflicts are not predicted"
  early.
- **A single check answers once per tree** — while implementing, re-run a single check by name
  (`pnpm josh lint:related`, `pnpm josh cspell:dot`, `pnpm josh test:related`, or the project's type
  check) after every edit; a repeat of the same command with the same arguments over a tree nothing has
  touched since buys only a copy of the answer already in hand (joshuafolkken/kit#1383).
- **The pull request opens between the rounds, so CI runs beside round 2** — `pnpm josh git -y` sits
  between the two review rounds. Round 1 runs on the uncommitted tree and its High/Medium findings are
  fixed before anything is committed; the verification pass over those fixes then runs against the open
  pull request, beside the CI the commit started (joshuafolkken/kit#1261).
- **The round-2 fix commit is pushed before its gate** — a fix the second round makes in place is
  pushed (`pnpm josh git -y` again, a follow-up commit) before its `pnpm josh gate`, so the gate runs
  inside the CI wait and is joined before `pnpm josh followup` rather than in front of it
  (joshuafolkken/kit#1326). The commit and pre-push hooks and CI's `Checks` job mean pushing first is
  not pushing unverified code.
- **A clean second round issues the merge in the same turn** — the turn that reads a clean second round
  issues `pnpm josh followup`, after any branch-2 filing and `pnpm josh epic:bundle` and never in a turn
  of its own. Clean has two halves: no confirmed High is standing, and nothing was routed to branch 1 of
  the disposition (joshuafolkken/kit#1333).
- **The review runs in a subagent, never a main-line skill load** — `/code-review` is spawned through
  the `Agent` tool in its own context; a mid-run `Skill` load rewrites the whole cached prompt prefix,
  which is what makes it expensive (joshuafolkken/kit#1855).
- **The brief names the checkout, and a review that read another one is refused** — `pnpm josh
  review:brief` prints the checkout root, branch and HEAD and a nonce; the review runs `pnpm josh
  review:attest <nonce>` from the tree it read, and `pnpm josh review:attest --check` must answer `ok`
  before the run or `pnpm josh followup` acts on the verdict, or it is discarded (joshuafolkken/kit#1522).

This file is the single source of the gate → review → PR → merge chain rule; other documents reference
it rather than restating it. `prompts/collaboration-workflow/plan-comment.md` keeps Step 3.
