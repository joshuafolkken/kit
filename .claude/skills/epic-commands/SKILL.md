---
name: epic-commands
description: The procedures for the `josh epic:*` commands that make an epic runnable without a person watching — `epic:plan` (front-load every decision into one batch), `epic:audit` (find contradictions across the children), `epic:next` (what is runnable, per repository), and `epic:bundle` (does a newly filed issue belong with one already in the backlog). Also how an epic spans repositories and why a cross-repository dependency waits for a publish. Read this before running any of those commands, before writing an epic that tracks a child in another repository, and right after filing an issue.
---

# The `josh epic:*` commands

These four commands are what turn an epic from a list of issue numbers into something a run can
execute unattended. The canonical extended reference is `prompts/collaboration-workflow.md`; this
skill is the operational procedure, and the two must agree.

The workflow keywords themselves — `kickoff`, `fullrun`, `halfrun`, `queue`, `epicrun` — live in the
`workflow-commands` skill.

## The order they run in

```
epic:plan  phase 0 → epic:audit, and fix what it finds (Tier A)
           phase 1 → read the plan, triage every decision: auto / ask / defer
           phase 2 → put every `ask` as ONE question for the whole epic
           phase 3 → epicrun, which calls epic:next each round
```

## `josh epic:plan <E>` — one batch of decisions

Prints every child's number, title, body, labels, `blockedBy` and state as one JSON document.

Most of the stops an implementation makes could have been answered before it started. Arriving
scattered is what forces a person to wait through the run; asking per child asks the same question
several times; and the answers end up only in a conversation nobody can read back.

- **Phase 0 is not optional.** A batch decision made on a plan that contradicts itself has to be made
  again once the contradiction surfaces.
- **Triage:** `auto` (Tier A — decide it), `ask` (Tier B/C — collect it), `defer` (out of scope —
  file it).
- **Phase 2 is one question for the whole epic**, never one per child.
- Record each answer in **both** the epic's `## Decisions` and a comment on each child it applies to.
  One without the other leaves either the child's reader without the reasoning or the epic without
  the decision.
- **Recording a decision removes that child's `needs-decision` label** (Tier A). Without it the child
  stays parked after the answer arrived.

```md
## Decisions

### <the point that was decided>

- 対象: #101, #102
- 採用: <the option taken>
- 却下: <the option rejected>
- 理由: <why the taken option is clearly better>
- 決定日: <YYYY-MM-DD>
```

An epic whose task list tracks nothing is an empty plan, not a failure. An epic whose *body could not
be read* is a failure — an empty plan there is indistinguishable from a finished one.

## `josh epic:audit <E>` — contradictions across the children

`epic:check` verifies one epic's *format*. Nothing verified that the children agree, and a hand audit
of a real epic found two contradictions that would have stalled the implementation while
`epic:check` reported every requirement as passing.

Run it **without being asked**: at the start of an `epicrun`, as `epic:plan`'s phase 0, and right
after a child is added or a dependency changed.

The cycle and declaration-mismatch checks are `epic:next`'s, reused rather than re-derived. What this
adds is reading *inside* the children:

| Check | Level |
| --- | --- |
| A child's body names another child, nothing orders the two | warning |
| A child's **acceptance criteria** name another child, nothing orders the two | **error** |
| A body cites a missing or already-closed issue | warning |
| An issue names this epic as parent that the task list does not track | warning |

**Only errors fail it.** The first check fires on a legitimate forward reference as readily as on a
real missing dependency; failing on both would make design notes unwritable. A forward reference the
other child *already depends on* is not reported at all.

**Fixing what it finds is Tier A** — re-pointing a dependency or correcting prose is reversible and
will otherwise stall the work. Park with `needs-decision` only when the contradiction is a design
choice nobody has made.

**One thing it cannot check** belongs to planning: when a child introduces a new label, command,
state or artifact, list the existing code referencing that concept and confirm some child owns
updating it. Label names are single-sourced in `scripts/git/issue-labels.ts`.

## `josh epic:next <E>` — what is runnable

Returns **every** runnable child, bundled per repository with the local checkout to run it in.
`--repo <owner/repo>` narrows to one and prints a single token: the issue number, or the verdict.

Children that are not runnable are sorted by **whether waiting helps**, never by label:

| Bucket | Caller does |
| --- | --- |
| Runnable | Run it |
| Waiting on time | Wait and ask again |
| Waiting on a person | Stop and report |

Reading labels instead fails in an ordinary state: when one repository's child has closed and
another's is waiting for a release to publish, nothing carries `in-progress` or `needs-decision` —
and a label-based reading calls that "done" in the one moment it must wait.

Two things stop the command rather than being worked around: a **circular dependency**, and a
**disagreement between the epic body and the `blocked-by` relations** (routine, since `gh` older than
2.94.0 cannot record a relation at all). Only a line that is *nothing but* a chain counts as a
declaration — a prose line recommending an execution order is a suggestion, not a dependency.

## Epics that span repositories

Write cross-repository children in the task list as `owner/repo#N` or a full issue URL. Their state
is read through `gh --repo`, so **no local clone is needed to learn it** — only to implement.

- **The owner restriction is inherited unchanged**: a repository with a different owner is never a
  target, by any route.
- **The epic auto-closes only when every cross-repository child's state could actually be read.** One
  unreadable child leaves it open, exactly as before.
- **An epic in another repository must be referenced as `owner/repo#N`** — `epicrun
  joshuafolkken/kit#858`. A bare `#N` resolves to *this* repository's issue of that number.

**A dependency that crosses a repository is not satisfied by the blocking issue closing.** Merging
does not publish: the merge, the auto-tag and the publish run one after another, so a consumer told
it may start at that moment installs the previous release or fails outright — "it breaks sometimes",
the hardest kind to diagnose. It resolves only when the blocker is closed **and** the version its
default branch declares has appeared in the registry.

**The evaluation is an AND in that order.** While the blocker is open the registry is never
consulted, so a run never stalls on a publish from the moment it starts. The target is that exact
version, never "something newer" — a consumer several releases behind would otherwise be satisfied by
a publish that predates the change.

## `josh epic:bundle <N>` — does this new issue belong with one already filed?

Run it right after an issue is filed: by `kickoff` / `fullrun` / `halfrun`, or by any Tier A filing
mid-implementation, including inside an `epicrun`. **It recommends; it writes nothing.**

"Two or more always means an epic" only fires when one request is split on the spot. Two issues filed
days apart that turn out to be the front and back of one job are executed separately, in whatever
order, with the reasoning recorded nowhere.

**Only two things count as a signal**: the issues referring to each other in prose, or a `blocked-by`
already recorded between them. **A similar title never counts on its own** — "related" expands
without limit, and the threshold is what keeps an unrelated issue out.

**The search is not limited to the open backlog.** Every issue number the subject's body names is read
on its own, whatever its state — otherwise the command answers correctly only in the minutes between
a follow-up issue being filed and its parent closing (joshuafolkken/kit#947). A **closed** reference
counts only when an open epic already tracks it, since the answer worth recovering is `add_to_epic`;
an epic created over a closed issue has nothing left to run. An **open** reference counts either way.
A read that fails — and a reference the per-issue cap never reached — is reported as a gap, never
folded into "no strong signal". A number that answers with a **pull request** is not a candidate at
all: `gh issue view` serves one too, and a merged PR does not report `CLOSED`.

**A number that does not exist is not a gap.** A typo, or another repository's number quoted in
prose, is dropped in silence — neither a candidate nor something the command reports it could not
read. Reported as a gap it puts `⚠ Could not read #N.` above the verdict, and the rule below stops an
unattended run on exactly that, for a reference that never existed (joshuafolkken/kit#957). **The two
are told apart by HTTP status, never by `gh`'s wording**: 404 is nothing at that number, 403 and 429
are a rate limit. GitHub answers 404 for an issue the token may not see as well, so as not to leak
its existence — which does not reach this command, because it probes the repository whose open issues
it has just listed. The probe costs one REST request and runs **only** when a read has already
failed, and only on the path that needs the distinction: the backlog's own relation reads, up to two
hundred of them, never pay it.

| Candidates | Do | Tier |
| --- | --- | --- |
| **The new issue itself already has an epic** | Nothing — an issue belongs to at most one | — |
| Already a child of an epic | Add to **that** epic; do not create a second | A |
| Spread across **different** epics | **Stop and ask** | **B** |
| In no epic, two or more counting the new issue | Create an epic | A |
| No strong signal | Nothing | — |

Bundling is reversible; merging epics is not, which is the one branch that asks.

**When the relation carries an order, record it** in `blocked-by` and in the epic's `Dependencies` —
on an addition as much as on a new epic. Without it the batch survives and the reason for it does
not. An order **nobody declared is not invented**.
