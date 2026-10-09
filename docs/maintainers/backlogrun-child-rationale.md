# `backlogrun` child — rationale

This is the maintainer-only rationale behind `.claude/skills/workflow-commands/backlogrun-child.md`:
the reasons, the history and the arguments that justify its rules. It is never read during a run —
the procedure document carries every trigger, command, bound and prohibition, and points here only for
why they are what they are.

## Why the file is read by section

A full re-read per child stacks the whole file onto the parent's conversation for every remaining
request, which is exactly the n²/2 growth the hand-off exists to avoid (`backlogrun-progress.md`).
Fetching only the section a later child needs keeps that cost flat. The file became a point-of-use
document, never an entry read, in joshuafolkken/kit#2010.

The shared mechanics were the `epicrun` procedure until joshuafolkken/kit#1985 folded that keyword into
`backlogrun`. A single-issue named item, a named epic's child and a bare backlog child all run the same
`fullrun` in the same way, which is why one part of one file is the single source for all three.

## Why a bare Issue promotes itself under `backlogrun` but not under `fullrun`

Typing `backlogrun` up front is the batch authorization, given once, before anything is known. A
`fullrun` that discovers a split has to stop because it only had one Issue's authorization; a
`backlogrun` already holds the authorization the split needs, so a prerequisite or a split found
mid-run does not stop it.

`epic:bundle` is asked before an epic is created because it names the epic rather than only reporting
that one exists — a second epic over the same Issue would give the auto-close two task lists to
disagree about. `epic:audit` runs only after that step because there is no epic to audit before it,
and `epic:audit` refuses an Issue with no task list exactly as `epic:next` does.

## Why each child runs in a delegated unit

The unit is the one `pnpm josh delegate` defines, with the unit changed from one step of a run to one
child of an epic; building a second mechanism would be the clone `CLAUDE.md` prohibits.

In a lane the unit is a detached operating-system process rather than a subagent, because an
in-process subagent could not survive the session cut the hand-off takes.

Where no isolated unit exists the child runs in the parent's context. Delegation keeps each child's
own context small and the hand-off bounds the parent session's length — they solve different problems,
so neither is an alternative to the other.

## Why the summary is bounded the way it is

The summary's only job is to carry what GitHub does not. Anything already on GitHub is re-billed on
every remaining turn of the run if it is put in the summary too.

"Make it shorter" is not the rule, because it deletes the wrong half — a report cut by feel loses the
observation nobody else recorded and keeps the file list anyone could have fetched. So both the kept
and the cut lists are written out, and the brief hands them to the unit.

The bound is a number so that it is not a judgement. A summary that cannot be said in 25 lines is
describing the work rather than reporting it. The brief states the bound because a unit never told it
writes to the length its own report format suggests. The person-facing completion report is not
bounded because it is read once; the hand-back is re-read.

The brief names the invocation it descends from because `CLAUDE.md` → "Explicit invocation required"
forbids _inferring_ a workflow, not requiring the keystroke in the unit's own transcript. A brief
that omits it leaves the unit guessing, and refusing is the correct answer to a guess.

## Why the audit runs before the first child

An epic whose children contradict each other stalls the moment the run reaches the contradiction, and
unattended is the worst time to find that out.

## Why `josh latest` is hoisted to the session

It is per session rather than per run because the two differ whenever an epic spans repositories. Each
session runs one repository's children, so each updates its own checkout: a second session that read
"once per run" and skipped it would merge that repository's children against stale dependencies and
never run `pnpm audit` there.

Waiting until a child is in hand keeps the tree clean. Run before the first `epic:next`, a run whose
first answer is `wait`, `stop` or `complete` would leave a rewritten `pnpm-lock.yaml` modified on the
default branch with nothing to commit it, which the next `git pull` refuses to merge over.

What the hoist removes is the other N-1 children carrying the bumps. Each child's PR would otherwise
carry unrelated bumps that `/code-review` and CodeRabbit read, whose CI failures are attributed to the
child, and which miss the eslint cache key (`hashFiles('pnpm-lock.yaml')`) on every PR.

A resumed session asks again because the tree it finds may be days old: a session resumed within the
window is told `skip`, one resumed a day later `required`.

## Why the preflight is part of the claim

An unattended run ends abnormally — a crash, a Ctrl-C, a laptop asleep, an expired token — and what it
leaves is a working tree: a feature branch, an open pull request, uncommitted changes. The loop opens
every child with `pnpm josh ms`, whose checkout refuses over a dirty tree, while an agent may not
reach for `git stash` on its own judgement. Without the preflight an unattended batch could not recover
from its own crash.

The rule answers so the run does not judge: "there is a branch, I will carry on" and "there is a branch,
I had better stop" are both defensible in the moment.

The claim and the preflight became one call in joshuafolkken/kit#1965. `run:hold` used to ask only
whether another live run owns this tree, while a separate `run:preflight` asked what a dead run left in
it. The claim now does both, taking the tree only when the preflight reads clean; the `reclaim` arm
stays re-askable because the check writes nothing.

It is skipped in a lane because every lane's HEAD is on `<N>-lane`, so the `reclaim` arm would fire on
all of them, and its recovery cannot run in a linked work tree.
