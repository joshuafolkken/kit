# `queue` — Sequential multi-issue fullrun

Each issue in the queue is a full `fullrun`, so read `fullrun.md` and `chain-rule.md` as well; this
file only adds what running several of them back to back changes. **`followup.md` is not one of
them** — it is read in full in the turn that issues `pnpm josh followup`, per `SKILL.md` → §1,
"Three documents are read at the point of use".


`queue #N1 #N2 #N3 ...` runs `fullrun` for each issue in order. All issues must already exist (no `new` variant).

**The target repository is named in front of each Issue reference** — `queue kit#1 kit#2`. The definition is the same at every entry point: `SKILL.md` → "2c. The `owner/repo#` prefix". **One queue runs against one repository**: every reference must resolve to the same target, because step 1 below runs `josh latest` once for the whole queue and a mixed queue would run it in only one of them. Split a mixed batch into one queue per repository. The checkout rule is the one every implementing entry follows — resolve it from `pnpm josh doctor`, and stop and report rather than cloning. Step 1's `git stash` covers this session's own tree, and a prefix naming this repository changes nothing; a *different* repository's checkout that is not clean stops the run instead, since that work is not yours to stash. A target whose owner is not this session's is third-party: Tier C, so it stops rather than filing.

**Steps:**

1. If the working tree already has staged or modified files, stash them first: `git stash`. Run `git switch main && git pull`, then `pnpm josh latest:scope` once (before the first issue); on `required`, run `josh latest` and verify the overrides are unchanged in both `pnpm-workspace.yaml` and `package.json` and `devEngines` changed only by the expected `josh latest` pnpm bump, by loading the `dependency-update` skill and following its procedure. On `skip` neither runs. **The answer is the command's, never a judgement** — `latest-gate.md` is the single source. If you stashed changes, restore them: `git stash pop`. **Then start the progress step, once for the whole batch and never once per issue** — `pnpm josh run:progress --wait` in the background, what it printed presented in labelled form when it exits, the next one started in that same turn, and `pnpm josh run:progress --mark` in the same turn as every real report; the units that run the issues start none of their own, and step 2b's brief says so (joshuafolkken/kit#1546). `epicrun.md` → "Progress while the run is quiet" is the single source and is not repeated here. **Declare the budget in that same turn, unless the references carry a `owner/repo#` prefix** — `pnpm josh run:carry --begin "<the invocation as it was typed>" --owner "$PPID"`, then `pnpm josh run:wake --start` — so the queue survives its own session cuts. A prefixed queue declares none and writes no `run:carry` call at all; the answers, that exception and what a resumed session does are all "The session boundary" below.
2. For each issue `#<N>` in the supplied order — **in a resumed session that is the `remaining` list `pnpm josh run:carry --json` answers, not the whole prompt**, since the prompt names the opening list and the issues already in `done` have merged ("The session boundary"):
   a. From the 2nd issue onward: run `pnpm josh ms` to incorporate the previous PR's merge. **When the previous issue ran in a delegated unit this step is not defensive — it is the only thing that brings that merge into the checkout the queue implements in** (this session's own, or the target repository's when the references carry a prefix — run it there), and without it the next issue starts on a stale default branch. Where the issue ran in this session's own context it stays what it always was: a `fullrun` always ends on the default branch, so the step also covers an iteration interrupted before its own `pnpm josh ms` ran.
   b. Execute the full `fullrun #<N>` flow **in a delegated unit where one is available** ("Each issue runs in a delegated unit" below), **and in this session's own context where none is**, **except that `josh latest` is not run and no progress watcher is started** — step 1 runs both once for the whole queue, and a unit following `fullrun.md` to the letter would bump dependencies again into every PR after the first and start a watcher whose lines land in the unit rather than in the session the person is watching, so the brief must say so: normalize title → add `in-progress` label → post plan if body is blank → implement → run the verification gate (refactor → `pnpm josh gate` (lint, type check, spell check and unit tests, run concurrently) → `/code-review` with the brief `pnpm josh review:brief` prints (the level, what the gate has already proved on this exact tree, and the target) on `git diff main`, iterating until no high/medium findings remain — **at most two reviews in total** (`prompts/review.md` → "Review round cap"), **of which only the first runs here: the second runs after the commit, beside the CI it starts** (joshuafolkken/kit#1261) → `pnpm josh eval:scope`, and `pnpm josh eval` when it answers `required` (`eval-gate.md`)) → `pnpm josh gate` again and its join **where the tree was edited after the first gate started** (that edit is what made the first result stale; nothing follows the join before the commit, so round 2's brief still reads `Already verified`) → `pnpm josh git -y "<title> #<N>"` → the follow-up filing and `pnpm josh epic:bundle` for whatever the round cap routed to branch 2, placed here so it runs inside the CI wait (`prompts/review.md` → "Review round cap") → `pnpm josh followup "<title> #<N>" --notify-message "Implemented <title>\nCause: ...\nFix: ...\nResult: ...\n\nDetails:\n- ..."` (sends per-issue completion notification and merges, exactly as `fullrun` does) → `pnpm josh ms` (return to the default branch). **The second review round runs between `pnpm josh git -y` and `pnpm josh followup`**, beside the CI that commit started — the same window the follow-up filing sits in, and **before it**, since the round is what decides which findings the cap routes to branch 2 and there would otherwise be nothing to file. **It is due only where round 1 found High/Medium**, exactly as the round cap has always had it: a clean first round has no second one, no second gate, and this whole paragraph does not apply. **A finding it fixes in place is pushed before its gate** (joshuafolkken/kit#1326): the single check the fix reaches → `pnpm josh git -y "<title> #<N>"` again, a follow-up commit on the same branch → `pnpm josh gate` started beside the CI that commit re-runs and **joined before `pnpm josh followup`**, which is what the merge then waits for (`prompts/review.md` → "The pull request opens between the rounds, so CI runs beside round 2" and → "The round-2 fix commit is pushed before its gate"). **A clean second round is not a turn boundary either**: the turn that reads it issues `pnpm josh followup`, after any branch-2 filing and `pnpm josh epic:bundle` and never in a turn of its own (`prompts/review.md` → "A clean second round issues the merge in the same turn", joshuafolkken/kit#1333).
   c. On failure: send a `failure` Telegram notification via `pnpm josh notify --task-type failure --issue-url "<issue-url>" --body="<reason>"` and **stop immediately** (do not proceed to the next issue).
3. No extra batch summary notification — each issue's `pnpm josh followup` already sends the per-issue completion notification as usual. **Run `pnpm josh ms` once more here when the final issue ran in a delegated unit**, in that same checkout — step 2a only covers the issues that have a successor, so without it the last merge is never pulled in. `queue` always ends on the default branch, with every merge it produced pulled in. **End the budget in that same turn — only where step 1 declared one** — `pnpm josh run:carry --end` and `pnpm josh run:wake --stop` — so the supervisor stops and no record is left standing for the next invocation to be refused against. **A queue that declared none runs neither**: `--end` deletes whatever record stands without asking whose it is, so a queue with no budget of its own would destroy someone else's ("The session boundary").

**The working-tree hold is claimed per child, never per batch.** This command does not call `pnpm josh run:hold` itself: each child runs the `fullrun` procedure, so it claims the tree on entry and `pnpm josh followup` releases it at that child's merge — the tree stays free for the next child and held against anything else for the whole time a child is in flight. `SKILL.md` → §2f is the single source.

## Each issue runs in a delegated unit

**A queued issue is not run in the parent loop's context** (joshuafolkken/kit#1149). One issue goes
to an isolated execution unit and only its summary comes back, so the third issue of a queue no
longer carries the first two issues' implementation history. What a request costs is its context
length, so a batch that accumulates pays for every earlier issue on every later turn — the same
measurement that put an epic's children in a unit puts a queue's issues there.

**It is the same unit, not a second one.** `epic-child` is one child of a batch whichever keyword
started it, so there is nothing here to define — ask the one command:

```bash
pnpm josh delegate epic-child   # → delegate
```

How the unit is handed its work, what it returns, and how a failure surfaces are defined once, in
`SKILL.md` → "2b. Delegating a step to a cheaper tier" — the single source of the delegation rule.
`epicrun.md` → "Each child runs in a delegated unit" is that definition applied to one child of a
batch, and every paragraph of it applies to a queued issue
unchanged — the brief naming the invocation the run descends from (`queue #N1 #N2 …`,
this issue's number, and that it is to be run as `fullrun #<N>` under that authorization), the merge
authorization typing `queue` gave reaching the unit, and the fallback where no isolated unit exists.

**The parent reads GitHub, never the summary.** That is `epic-child`'s verifier, and a queue discards
it exactly as an epic would. When the unit reports back, read the issue's state before starting the
next one:

```bash
pnpm josh issue:state <N>                      # an issue in this repository
pnpm josh issue:state <N> --repo <owner/repo>  # an issue in another one
```

**`--repo` is not optional for a cross-repository issue.** `queue kit#1 kit#2` names the target in
front of every reference (§2c), while this read resolves a bare `<N>` against the repository this
session runs in — and confirms a completely different issue that happens to carry that number,
silently, because that issue usually exists.

**How the four answers are classified is `epicrun.md` → the loop's step 2; read it there.** Two of
its rules are repeated here as triggers rather than left behind the pointer, because getting either
one wrong is silent: **read the `human_review:` line rather than eye-matching the `labels:` one**
(GitHub keeps the spelling a label was created with, so `Needs-Human-Review` is the same label —
joshuafolkken/kit#1132), and **a non-zero exit is not `OPEN`** (a rate limit or expired auth says
nothing about the issue; re-read before deciding). Everything else about the four answers — the
reasoning, the worked failures — stays at the pointer.

What a queue does with each answer is the only part that differs, because a queue has no park:

- **`state: CLOSED`** — the issue finished. Continue with the next one.
- **Open, and `human_review: yes`** — the specification stop (key rules below). The queue ends here,
  `in-progress` stays on, and the uncommitted work stays in the tree the unit left it in. **The
  resume command that stop carries is the rest of the queue** — `queue #<N> #<next> …` from the
  issue that stopped — never `fullrun #<N>` alone, which would drop every issue after it. **Do not
  send a second `confirmation` Telegram** — the unit that ran the issue already sent one for this
  stop, and `CLAUDE.md`'s rule is one per stop, not one per context that notices it. Where the issue
  ran in this session's own context, that first notification is yours to send.
- **Open, carrying `needs-decision`** — the unit stopped for a decision and has already sent its
  `confirmation`. A queue cannot park it and go on, so the queue ends here too, and no `failure`
  Telegram is sent over a stop that was already notified. **Where the issue ran in this session's own
  context that `confirmation` is yours to send** — one is owed per stop, and nobody else sent it.
- **Open, and neither** — it failed. **Remove the stale `in-progress` here** (Tier A, per
  "`in-progress` is removed by whoever finds it stale"): the unit that applied it is gone, this
  session is the only context left that can, and a label left behind makes `epic:next` answer `wait`
  for the whole repository. Then step 2c: the `failure` Telegram, and stop.

  ```bash
  gh api -X DELETE repos/<owner>/<repo>/issues/<N>/labels/in-progress
  ```

  **Run it only where the `issue:state` read above listed `in-progress` — matched
  case-insensitively.** This branch is selected by `state: OPEN` and the absence of the two stop
  labels, which says nothing whatever about that one: a unit that died before the label step never
  applied it, and `fullrun`'s prerequisite stop removes it itself before stopping. Where the read did
  not list it there is nothing to remove — say so and go straight to step 2c. The read has already
  printed the labels, so this costs no extra call.

  **The case-insensitive comparison is not a nicety.** GitHub keeps the spelling a label was created
  with, so a repository whose label is `In-Progress` prints that string and an exact match reads it
  as absent — the delete is skipped, the stale label stays, and `epic:next` answers `wait` for the
  whole repository with nobody told, which is the failure this branch exists to prevent. It is the
  same hazard joshuafolkken/kit#1132 answered by having the `human_review:` line read rather than the
  `labels:` one eye-matched; `issue:state` computes no such line for `in-progress`, so the comparison
  is stated here instead of being left to the eye.

  **The repository is written out, exactly as `--repo` is on the read above**
  (joshuafolkken/kit#1160). `<owner>/<repo>` is the queue's target — the same repository `--repo`
  names on that read, and this one where a bare `queue #1 #2` was typed. `{owner}/{repo}` is not
  that: `gh` expands it from the checkout the command runs in, and this loop runs in the session's
  own repository whatever repository the queue targets — so on `queue kit#1 kit#2` from anywhere else
  the delete lands on the session's repository, which is the mis-resolution the `--repo` note above
  already warns about. **In this loop a read and a write about the same issue cannot name two
  different repositories.** That claim is about this loop, not about every
  `-X DELETE …/labels/in-progress` in these files: `fullrun.md` and `halfrun.md` remove the label
  from inside the target repository's own checkout, where `{owner}/{repo}` resolves to exactly that
  repository, and `epicrun.md`'s copies are left as they are pending the separate confirmation
  joshuafolkken/kit#1160 asks for.

  **The failure is then not discarded, which is why there is no `2>/dev/null || true`.** The label is
  known to be on the issue by the time the command runs, so "the label was not there" is not a case
  it can meet, and what `|| true` would absorb instead is every way the delete genuinely fails — a
  404 from a repository this issue does not live in, expired auth, a rate limit — each of which
  leaves the label on and makes `epic:next` answer `wait` for that whole repository with nobody told.
  **A non-zero exit here goes into the `failure` Telegram step 2c already sends**, naming the issue
  and that the label is still on it; it needs no stop of its own, because this branch is already
  stopping. Never report the label cleared on a command whose output nobody read.

Never advance the queue on the summary alone.

**Key rules:**

- **An issue carrying `needs-human-review` ends the queue before its commit.** Implement it and take
  it through the verification gate as usual — **`pnpm josh test:e2e` included, run by you, since no
  pull request means no CI E2E job** — then commit nothing, leave the working tree uncommitted
  and unstashed, send a `confirmation` Telegram carrying the resume command, and stop — the issues
  after it are not started. That is the specification rather than a failure, so it is a
  `confirmation` and not the `failure` notification step 2c sends. Definition: `SKILL.md` → §2z,
  which is the single source.
- Invoking `queue` is explicit authorization to merge each PR (same as `fullrun`).
- `josh latest` runs only once, before the first issue — and only when `pnpm josh latest:scope` answers `required` there, which is what makes the same hoist hold for a standalone `fullrun` too (`latest-gate.md`). If files were pre-staged when `queue` was invoked, they must be stashed before `josh latest` and restored after.
- All `kickoff`/`fullrun` mid-workflow stop rules (confirmation notification, AI review blocker handling, etc.) apply within each issue's execution.

## The session boundary

**A queue accumulates in one session exactly as an epic does**, so the hand-off binds here too
(joshuafolkken/kit#1567). Ask `pnpm josh cost --over 300000` after every issue's merge and
`pnpm josh ms` — the same seam, one issue later. **300,000 is a temporary experiment rather than a
settled number** (joshuafolkken/kit#1775) — the figure it replaces, the retreat and its review point
are all in `epicrun.md` → "The hand-off", the same single source this seam already cites.

**On `over` the cut happens and the run carries on** (joshuafolkken/kit#1774). Typing `queue` once
authorizes the whole declared list, and a cut is an execution detail of spending it — `SKILL.md` → §0
is the single source of that reading, and the mechanism is `backlogrun`'s, used here rather than
copied: `pnpm josh run:carry` holds the budget in a record beside the git directory, and
`pnpm josh run:wake` starts the successor. Neither has a `queue` variant, and writing one would be
the clone `CLAUDE.md` prohibits.

**A queue's invocation is pinned to the list that was typed, and that is the whole of what differs
here.** The obvious resumption — beginning again as `queue #<remaining>` — is the one that does not
work: `run:carry` compares the invocation character for character, so a shrinking string answers
`mismatch` and the run stops, and loosening that comparison would give up joshuafolkken/kit#1722's
single-writer guarantee. So the record keeps the **opening** list at every cut, and what shrinks is
the record's `done` field instead.

| Step | Command |
| --- | --- |
| At the start, in the same turn as step 1's `git switch main && git pull` | `pnpm josh run:carry --begin "queue #<N1> #<N2> …" --owner "$PPID"`, then `pnpm josh run:wake --start` |
| After each issue **finishes** — merged, or read back `CLOSED` without one | `pnpm josh run:carry --done <N>`, and `--merged 1` beside it where it actually merged |
| At every filing, on any route | `pnpm josh run:carry --filed 1`, so §2d's ten-filings ceiling counts across the cut |
| On `over`, as the session's **last** write | `pnpm josh run:carry --cut`, then the `confirmation` Telegram, then stop |
| After the last issue | `pnpm josh run:carry --end` and `pnpm josh run:wake --stop`, in the same turn as the final report |

- **The invocation written to `--begin` is the whole list as it was typed**, including the issues that
  have already merged in an earlier session. It never changes.
- **A repository-qualified queue is not carried, and it writes no `run:carry` call whatever.** The
  grammar the record and the waker share covers a bare `#<N>` reference only, so
  `queue kit#1762 kit#1749` has no issue list either of them can read — `--begin` it anyway and the
  supervisor refuses the wake at the cut, and `--json` answers with no `remaining` field for the
  resumed session to act on. So for a queue whose references carry a `owner/repo#` prefix (`SKILL.md`
  → §2c), **every row of the table above is skipped** — `--begin` and `run:wake --start`, and
  `--merged` / `--done` / `--filed` / `--cut` / `--end` with them.

  **Skipping the counters is the load-bearing half, not tidiness.** `--begin` is the only call that
  compares invocations and refuses — `mismatch`, `busy`, `standing`. The counters apply to whatever
  record stands at the git directory and `--end` deletes it outright, neither of them asking whose it
  is. So a run that skipped only `--begin` and went on counting would find a crashed `backlogrun`'s
  standing record — the one that is waiting for a person to decide — increment its counters, append
  to its `done`, and then delete it, with the one check that would have caught this removed by the
  very exception that let it through.

  What is kept instead is the older behavior at the seam: on `over`, send the `confirmation` Telegram
  naming `queue <the rest, prefixes and all>` as the resume command, and stop for the person to
  retype it. Widening the grammar to carry a repository alongside each number is deliberately not
  done here — the record's `done` holds numbers, and making it hold references is a change to the
  record rather than to this entry point.
- **`--cut` is the only thing that hands the record off**, and it is the session's last write: a later
  `--merged`, `--done` or `--filed` spends the hand-off and the successor is answered `standing`.
- **A crash stops the run, which is the specification.** Nothing reaches `--cut`, so the record stands
  and a person decides between `pnpm josh run:carry --resume "<the opening list>" --owner "$PPID"` and
  `--end` — exactly what `backlogrun` does, and for the same reason.

**What the resumed session does, in order.** Its prompt is the opening list, so nothing is inferred:

1. `pnpm josh run:carry --begin "<the prompt, verbatim>" --owner "$PPID"`. **`resumed` is the answer
   that continues**; `standing`, `mismatch`, `busy` and `expired` each stop the run and are
   `backlogrun.md`'s table, not repeated here.
2. `pnpm josh run:carry --json`. Its **`remaining`** field is the issues still to run, in the order
   the invocation declared them — **read it rather than subtracting two lists by hand**, which is the
   arithmetic joshuafolkken/kit#1774 moved into the command.
3. Run those, in that order, from step 2 above. The issues already in `done` are not started again.

The 8-hour whole-run bound is the record's own expiry, so it counts **across** cuts and a queue that
spends it is answered `expired` rather than beginning the eight hours over.

**There is no lane hand-over here, and no lane reading either.** A queue runs one issue at a time, so the merge
it has just read was the only thing it had in flight and the seam is idle already. And
`pnpm josh lane:list` reports the **repository's** work trees rather than this run's units, so a lane
some earlier `epicrun` left behind would gate a queue that never opened one — permanently, and
silently. That reading belongs to the entry point that opens lanes.

**Everything else is not repeated here.** When the check is asked, why delegation does not excuse it,
what the stop report says and what carries over are all `epicrun.md` → "The hand-off", the single
source for every entry point that runs more than one issue in one session.

## The release ask, once at the end

**After the last issue of the queue has merged, ask `pnpm josh release:scope` once** — not once per
issue. `followup.md` → "When `pnpm josh release` runs" is the single source: the position, the three
answers, and why the run reports the release rather than cutting one (joshuafolkken/kit#1582). A queue
stopped at a failure has still merged whatever ran before it, so the ask happens at that stop too.

