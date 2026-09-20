# An Issue's comments are part of the Issue

**This is the body of `SKILL.md` §2g, relocated here so the entry read carries the trigger and the
pointer, not the procedure** (joshuafolkken/kit#2189). `SKILL.md` §2g is the resident stub, and every
`#N` entry file routes here for the definition. It is read at its point of use — before implementing a
`#N` Issue.

**Every `#N` entry point reads the Issue's comments before it implements** — `fullrun`, `halfrun` and
`kickoff`. A `backlogrun` named issue and a `backlogrun` epic child inherit it rather than restate it: each runs in a
delegated unit executing `fullrun`'s procedure, and the hook keys its once-per-run record on the
*fork's* transcript, so every child is delivered to in its own right. The read is one call, made in the
same turn as whatever else the run already needs:

```bash
pnpm josh issue:read <N> [<N> ...]     # body and comments, one call per batch; alias: josh ird
gh api repos/{owner}/{repo}/issues/<N>/comments --jq '.[] | {user: .user.login, created_at, body}'
```

**The first line is the one to type**; `pnpm josh issue:read` answers the body and the comments for
every number named, in one call, and **says when a comment listing could not be read rather than
showing no comments** — which matters here, because the rule below is that the later text wins and a
comment nobody read cannot win anything. The `gh api` form stays for a **cross-repository** read: the
command takes no `--repo`.

`gh issue view <N> --comments` is GraphQL-backed, a cloud session is answered `403`, and
`scripts/gh/gh-document-guard.test.ts` refuses it in a runnable block. The REST call above is the portable
form.

**This repository writes its agreements into comments and then reads only bodies.** A Tier A decision
is logged as an Issue comment; the review round cap records a dropped finding's disposition; the
backlog's decision pass writes each decision to a comment on the child; a stash left behind is recorded on the Issue. **The
place a run is told to write is the place it was never told to read**, and nothing in a body says it
has been superseded, so the mistake is silent.

**What the reading is for**, so it is not skimmed: the boundary of the scope — work a comment moved to
another Issue, or added to this one; the record of an auto-decision already made; a split or epic
agreement reached after filing; a recorded stash or an in-flight branch; and a **correction of the
body's own diagnosis**.

## When a comment contradicts the body

**The later text is the agreement in force.** A body is written first and is not rewritten when a
decision arrives, so of a body and a comment that disagree the comment is the newer of the two and
wins. **This is settled by ordering, never by judging which reads better.** Name in the two-layer work
summary which comment superseded what.

**Two answers are not the run's to make, and each is decided from what the comment says:**

- **A comment that reassigns part of the scope to another Issue** takes that part out of scope: do not
  implement it, whatever acceptance criteria the body still lists, and name the Issue it went to in the
  completion report.
- **A comment saying the Issue no longer has a reason to exist** — the defect does not reproduce, or it
  was fixed elsewhere — takes the exit in the next subsection, "When the work turns out to be already
  merged". Closing an Issue is Tier C.

Everything else is the ordinary work of the run, **a widened scope included**: a widening large enough
to be several separately-mergeable deliverables is the split assessment's business
(`split-assessment.md`), not a second kind of stop.

## When the work turns out to be already merged

**A run can learn its Issue is already done in two ways, and both end here.** A **comment** says so —
the bullet above — or the **run itself verifies it**, by reading the merged code and finding every
acceptance criterion already satisfied. What is left to do afterwards is identical, so there is one
procedure and not two. **Parking it is not the place**: `needs-decision` means "waiting for an answer
nobody has given", and here the answer exists.

**The exit is the `already-done` label.** It is `needs-decision`'s counterpart: `epic:next`,
`backlog:next` and `auto-ok:next` all stop offering the Issue (`scripts/git/issue-labels.ts` →
`NOT_DIRECTLY_RUNNABLE_LABELS`, `epic-classify.ts` → `human`), and `epic:busy` stops counting it as
holding a lane. **Only a person removes it, by closing the Issue.**

```bash
gh api repos/{owner}/{repo}/labels -f name=already-done -f color=6f42c1 -f description="Verified already merged — a person closes it" --silent 2>/dev/null || true
gh api repos/{owner}/{repo}/issues/<N>/labels -f 'labels[]=already-done'
gh api -X DELETE repos/{owner}/{repo}/issues/<N>/labels/in-progress 2>/dev/null || true
```

The procedure, in order:

1. **Record the evidence as an Issue comment, before the label.** Name the pull request or commit that
   merged the work and, for each acceptance criterion the Issue states, the file and lines that satisfy
   it. **A claim with no citations is not the finding this exit is for.**
2. **Apply `already-done` and remove `in-progress`** — the two commands above. Leaving `in-progress`
   on holds a lane against an Issue nothing will ever run.
3. **Commit nothing, push nothing, open no pull request.** The tree is clean, so release the hold with
   `pnpm josh run:release <N>`.
4. **Then behave as the entry point does for a parked child.** A `fullrun` / `halfrun` a person typed
   sends a `confirmation` Telegram naming the Issue and the merge that already covers it, and stops. An
   `backlogrun` child is park-and-continue (`backlogrun-park.md` → "park and continue").
5. **Never close the Issue.** That is Tier C at every entry point, and the label leaves the close one
   click away for the person who owns it.

**Nothing about this is a license to skip the work when it merely looks familiar.** The bar is step 1's
citations: a criterion you cannot point at merged code for is a criterion this run still owes.

## A long thread

**The fetch is one call however long the thread is; what costs is carrying it afterwards** — which is
why the call above projects each comment down to its author, its timestamp and its body. Once the
thread runs longer than the Issue itself it is exactly the pre-implementation reading §2b describes:
brief a delegated unit to return **the agreements in force plus the comment URLs that carry them**,
never the comment text.

**`pnpm josh rule:guard` refuses the body-only read** and hands over the reissue and the conflict rule
at the moment they bind (`prompts/collaboration-workflow/rule-delivery.md`,
`scripts/rules/delivered-rules.test.ts`). The refusal reaches Claude Code alone and fires once per run,
so **this file is the rule and the hook is what makes it hard to walk past** — a session that runs
no hooks still owes the read.
