# `backlogrun` — running a child (shared mechanics, delegation, liveness, session setup)

**Read this file in full once per session — before the first child is dispatched**, in the turn that
reaches `pnpm josh delegate epic-child` (or `pnpm josh lane:dispatch`). **A later child does not re-read
the whole file; it fetches only the section that child needs** — `pnpm josh doc:section backlogrun-child.md
"<heading>"` — because a full re-read per child stacks this file's whole length onto the parent's
conversation for every remaining request, which is exactly the n²/2 growth the hand-off exists to
avoid (`backlogrun-progress.md`). It is a point-of-use document, never an entry read: the entry
procedure is `backlogrun.md`, which points here at that step (joshuafolkken/kit#2010). This file is the
single source of how one `backlogrun` child — of a named epic, a named issue, or the opted-in pool — is
run.

## Running a child — the shared mechanics

Everything below runs **one child** — of a named epic, or of the opted-in backlog. It was the `epicrun` procedure until joshuafolkken/kit#1985 folded that keyword into `backlogrun`; a single-issue named item, a named epic's child and a bare backlog child all run the same `fullrun` in the same way, and this part is the single source of how. A named epic runs these mechanics over its own children until every one is processed, then the run advances to the next named item.

## When `#N` is not an epic

`backlogrun` accepts an ordinary Issue as well as an epic. `backlogrun #<N>` on an Issue with no task list
runs `#<N>` as a `fullrun` and then finishes. Typing `backlogrun` up front is the batch authorization
given once, before anything is known; a `fullrun` that discovers a split has to stop because it only
had one Issue's authorization. So inside `backlogrun #<N>`, a prerequisite or a split found mid-run does
**not** stop the run:

1. File the new Issue(s) with the matching route label — `route:split` for a split, `route:tier-a`
   for a prerequisite — no confirmation.
2. **Stash the work in progress and remove `in-progress` from `#<N>`**, exactly as steps 2 and 4 of
   "A prerequisite discovered mid-run" do — `git stash push -u -m "..."` with the `-u`, the
   `gh api repos/{owner}/{repo}/issues/<N>/comments` post that records the stash, and
   `gh api -X DELETE repos/{owner}/{repo}/issues/<N>/labels/in-progress 2>/dev/null || true`.
3. **Ask `pnpm josh epic:bundle <N>` whether an epic already tracks `#<N>` before creating one.** It
   names the epic rather than only reporting that one exists — creating a second epic over it gives
   the auto-close two task lists to disagree about.

   | Answer | What to do |
   | --- | --- |
   | An epic `#<E>` already tracks `#<N>` | `pnpm josh epic --add <E> <P> --before <N>` for a prerequisite, or `--add <E> <N1> ...` for a split. **Do not create a second epic.** Continue the loop against `#<E>` |
   | No epic tracks it | Create one — the command depends on what was found (table below) |
   | **The command could not answer** — a non-zero exit, `Could not confirm which epic already tracks these — do not place this issue in one.`, or a ⚠ warning about a truncated listing (beginning `⚠ The epic listing …`, in either form `hit its …-epic cap` / `stopped at the …-issue page ceiling`) above a `Nothing to bundle.` verdict; `⚠ Could not read #N.` is one failed relation read and voids nothing, and a definitive answer stands even beside a warning | Park `#<N>` with `needs-decision` and report. "Could not tell" is not "no epic tracks it" |

   When creating one, `#<N>` is itself one of the deliverables — this path always takes the
   keep-as-a-child arm of `split-assessment.md`'s promote-or-create branch. Which command depends on
   what was found, because `--ordered` makes the argument order the dependency chain:

   | Found | Command |
   | --- | --- |
   | A prerequisite `<P>` | `pnpm josh epic "<title>" <P> <N> --ordered` — the prerequisite comes **first** |
   | A split into independent children | `pnpm josh epic "<title>" <N> <N1> ...` — **no `--ordered`** |
   | A split whose children do have an order | `pnpm josh epic "<title>" ... --ordered`, arguments in that order |

4. **Run `pnpm josh epic:audit <E>` now**, not earlier — there is no epic to audit until step 3, and
   `epic:audit` refuses an Issue with no task list exactly as `epic:next` does.
5. **Do not stop.** Continue into the loop below against the new epic `#<E>`.

**Nothing found means no epic.** If `#<N>` reaches its merge without a prerequisite or a split turning
up, the run finishes there. An epic is created only when there is a second child to put in it.

**Every guard below applies on this path unchanged** — 30 children, 10 Issues filed, 3 consecutive
failures.

**This does not let `fullrun` promote itself.** A `fullrun` that discovered a split still files the
children and the epic and then **stops** (`split-assessment.md` → "Finding a split mid-run stops the
run").

**`josh epic:next` is not changed by any of this.** It still refuses an Issue with no task list; the
acceptance of a bare Issue belongs to `backlogrun`.

**Naming a bare Issue beside an epic is a mistyped command rather than a second entry.** Where one
reference is named, the refusal is the whole answer. Where several are, a task-listless reference is
**skipped** so the other epics keep running — `backlogrun #<E> --only #<N>` with `#<N>` an ordinary Issue exits
0, notes the skip on standard error, and **never runs `#<N>`**. A run that means to do both types
`backlogrun #<N>` on its own after the epic.
## Each child runs in a delegated unit

**A child is not run in the parent loop's context.** One child goes to an isolated execution unit,
and only its summary comes back.

**The parent orchestrates and never implements a child in its own context.** *Every* child takes a
delegated unit — a fresh one and **a child just released from `needs-decision`** alike. The rule is
one sentence: **whatever offers a child — the loop, or a person clearing a label — the child is handed
to a lane, never to the parent.**

**The mechanism is the one `pnpm josh delegate` defines** — the enumeration plus the command — with
the unit changed from one step of a run to one child of an epic. Building a second is the clone
`CLAUDE.md` prohibits. Ask the command rather than deciding:

```bash
pnpm josh delegate epic-child   # → delegate
```

**In a lane, that unit is a detached operating-system process rather than a subagent of this
session.** The verifier is still `pnpm josh issue:state <N>` read from GitHub, and the summary is
still bounded at 25 lines. An in-process subagent could not survive the session cut the hand-off
takes. `pnpm josh lane:dispatch` is where a lane's child is started; "Handing the child over" below
carries the command.

**The lane child uses the invoking CLI's `worker` profile.** Claude Code defaults to Anthropic
`opus` / `medium`; Codex uses `codex exec`, OpenAI `gpt-5.6-sol` / `medium`, workspace-write and
JSONL. `JOSH_WORKER_MODEL` overrides Claude Code only; `JOSH_WORKER_EFFORT` covers both providers,
and legacy `JOSH_LANE_*` applies only here. Bad markers, missing CLI/auth and failure
refuse or park without fallback or retry.
`docs/josh-commands.md` → "`josh lane:dispatch`" is the single source.

**The parent reads GitHub, never the summary.** That is `epic-child`'s verifier: a unit that reports
a child finished without its PR merged leaves that child open, and `pnpm josh issue:state <N>` says so
in one call. The child's own gate, `/code-review` and CI run inside the unit. **Never advance the
loop on the summary alone** — that discards the verifier.

### What the summary carries, and how long it may be

**The summary's only job is to carry what GitHub does not.** Anything already on GitHub is re-billed
on every remaining turn of the run if it is put in the summary too. **"Make it shorter" is not the
rule, because it deletes the wrong half** — a report cut by feel loses the observation nobody else
recorded and keeps the file list anyone could have fetched. So both lists are written out, and the
brief hands them to the unit.

**Always kept — five things, because none of them is anywhere else:**

1. **`Cause` / `Fix` / `Result`**, the three plain lines — the parent's orientation.
2. **Every verification result the run did not close in the ordinary way**, named as such. A result
   nobody obtained must never reach the parent as a run that passed.
3. **Observations that could bite later** — something noticed and not filed, a flaky check, a
   surprising diff, work a later child will collide with. **This is the only route a child's
   discretionary observation has**: a child files `route:tier-a` and `route:interrupt` only, and the
   parent files what survives — `SKILL.md` → §2i, the single source. **What the parent does with the
   rest is append it, not drop it**: an observation that cannot cite the depth-0 work it blocked
   becomes one line in `docs/observations.md`, and a second line under the same key files it. **The
   child never writes that file** — it cannot tell its observation from the sibling lane's.
4. **Decisions taken and why**, where the decision was not already logged as an Issue comment.
5. **What was left undone**, and under whose authority.

**Always cut — three things, because GitHub already holds them:** the changed-file enumeration (the
pull request's own file list), the per-round review detail (each round's verdict is one line; the
findings are on the pull request), and restatements of rules the parent already holds.

**The bound is 25 lines, and it is a number so that it is not a judgement.** A summary that cannot be
said in 25 lines is describing the work rather than reporting it. **The brief states the bound**,
because a unit never told it writes to the length its own report format suggests.

**This does not shorten the person-facing completion report.**
`prompts/collaboration-workflow/report-format.md` → 「完了報告（セッション向け）」 is unchanged. What is
bounded here is the child's hand-back to the parent, because the hand-back is re-read.

**Read the state directly rather than asking `epic:next` again.** A child that did not finish still
carries `in-progress`, which `epic:next` classifies as waiting on time before it consults any blocker.

**The merge authorization reaches the unit**, and **so does the explicit invocation** — `CLAUDE.md` →
"Explicit invocation required" forbids *inferring* a workflow, not requiring the keystroke in the
unit's own transcript. **The brief therefore names the invocation it descends from** — `backlogrun #<E> --only`,
the child number, and that the child is to be run as `fullrun #<N>` under that authorization. A brief
that omits it is the defect: the unit is then guessing, and refusing is the correct answer to a guess.

**Where no isolated unit exists, run the child in the parent's context.** The hand-off below is asked
at every merge; delegation keeps each child's own context small and the hand-off bounds the parent
session's length, so it is not an alternative to it.

## A delegated unit that stopped without reporting

**A unit can be stopped from outside, and a stop leaves no notification behind** — and a stopped unit
trips none of this file's guards, which all assume it is running. **So the parent checks rather than
waiting — which means it must not be waiting.** **Hand the child to the unit without blocking on its
return, and poll** at the loop's polling interval; ask once the unit's output has been unchanged for
the silent-unit window (`| Silent delegated unit | 30 min |` below).

**Note where the unit writes at hand-off; the modification time is read from the file, not carried.**
**Where the child runs in a lane, that note goes into the lane rather than the conversation** —
`pnpm josh lane:output <N> <path>`, in the same turn as the dispatch, so it comes back from
`pnpm josh lane:output <N>` in any session.

**Ask the command rather than combining the traces yourself.** Traces are read **in the checkout the
unit was given** — this session's own unless the unit was handed a separate work tree, and the stash in
the recovery below is taken there too.

```bash
pnpm josh run:liveness <N> --output <path> --process none    # alias: josh rv
pnpm josh run:liveness <N> --output <path> --process alive
pnpm josh run:liveness <N> --output <path> --process none --window 45 --repo <owner/repo>
```

| Answer | What it found | What the parent does |
| --- | --- | --- |
| `alive` | The output moved, or a process of the child is running | Keep polling; touch nothing |
| `stopped` | The output has been frozen past the window and no process of the child is alive | The recovery below |
| `settled` | The child closed, or the unit parked it with `needs-decision` | Re-read it with `pnpm josh run:status <N>` — one read-only call whose state section says which branch and whose carry counters beside it feed the failure-streak decision — and take the branch its state section says |
| `undetermined` | A trace could not be read | Read the trace that failed and ask again — and see the two-in-a-row rule below |

**Two `undetermined` answers in a row is a fault in the check, not a slow unit.** The second
consecutive `undetermined` on the same child ends the polling: send a `confirmation` Telegram naming
the trace that failed, and stop. **It is never escalated to a `stopped`** — nothing was read.

**Silence and no process together — never either one alone**, because each alone has an innocent reading
(a unit inside a long check writes nothing; a unit only reading has no check process) and together they
do not. **Which way an error falls is the whole design**: a live unit booked as stopped has its work
killed, a stopped one booked as alive only costs waiting — so **a trace that could not be read answers
`undetermined`, never `stopped`**, and a process trace nobody gave is an unasked question rather than
"no process". **Output that moved answers `alive` on its own; a live process is weighed only once every
trace has answered.**

**The path passed to `--output` is absolute** — the command refuses a relative one. **The process
trace is the one the command does not read for itself**: run it in the unit's checkout and read the
command lines rather than the names — `pgrep -laf 'josh gate'` etc. — looking for one naming **that
checkout's path**, since several kit projects may run at once. **Read the file the path points at, not
the link**: a transcript path is a symlink whose own modification time never changes, so a `stat` typed
by hand needs `-L` (`run:liveness` follows the link itself).

**A clean checkout is not evidence that the unit is alive** — a stop can come while the unit is still
reading the skill and the issue. The checkout is read only for whether there is work to stash before
the child is parked; **"nothing was ever opened for the child" is `pnpm josh run:hold`'s preflight check
at the start of the next child, not this one's.**

**What follows is what a failed child already gets.** Re-read the child first with
`pnpm josh run:status <N>` — its state section carries the same `state:` / `labels:` /
`human_review:` lines `issue:state` prints, and folds in the carry counters this recovery reads
anyway; then, while it is still `state: OPEN` and not carrying `needs-decision`.
**A re-read carrying `needs-decision`** means the unit parked the child and then stopped, so fall
through to the loop's park branch: leave the label on, count nothing against the consecutive-failure
guard, and go back to step 1.

1. **Stash the half-finished work** — `git stash push -u -m "backlogrun: stopped unit for #<N>"` — and
   record it on the Issue. `-u` is not optional, and the comment is what gets the stash popped — by
   message, `pnpm josh stash:pop "backlogrun: stopped unit for #<N>"`, never a positional
   `git stash pop` that a shared stack lets another lane divert.
2. **Classify how the child ended and act, in one call** — `pnpm josh run:merge <N> --output <path>`
   (add `--epic <E> --repo <owner/repo> --owner "$PPID"` for a named epic). **It is the same composite a
   returned child takes** (`backlogrun-progress.md` → "Running a named epic's children"), reached here
   from the poll rather than from a return — so a stopped child and a returned one run through **one**
   decision, never a second copy of it (joshuafolkken/kit#2277). It **reads the child's exit record
   without waiting for the unit to return**, telling an `outage` — a child that could not reach the API
   (joshuafolkken/kit#2240) — apart from an `abandoned` one that stopped mid-implementation, and it drops
   the stale `in-progress` itself, so there is no separate label-removal step:
   - **outage** — the child never reached the API, so it is counted into its own outage streak and
     **re-dispatched in the same run** by being offered again, **not** parked with `needs-decision` and
     **not** counted against the consecutive-failure guard. **The re-dispatch resumes the child's
     session** (joshuafolkken/kit#2317): `lane:dispatch` reads the `session_id` off the exit record and
     relaunches with `--resume`, keeping its context and losing only the last round-trip; with no session
     id it falls back to a fresh `fullrun`, and the report says which path it took. **A burst of outages
     from one network event folds into a single streak step** — outages inside a two-minute window count
     once — so one disconnection hitting several children no longer trips the guard. The re-dispatch is
     bounded by `CONSECUTIVE_OUTAGE_LIMIT` in `scripts/run/run-merge.ts`, so *distinct* outages (spaced
     past the fold window, as a dead API produces) trip the separate outage guard, at which point the
     command prints `environment` and the run stops. It never re-dispatches into a dead API forever.
   - **abandoned** — counted against the consecutive-failure guard and parked with `needs-decision`,
     exactly as a failed child. A silent retry would re-run a half-written tree; that guard is the only
     thing that notices the environment rather than the children is at fault.
3. **Read the token it printed and take that branch** — a next child number to run (the re-dispatched
   outage child among them), `environment` / `stop` to end the run, or `busy` / `retry` to re-read —
   the same tokens the merge event reads (`backlogrun-progress.md` → "Running a named epic's children").
   Then go back to step 1 of the loop.

**Why the poll routes through `run:merge` rather than booking the stop itself.** The counting, the
re-dispatch cap and the park all live in one place, so the poll cannot drift from the return path:
counting the outage into its streak is what lets the cap trip, and skipping the count would
re-dispatch into a dead API without bound. Reading the exit record here — not waiting for a unit that
an API outage may never return — is what turns a 400-minute wait into a same-run re-dispatch
(joshuafolkken/kit#2277).

## Audit before the first child

Run `pnpm josh epic:audit <E>` before step 1 below. **When the run began from a bare Issue there is
nothing to audit yet** — that path runs the audit at the moment it creates the epic instead. An epic
whose children contradict each other stalls the moment the run reaches the contradiction, and
unattended is the worst time to find that out. Errors stop the run; warnings are read and carried on
past. Fixing what it finds is Tier A.

## `josh latest` runs once per session, not once per child

`josh latest` belongs to the **session**, not to a child. Ask once, the first time the loop below hands
back a child number — before implementing that child — and never again:

```bash
pnpm josh latest:scope   # → required | skip ; the reason on stderr
git stash push -u -m "backlogrun: josh latest #<N>"        # only if the tree has staged or modified files — never conditional on the answer
git switch main && git pull
pnpm josh latest         # on `required` only
pnpm josh stash:pop "backlogrun: josh latest #<N>"         # only if you stashed above — by message, not a positional pop
```

On `required`, load the `dependency-update` skill and follow its procedure — the overrides in **both**
`pnpm-workspace.yaml` and `package.json`, and the one expected `devEngines` pnpm bump. **The answer is
the command's, never a judgement**, and `latest-gate.md` is its single source.

**Session, not run** — the two differ whenever an epic spans repositories. Each session runs one
repository's children, so each updates its own checkout: a second session that read "once per run" and
skipped it would merge that repository's children against stale dependencies and never run `pnpm audit`
there.

**Waiting until a child is in hand is what keeps the tree clean.** Run it before the first `epic:next`
and a run whose first answer is `wait`, `stop` or `complete` leaves a rewritten `pnpm-lock.yaml`
modified on the default branch with nothing to commit it, which the next `git pull` refuses to merge
over.

**The lock file the update rewrites lands with the first child.** The first child's `pnpm josh git -y`
commits it — so that one PR carries the dependency bumps. What the hoist removes is the other N-1
children carrying them; each child's PR would otherwise carry unrelated bumps that `/code-review` and
CodeRabbit read, whose CI failures are attributed to the child, and which miss the eslint cache key
(`hashFiles('pnpm-lock.yaml')`) on every PR. Should the first child fail CI on a bump, fix it forward
before parking it.

**`git switch main && git pull` stays per child** — it brings the previous child's merge into the tree,
and a child that skips it implements on a stale main. Only the dependency update moves to the run. **In
lanes it changes hands**: no lane can switch to the default branch, so the parent runs it in the primary
checkout **before each `lane:open`**. **And in a lane `josh latest` is not even asked** — `latest:scope`
skips and `latest:guard` refuses. The stash that carries the lock file into the first lane is in "Once
per repository, before the first lane opens" above.

This is the same rule `latest-gate.md` is the single source of.

**A resumed `backlogrun` is a new session**, so it asks once again before its first child. The tree the
resumed session finds may be days old — a session resumed within the window is told `skip`, one resumed
a day later `required`.

## Preflight — reclaim what an interrupted run left, before the next child starts

**An unattended run ends abnormally** — a crash, a Ctrl-C, a laptop asleep, an expired token — and what
it leaves is a **working tree**: a feature branch, an open pull request, uncommitted changes. The loop
opens every child with `git switch main && git pull`, which refuses over a dirty tree, while an agent
may not reach for `git stash` on its own judgement. So an unattended batch could not recover from its
own crash.

**The child's claim is what asks it.** `pnpm josh run:hold <N>` — the first call of the child's
`fullrun` procedure — now runs the preflight check before it takes the tree
(joshuafolkken/kit#1965): it hands back a hold **only on a clean tree**, and returns
`reclaim` / `resume` / `park` without claiming otherwise. There is no separate command to ask first;
the two-step "preflight, then hold" is one call.

```bash
answer=$(pnpm josh run:hold 926)   # alias: josh rh ; one token on stdout, prose on stderr
```

| Answer    | What it found                                                         | What to do                                                                                                                                                                                                                                                                       |
| --------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hold`    | Nothing left behind; the tree is claimed                             | Start the child. This is the ordinary answer.                                                                                                                                                                                                                                     |
| `reclaim` | Uncommitted changes, or HEAD off the default branch                   | Run what stderr printed: `git stash push -u -m "run:hold reclaimed before #<N>"`, then `git switch <default> && git pull`. **`-u` is not optional** (a new `*.test.ts` is untracked). **Then record the stash on `#<N>` as a comment, and ask `run:hold` again** — the check is re-askable. |
| `resume`  | A branch for `#<N>`, or an open pull request, is still here           | **Reuse it and run the whole verification gate from the start** — never only the part the interrupted run had not reached. The tools are idempotent; what was missing was that **nobody had verified what the dead run already committed**.                                          |
| `park`    | The pull request for `#<N>` is **merged** or **closed**               | **Park the child** — `needs-decision` plus a comment naming what was found — and continue. Carrying on over a merged PR duplicates work; over a closed one revives rejected work. Do not delete the branch, reopen the PR, or commit on top of it.                                   |
| `busy`    | Another **live** run holds this tree                                  | Stop before filing anything — `run:hold`'s own answer, unchanged.                                                                                                                                                                                                                 |
| `unknown` | The tree could not be read                                            | Stop the session and report. It is not "the tree is clean".                                                                                                                                                                                                                       |

**The rule answers, so the run does not judge.** "There is a branch, I will carry on" and "there is a
branch, I had better stop" are both defensible in the moment, which is why the choice is not left to it.

**The `git stash` above is one of the flows that authorizes automatic stashing**
(`prompts/collaboration-workflow/operating-rules.md` → the `git stash` bullet). **It is the one entry
there not followed by a pop**: what is stashed belongs to a run that is gone, so **the Issue comment is
the only thing that can bring it back** — recovered by message, `pnpm josh stash:pop "run:hold
reclaimed before #<N>"`, never a positional `git stash pop` a shared stash stack lets another lane
divert.

**Report what was reclaimed** — a child that started from a `reclaim` or a `resume` says so, with the
stash reference where there was one.

**The claim and the preflight are one call now** (joshuafolkken/kit#1965). `run:hold` used to ask only
*whether another live run owns this tree* — claimed once, per child — while a separate `run:preflight`
asked *what a dead run left in it*. The claim now does both, taking the tree only when the preflight
reads `clean`. The `reclaim` arm stays re-askable, because the check writes nothing: recover what it
named and ask `run:hold` once more, and the now-clean tree is claimed.

**It is not asked in a lane.** Every lane's HEAD is on `<N>-lane`, so the `reclaim` arm would fire on
all of them and its recovery cannot run in a linked work tree — so `run:hold` claimed inside a lane
skips the check, and `lane:open`'s own answer covers an interrupted lane instead. **Asked in the
primary checkout while a lane for that child is open, `run:hold` would read `resume`, which is
correct** — the branch read `git branch --list '<N>-*'` matches `<N>-lane`. The loop never reaches it
that way, because `epic:next` does not offer a child already carrying `in-progress`.
