# `needs-human-review` — rationale

This is maintainer-only rationale behind `.claude/skills/workflow-commands/needs-human-review.md`: why
the label exists and why it is kept apart from `needs-decision`. It is never read during a run — every
step, stop and command an agent acts on stays in the procedure document, and a change to this file
changes no rule.

## Why the label exists

Some work's quality is not something a test can judge — a **published artifact** whose unit tests say
nothing about the writing, or **a choice that was a person's to make**, such as picking one of several
generated candidates. The label is `auto-ok`'s opposite: that label widens unattended execution past an
epic's edge, this one withholds a run's last step. Its job is to stop a batch walking past a decision
that was a person's to make, which is why stopping is the specification rather than a failure.

The answer is read from `pnpm josh issue:state <N>` rather than by matching the label string, because
the command prints `human_review: yes` / `no` through the same case-insensitive comparison every other
workflow label goes through — so `Needs-Human-Review` is not missed. It is asked as a call of its own
because `epic:next` prints a bare issue number and `fullrun` and a batch child are handed one.

The procedure's body was relocated out of the entry read, which keeps the trigger (`SKILL.md` → §2) and
the pointer (`entry-sequence.md`, `backlogrun.md`) — joshuafolkken/kit#2189.

## Why it is not `needs-decision`

Reading one as the other breaks two things. `needs-decision` withholds a run's _start_; this withholds
its _end_. So a `needs-human-review` issue is still offered — excluded, the artifact a person is meant
to look at would never be produced. And a child stopped by it goes on holding its repository, because
the uncommitted work is still in the checkout; read as parked, the next child would start
`pnpm josh ms` on top of it. The code encodes both halves by leaving the label out of two sets.
