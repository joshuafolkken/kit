# Observation ledger — rationale

This is maintainer-only rationale behind `.claude/skills/workflow-commands/observation-ledger.md`: why
the ledger exists, why it has a commit path and why a second sighting files. It is never read during a
run, and a change to this file changes no rule. It was split out of `observation-filing-rationale.md`
with the procedure it explains (joshuafolkken/kit#3176).

## Why the ledger exists

**"Not filed" used to mean "gone", and that is what walked the depth test past itself.** The
completion report was the only place such an observation could land, and a completion report is
read once and then scrolls away — so the next run met the same thing as a first sighting, forever.
joshuafolkken/kit#1726 is the worked case: its own body says the depth test would not have filed it,
and it was filed anyway, because **discarding it was the only alternative on offer**
(joshuafolkken/kit#1728).

**The grammar is defined in the procedure rather than in the ledger** because the skill is distributed
to every repository that consumes the package and `docs/` is not — a rule that named a definition the
reader never received would leave every consumer's ledger shaped by hand.

## Why the ledger has a commit path

**An append nobody commits is an append nobody can count** (joshuafolkken/kit#1756). The ledger was
given a destination and no route out of the working tree the line was written in, and **structurally
nobody was going to commit one**: the parent session that appends never runs `pnpm josh git`, a child
runs it inside a lane work tree that cannot see the parent's checkout, and in the primary checkout
`git add -u` swept the line into whatever unrelated pull request that run was opening. Measured on
the day the ledger shipped, `docs/observations.md` (the single-file ledger, since moved under
`docs/maintainers/` by joshuafolkken/kit#2724 and split into a directory by joshuafolkken/kit#2919)
had exactly one commit — the one that created
it — and seven lines had never left a working tree. **So the repeat count was reading a file
that is empty on every other machine**, and every sighting was a first one, which is the state
joshuafolkken/kit#1728 created the ledger to end.

**Why a run's lines ride its own commit.** Until #2763 the ledger was excluded from the staging step
(joshuafolkken/kit#1756) and every run that appended a line paid a second branch, CI wait and merge
after its own — 144 ledger-only pull requests in one month.

**Why a lane carries its own lines.** Lanes once wrote to the primary checkout's single file instead
(joshuafolkken/kit#2419) and a `backlogrun` flushed them all at `run:carry --end`
(joshuafolkken/kit#2492); another run's stash of that checkout took the lines before the flush saw
them, so neither route remains.

## Why a second sighting files

**A repeat is the citation.** joshuafolkken/kit#1698 asked a discretionary filing to be pulled by a
blockage rather than pushed by a sighting; an observation recorded twice has been pulled — it came
back on its own, which no single sighting can demonstrate.
