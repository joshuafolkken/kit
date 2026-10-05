# `backlogrun` — running a child (shared mechanics, delegation, liveness, session setup)

**Read this file in full once per session — before the first child is dispatched**, in the turn that
reaches `pnpm josh delegate epic-child` (or `pnpm josh lane:dispatch`). **A later child does not re-read
the whole file; it fetches only the section that child needs** — `pnpm josh doc:section backlogrun-child.md
"<heading>"`. It is a point-of-use document, never an entry read: the entry procedure is `backlogrun.md`,
which points here at that step. This file is the single source of how one `backlogrun` child — of a
named epic, a named issue, or the opted-in pool — is run. Rationale:
`docs/maintainers/backlogrun-child-rationale.md` → "Why the file is read once and then by section".

## Running a child — the shared mechanics

Everything below runs **one child** — of a named epic, or of the opted-in backlog. A single-issue named item, a named epic's child and a bare backlog child all run the same `fullrun` in the same way, and this part is the single source of how. A named epic runs these mechanics over its own children until every one is processed, then the run advances to the next named item.

## When `#N` is not an epic

`backlogrun` accepts an ordinary Issue as well as an epic. `backlogrun #<N>` on an Issue with no task list
runs `#<N>` as a `fullrun` and then finishes. Inside `backlogrun #<N>`, a prerequisite or a split found
mid-run does **not** stop the run (rationale: `docs/maintainers/backlogrun-child-rationale.md` → "Why a
bare Issue promotes itself under `backlogrun` but not under `fullrun`"):

1. File the new Issue(s) with the matching route label — `route:split` for a split, `route:tier-a`
   for a prerequisite — no confirmation.
2. **Stash the work in progress and remove `in-progress` from `#<N>`**, exactly as steps 2 and 4 of
   "A prerequisite discovered mid-run" do — `git stash push -u -m "..."` with the `-u`, the
   `gh api repos/{owner}/{repo}/issues/<N>/comments` post that records the stash, and
   `gh api -X DELETE repos/{owner}/{repo}/issues/<N>/labels/in-progress 2>/dev/null || true`.
3. **Ask `pnpm josh epic:bundle <N>` whether an epic already tracks `#<N>` before creating one.**

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

4. **Run `pnpm josh epic:audit <E>` now**, not earlier — there is no epic to audit until step 3.
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
and only its summary comes back. Rationale: `docs/maintainers/backlogrun-child-rationale.md` → "Why
each child runs in a delegated unit".

**The supervisor's driver is the mechanical parent after hand-off.** It uses the same lane dispatch
and GitHub verification commands; an AI parent handles only a returned judgment branch. *Every* child takes a
delegated unit — a fresh one and **a child just released from `needs-decision`** alike. The rule is
one sentence: **whatever offers a child — the loop, or a person clearing a label — the child is handed
to a lane, never to the parent.**

**The mechanism is the one `pnpm josh delegate` defines** — the enumeration plus the command — with
the unit changed from one step of a run to one child of an epic. Never build a second. Ask the command
rather than deciding:

```bash
pnpm josh delegate epic-child   # → delegate
```

**In a lane, that unit is a detached operating-system process rather than a subagent of this
session.** The verifier is still `pnpm josh issue:state <N>` read from GitHub, and the summary is
still bounded at 25 lines. `pnpm josh lane:dispatch` is where a lane's child is started; "Handing the
child over" in `backlogrun-lanes.md` carries the command.

**The lane child uses the invoking CLI's `worker` profile.** Claude Code defaults to Anthropic
`claude-opus-5-5` / `medium`; Codex uses `codex exec`, OpenAI `gpt-6.1-sol` / `medium`, workspace-write and
JSONL. `JOSH_WORKER_MODEL` overrides Claude Code only; `JOSH_WORKER_EFFORT` covers both providers,
and legacy `JOSH_LANE_*` applies only here. Bad markers, missing CLI/auth and failure
refuse or park without fallback or retry.
`docs/josh-commands-automation.md` → "`josh lane:dispatch`" is the single source.

**The parent reads GitHub, never the summary.** That is `epic-child`'s verifier: a unit that reports
a child finished without its PR merged leaves that child open, and `pnpm josh issue:state <N>` says so
in one call. The child's own gate, `/code-review` and CI run inside the unit. **Never advance the
loop on the summary alone** — that discards the verifier.

### What the summary carries, and how long it may be

**The summary's only job is to carry what GitHub does not.** Both lists below are written out, and the
brief hands them to the unit. Rationale: `docs/maintainers/backlogrun-child-rationale.md` → "Why the
summary is bounded the way it is".

**Always kept — five things, because none of them is anywhere else:**

1. **`Cause` / `Fix` / `Result`**, the three plain lines — the parent's orientation.
2. **Every verification result the run did not close in the ordinary way**, named as such. A result
   nobody obtained must never reach the parent as a run that passed.
3. **Observations that could bite later** — something noticed and not filed, a flaky check, a
   surprising diff, work a later child will collide with. **This is the only route a child's
   discretionary observation has**: a child files `route:tier-a` and `route:interrupt` only, and the
   parent files what survives — `observation-filing.md`, the single source. **What the parent does with the
   rest is append it, not drop it**: an observation that cannot cite the depth-0 work it blocked
   becomes one line in the observation ledger, and a second line under the same key files it. **A
   child appends only to its own issue's file, `docs/maintainers/observations/<N>.md`, in its own
   lane** (joshuafolkken/kit#2919) — it merges with the child's pull request, and a sibling lane's
   file is never one it touches.
4. **Decisions taken and why**, where the decision was not already logged as an Issue comment.
5. **What was left undone**, and under whose authority.

**Always cut — three things, because GitHub already holds them:** the changed-file enumeration (the
pull request's own file list), the per-round review detail (each round's verdict is one line; the
findings are on the pull request), and restatements of rules the parent already holds.

**The bound is 25 lines, and it is a number so that it is not a judgement.** **The brief states the
bound.**

**This does not shorten the person-facing completion report.**
`prompts/collaboration-workflow/report-format.md` → 「完了報告（セッション向け）」 is unchanged. What is
bounded here is the child's hand-back to the parent.

**Read the state directly rather than asking `epic:next` again.** A child that did not finish still
carries `in-progress`, which `epic:next` classifies as waiting on time before it consults any blocker.

**The merge authorization reaches the unit**, and **so does the explicit invocation**. **The brief
therefore names the invocation it descends from** — `backlogrun #<E> --only`, the child number, and that
the child is to be run as `fullrun #<N>` under that authorization. A brief that omits it is the defect,
and the unit refuses it.

**Where no isolated unit exists, run the child in the parent's context.** The hand-off below is still
asked at every merge; delegation is not an alternative to it.

## A delegated unit that stopped without reporting

**Hand the child to the unit without blocking on its return, and poll** — a stopped unit leaves no
notification behind. Once its output has been unchanged for the silent-unit window, read
`backlogrun-recovery.md` → "A delegated unit that stopped without reporting" and ask
`pnpm josh run:liveness`.

## Audit before the first child

Run `pnpm josh epic:audit <E>` before step 1 below. **When the run began from a bare Issue there is
nothing to audit yet** — that path runs the audit at the moment it creates the epic instead. Errors
stop the run; warnings are read and carried on past. Fixing what it finds is Tier A. Rationale:
`docs/maintainers/backlogrun-child-rationale.md` → "Why the audit runs before the first child".

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

**Session, not run** — each session runs one repository's children, so each updates its own checkout;
never skip it because another repository's session already ran it. **Never ask it before a child is
in hand.**

**The lock file the update rewrites lands with the first child.** The first child's `pnpm josh git -y`
commits it — so that one PR carries the dependency bumps and the other children carry none. Should the
first child fail CI on a bump, fix it forward before parking it.

**`git switch main && git pull` stays per child** — it brings the previous child's merge into the tree,
and a child that skips it implements on a stale main. Only the dependency update moves to the run. **In
lanes it changes hands**: no lane can switch to the default branch, so the parent runs it in the primary
checkout **before each `lane:open`**. **And in a lane `josh latest` is not even asked** — `latest:scope`
skips and `latest:guard` refuses. The stash that carries the lock file into the first lane is in
`backlogrun-lanes.md` → "Once per repository, before the first lane opens".

This is the same rule `latest-gate.md` is the single source of.

**A resumed `backlogrun` is a new session**, so it asks once again before its first child.

Rationale: `docs/maintainers/backlogrun-child-rationale.md` → "Why `josh latest` is hoisted to the
session".

## Preflight — the child's claim asks it

`pnpm josh run:hold <N>`, the first call of the child's `fullrun`, checks for an interrupted run's
leftovers before it claims the tree, and prints the step for each answer (`reclaim` / `resume` /
`park`) on stderr — follow it, and report a reclaim or resume with its stash reference. The answers are
`docs/josh-commands-automation.md` → "`josh run:hold`"; rationale:
`docs/maintainers/backlogrun-child-rationale.md` → "Why the preflight is part of the claim".

