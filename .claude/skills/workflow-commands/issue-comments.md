# An Issue's comments are part of the Issue

Read before implementing a `#N` Issue.

**Every `#N` entry point reads the Issue's comments before it implements** — `fullrun`, `halfrun` and
`kickoff`; a `backlogrun` named issue and epic child inherit it through `fullrun`. One call, in the same
turn as whatever else the run needs:

```bash
pnpm josh issue:read <N> [<N> ...]                       # body and comments, one call per batch
pnpm josh issue:read <N> [<N> ...] --repo <owner/repo>   # an Issue in another repository
```

The command **says when a comment listing could not be read rather than showing no comments**. A raw
read of this repository's Issue, its comments or its timeline — `repos/{owner}/…` or the repository
spelled out, and `gh issue view` — is refused (`pnpm josh rule:list` → `direct-issue-read`).

An Issue whose author has no write access stops at `run:entry` until a person with write access
plans it with `kickoff #N`; the run then follows that plan (`scripts/run/entry/run-entry-trust.ts`).
A trust read that failed stops there too, naming the failed read.

**This repository writes its agreements into comments and then reads only bodies.** **What the
reading is for**: the scope boundary — work a comment moved elsewhere or added here; an auto-decision
already made; a split or epic agreement; a recorded stash or in-flight branch; a **correction of the
body's own diagnosis**.

## When a comment contradicts the body

**The later text is the agreement in force** — the comment is the newer, so it wins. **This is settled
by ordering, never by judging which reads better.** Name in the work summary which comment superseded
what.

**Two answers are not the run's to make, and each is decided from what the comment says:**

- **A comment that reassigns part of the scope to another Issue** takes that part out of scope, whatever
  the body's criteria say; name the Issue it went to in the completion report.
- **A comment saying the Issue no longer has a reason to exist** — the defect does not reproduce, or it
  was fixed elsewhere — takes the exit in "When the work turns out to be already merged". Closing an
  Issue any other way is Tier C.

Everything else, **a widened scope included**, is ordinary work; a widening into several
separately-mergeable deliverables is the split assessment's business (`split-assessment.md`).

## When the work turns out to be already merged

**A comment says so, or the run itself verifies it** by finding every acceptance criterion already
satisfied in merged code — one procedure either way. **Parking it is not the place**: `needs-decision`
means "waiting for an answer", and here the answer exists.

**The exit applies the `already-done` label, then closes the Issue as `completed` when a cited pull
request reads back as merged or `origin/main` contains a cited commit SHA**
(`scripts/issue/already-done-citation.ts`); the label stays, and a
reopen undoes the close. **Anything else leaves it OPEN with the label**, the reason printed:
`epic:next`, `backlog:next` and `auto-ok:next` stop offering the Issue
(`scripts/issue/issue-labels.ts` → `NOT_DIRECTLY_RUNNABLE_LABELS`, `epic-classify.ts` → `human`),
`epic:busy` stops counting it, and a person closes it.

**Commit nothing, push nothing, open no pull request** — run one command; it posts the evidence,
applies `already-done` and closes the Issue when the citation checks, and releases the hold, in that
order, stopping at a failed comment or label; a failed close leaves the labelled Issue OPEN and
still releases the hold:

```bash
pnpm josh issue:already-done <N> --evidence-file .josh/tmp/evidence.md
```

**The evidence file names the merging pull request or commit and, per acceptance criterion, the
`file:line` that satisfies it.** **A claim with no citations is not the finding this exit is for.**

A closed Issue ends the run. A labelled one is handled like a parked child: a typed `fullrun` /
`halfrun` sends a `confirmation` Telegram naming the Issue and the covering merge, and stops; a
`backlogrun` child is park-and-continue (`backlogrun-park.md` → "park and continue"). **Never close
it by any other path** — Tier C.

**Looking familiar is no license to skip the work**: a criterion you cannot point at merged code for is
one this run still owes.

## A measurement-only Issue

**Every criterion is a measurement, so no pull request closes it** → `pnpm josh issue:measured <N>
--evidence-file .josh/tmp/evidence.md` (per criterion, the result and its run), never a bare comment: an OPEN child is
parked `run:stalled`. Invoking `fullrun` / `backlogrun` authorizes this close. `docs/josh-commands-backlog.md` → "`josh issue:measured`".

## A long thread

**The fetch is one call; what costs is carrying it** — hence the projection to author, timestamp and
body. A thread longer than the Issue is the pre-implementation reading `delegation.md` describes: brief
a unit to return **the agreements in force plus the comment URLs that carry them**, never the text.

**Under Claude Code the hook prepends the comments to a line that opens with a body-only `gh api` read
and refuses every other body-only read; the Codex adapter refuses them all** (`prompts/collaboration-workflow/rule-delivery.md`).
**This file is the rule, not the hook** — a session without hooks still owes the read.

## A person's update mid-run

When the hook, `review:attest --check` or `followup` shows an Issue update, read it as above, fix what it
changes, then `pnpm josh issue:ack <N>`. A withheld-body notice (author without write access) needs no ack. The watch: `docs/josh-commands-backlog.md` → "`josh issue:ack`".
