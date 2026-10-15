# An Issue's comments are part of the Issue

**The single source of the comment read**, read before implementing a `#N` Issue. Rationale and
history: `docs/maintainers/issue-comments-rationale.md` → "Why comments are read".

**Every `#N` entry point reads the Issue's comments before it implements** — `fullrun`, `halfrun` and
`kickoff`; a `backlogrun` named issue and epic child inherit it through `fullrun`. One call, in the same
turn as whatever else the run needs:

```bash
pnpm josh issue:read <N> [<N> ...]     # body and comments, one call per batch
gh api repos/{owner}/{repo}/issues/<N>/comments --jq '.[] | {user: .user.login, created_at, body}'
```

**Type the first line**; it **says when a comment listing could not be read rather than showing no
comments**. The `gh api` form is for a **cross-repository** read (the command takes no `--repo`). Never
`gh issue view <N> --comments` — GraphQL-backed, `403` in a cloud session.

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
  Issue is Tier C.

Everything else, **a widened scope included**, is ordinary work; a widening into several
separately-mergeable deliverables is the split assessment's business (`split-assessment.md`).

## When the work turns out to be already merged

**A comment says so, or the run itself verifies it** by finding every acceptance criterion already
satisfied in merged code — one procedure either way. **Parking it is not the place**: `needs-decision`
means "waiting for an answer", and here the answer exists.

**The exit is the `already-done` label.** `epic:next`, `backlog:next` and `auto-ok:next` stop offering
the Issue (`scripts/issue/issue-labels.ts` → `NOT_DIRECTLY_RUNNABLE_LABELS`, `epic-classify.ts` →
`human`), and `epic:busy` stops counting it. **Only a person removes it, by closing the Issue.**

```bash
gh api repos/{owner}/{repo}/labels -f name=already-done -f color=6f42c1 -f description="Verified already merged — a person closes it" --silent 2>/dev/null || true
gh api repos/{owner}/{repo}/issues/<N>/labels -f 'labels[]=already-done'
```

1. **Record the evidence as an Issue comment, before the label**: the merging pull request or commit
   and, per acceptance criterion, the file and lines that satisfy it. **A claim with no citations is not
   the finding this exit is for.**
2. **Apply `already-done`** — the two commands above.
3. **Commit nothing, push nothing, open no pull request.** Release the hold with
   `pnpm josh run:release <N>`, which also removes `in-progress`.
4. **Then behave as the entry point does for a parked child.** A typed `fullrun` / `halfrun` sends a
   `confirmation` Telegram naming the Issue and the covering merge, and stops; a `backlogrun` child is
   park-and-continue (`backlogrun-park.md` → "park and continue").
5. **Never close the Issue** — Tier C at every entry point.

**Looking familiar is no license to skip the work**: a criterion you cannot point at merged code for is
one this run still owes.

## A long thread

**The fetch is one call; what costs is carrying it** — hence the projection to author, timestamp and
body. A thread longer than the Issue is the pre-implementation reading `delegation.md` describes: brief
a unit to return **the agreements in force plus the comment URLs that carry them**, never the text.

**`pnpm josh rule:guard` refuses the body-only read** (`prompts/collaboration-workflow/rule-delivery.md`).
**This file is the rule, not the hook** — a session without hooks still owes the read.

## A person's update mid-run

When the hook, `review:attest --check` or `followup` shows an Issue update, read it as above, fix what it
changes, then `pnpm josh issue:ack <N>`. The watch: `docs/josh-commands-backlog.md` → "`josh issue:ack`".
