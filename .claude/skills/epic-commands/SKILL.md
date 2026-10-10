---
name: epic-commands
description: Procedures for `josh epic:audit`, `epic:next` and `epic:bundle`. Read it before running one, before an epic tracks a child in another repository, when `epic:bundle` places a filed issue, and when recording a decision on a `needs-decision` child.
---

# The `josh epic:*` commands

These three commands are what turn an epic from a list of issue numbers into something a run can
execute unattended. **This skill is their single source**; where each rule came from is
`docs/maintainers/epic-commands-rationale.md` → "Where each rule came from".

The workflow keywords themselves — `kickoff`, `fullrun`, `halfrun`, `prrun`, `backlogrun` — live in the
`workflow-commands` skill.

## The order they run in

```
epic:audit → find contradictions across the children, and fix what it finds (Tier A)
backlogrun → which calls epic:next each round
```

Front-loading every `needs-decision` in one pass is `backlogrun`'s job, not a command of this skill:
`backlogrun-steps.md` → "Resolve what the plan can resolve, before starting". A `backlogrun #E --only`'s
pre-check is `epic:audit`.

**Two references are read only when their case arises**: `execution-waves.md` when an epic's children
need an order between groups (a wave boundary, or one child that must run alone), and
`epic-bundle.md` when a filing's `epic:bundle` answer places the issue.

## Recording a decision

**A decision is recorded in two places, and one without the other loses half of it.** The epic's
`## Decisions` log carries the decision; a comment on each child it applies to carries the reasoning
for that child's reader. **Recording a decision removes that child's `needs-decision` label** (Tier A);
the label-clearing rule itself is `backlogrun-park.md` → "park and continue".

- **A decision taken *as* a child joins the epic** goes through `pnpm josh epic --add … --decision-file`
  — `epic-bundle.md` is that flag's single source, and it writes both halves at once.
- **A decision about a child the epic already tracks** cannot use that flag: an insertion with nothing
  to add is refused outright. Until an entry point for already-tracked children exists, write the
  child comments with `pnpm josh issue:comment <N> --body-file <path>` on each child the answer
  applies to, and **say in the report that the epic's `## Decisions` entry is still pending**.

```md
## Decisions

### <the point that was decided>

- 対象: #<N1>, #<N2>
- 採用: <the option taken>
- 却下: <the option rejected>
- 理由: <why the taken option is clearly better>
- 決定日: <YYYY-MM-DD>
```

## Creating an epic

A split into two or more issues always gets an epic (`prompts/collaboration-workflow/issue-template.md`).
Create it with the command, never by hand-writing the body:

```bash
pnpm josh epic "<epic-title>" <N1> <N2> ...            # order-free batch
pnpm josh epic "<epic-title>" <N1> <N2> ... --ordered  # argument order is the dependency order
# --rationale-file <path|-> fills Split rationale; --origin <owner/repo#N> adds the backlink
```

The body format is the command's output, and `pnpm josh epic:check <E>` answers whether a body still
meets it (the parser auto-close reads; exit 1 on a miss) — run it after any hand edit. `pnpm josh
followup` closes the epic once every task-list child is closed; one tracking a cross-repository child
is closed by hand. The by-hand fallback where `josh` is unavailable: `issue-template.md`; the format's
reasons and the history: `docs/maintainers/epic-commands-rationale.md` → "Creating an epic by hand".

## `josh epic:audit <E>` — contradictions across the children

`epic:check` verifies one epic's *format*; this verifies that the children agree.

Run it **without being asked**: when a `backlogrun` starts a named epic's children, and right
after a child is added or a dependency changed.

The cycle and declaration-mismatch checks are `epic:next`'s, reused rather than re-derived. What this
adds is reading *inside* the children:

| Check | Level |
| --- | --- |
| A child's body names another child, nothing orders the two | warning |
| A child's **acceptance criteria** name another child, nothing orders the two | **error**; a warning once both children are closed, and a warning when the pair is in two repositories. A warning there does **not** mean the pair is safe: the child is still offered as runnable, and recording the relation is what clears it |
| A body cites a missing or already-closed issue | warning |
| A task-list row points at another **epic** | warning — `epic:next` withholds the row, so the batch is already safe; what is left is a thing a person has to look at |
| An issue names this epic as parent that the task list does not track | warning |
| The search for those issues could not read the open backlog | **error** |
| That search stopped before the end of the backlog | warning |

**Only errors fail it** (exit 1); a warning leaves the exit code alone and is for the reader to judge
— the first check fires on a legitimate forward reference as readily as on a missing dependency. A
forward reference the other child *already depends on* is not reported at all.

**A pair with either child closed is a warning, not an error**, and **the demotion needs the closed
state confirmed**: `epic_issue.normalize_state` maps every state but `CLOSED` (`MERGED` included) to
`OPEN`, so a state that could not be confirmed stays an error.

**Fixing what it finds is Tier A** — re-pointing a dependency or correcting prose is reversible and
will otherwise stall the work, so fix it without asking and record why on the issue. Park with
`needs-decision` only when the contradiction is a design choice nobody has made.

**The two `orphan search` findings are the exception, because neither is a contradiction.** They are
about the search itself rather than about anything the children say:

- `✖ orphan search: Could not list the open issues…` — the search never ran, so "no orphans" would
  be a claim about a listing that never arrived. It fails the audit, which stops the epic's run at its
  step 0. **Re-run the audit**; that is the whole response. There is nothing to fix and nothing to
  decide, so neither Tier A nor a `needs-decision` park applies. If it keeps failing, check
  `gh auth status` and whether the rate limit has reset.
- `⚠ orphan search: The open-issue scan hit its …` — the search covered only the newest part of the
  backlog (500 issues, or 50 bodies mentioning the epic). It ran, so the audit passes; read the line,
  and look further down the backlog by hand if an orphan is expected there.

**One thing it cannot check** belongs to planning: when a child introduces a new label, command,
state or artifact, list the existing code referencing that concept and confirm some child owns
updating it. Label names are single-sourced in `scripts/issue/issue-labels.ts`.

History: `docs/maintainers/epic-commands-rationale.md` → "`epic:audit` — why the children are read across".

## `josh epic:next <E…>` — what is runnable

Returns **every** runnable child, bundled per repository with the local checkout to run it in.
`--repo <owner/repo>` narrows to one and prints a single token: the issue number, or the verdict.
`--lanes` beside it prints one issue number per line instead, **up to the number of free lanes in
that repository** — so a caller that reads one token keeps reading one token.

**It takes more than one epic, and they answer as one.** Every leading argument is an epic
reference — the split is on the first flag, so `epic:next 858 909 --repo X --lanes` reads two — and
their runnable children merge into one candidate pool per repository, so six free lanes fill from
every named epic rather than from whichever was typed first. **The priority order is the order the
epics were named.** **Inside one epic the order is that epic's own task list**: its declared chain
still decides which children are *runnable*, and among those, the order the task list names them is
the order they are offered — so an epic says "do this one first" by moving the row, not by declaring
a chain, which would stop every child behind a stuck one.
**`pnpm josh epic --add <E> <N> --order-before <M>` is what moves that row**: the row goes where the
flag names, and the declaration and the `blocked-by` relations are left exactly as they stood — so
"moving the row" is a command rather than the hand edit `epic --add` exists to prevent.
`--order-after <M>` is its other direction, and both work on a child the epic already tracks, which
is a pure reorder. **A child a chain still holds is not freed by moving its row**: `epic:next`
filters by `blocked-by` before it applies task-list order, so the command prints a ⚠️ line naming
that child rather than reporting a reordering nothing can observe. **A child two epics both track
enters once**, keyed by `owner/repo#number` and kept by the epic named earlier; withheld there, it
stays withheld, because a `blocked-by` relation belongs to the issue rather than to the epic listing
it. **One unusable graph refuses the whole answer**, and **one reference that does not parse fails
the read** rather than being dropped. `docs/josh-commands-backlog.md` → "`josh epic:next`" carries the
worked form.

**An `in-progress` issue occupies a lane rather than the whole repository.** The occupancy is counted
from that repository's own `in-progress` listing — never from anything the session remembers — and
what is left of `JOSH_LANE_LIMIT` (**default 6**) is what gets offered. At zero the answer is `wait`
and the holders are named on standard error. A parked child releases its lane; one stopped by
`needs-human-review` goes on holding one, because its uncommitted work is still in that checkout.

**A child that is itself an epic is never offered** — an epic is not a unit of work. It waits on a
*person*, because no amount of waiting turns an epic into work. **The test is the child's `epic`
label, never how its task-list row is written**: a row naming `owner/repo#N` is a different property
and a legitimate one — it disables the epic auto-close by design, which is why a cross-repository
backlink is prose rather than a row — so a cross-repository child that is not an epic stays
runnable, and one that is an epic is withheld exactly like a local one. **A parent epic over another
epic never auto-closes**: the auto-close evaluates only the epics whose own task list holds the issue
a merge just closed, and a grandchild merging never reaches the grandparent. `epic:audit` reports the
same row, with that consequence in the finding.

Children that are not runnable are sorted by **whether waiting helps**, never by label:

| Bucket | Caller does |
| --- | --- |
| Runnable | Run it |
| Waiting on time | Wait and ask again |
| Waiting on a person | Stop and report |

**A blocker outside every named epic is weighed, not ignored.** Closed, it resolves (a
cross-repository one still waits for its release); open and tracked by any epic named in the same
call, the child waits on time unless that blocker itself waits on a person, which the child
inherits; open and tracked by none, the child waits on a person and the blocker is named on standard
error; a state the relation did not carry reads as waiting. **So an order between two epics is
recorded with a native `blocked-by` relation and honoured by naming both epics** — `epic:next <E1>
<E2>`, or `backlog:next`, whose set is the whole opted-in backlog. The table is
`docs/josh-commands-backlog.md` → "`josh epic:next`".

Two things stop the command rather than being worked around: a **circular dependency**, and a
**disagreement between the epic body and the `blocked-by` relations** (an epic written before `josh`
recorded them, a recording that failed, or a relation hand-added since). Only a line that is
*nothing but* a chain counts as a declaration — a prose line recommending an execution order is a suggestion, not a dependency.

Why it orders and counts as it does: `docs/maintainers/epic-commands-rationale.md` → "`epic:next` — why it answers as it does".

## Epics that span repositories

Write cross-repository children in the task list as `owner/repo#N` or a full issue URL. Their state
is read against that repository through `gh api`, so **no local clone is needed to learn it** — only
to implement.

- **The owner restriction is inherited unchanged**: a repository with a different owner is never a
  target, by any route.
- **The epic auto-closes only when every cross-repository child's state could actually be read.** One
  unreadable child leaves it open, exactly as before.
- **An epic in another repository must be referenced as `owner/repo#N`** — `backlogrun
  joshuafolkken/kit#<E> --only`, `epic:next joshuafolkken/kit#<E> --repo joshuafolkken/app-kit`. A
  bare `#N` resolves to *this* repository's issue of that number. A cross-repository epic exists in
  one repository only.
- **`epic:next` prints each candidate's repository and local checkout** from the repository discovery
  map; a repository with no checkout prints `(no local checkout)` and is **never cloned on its own**.

**A dependency that crosses a repository is not satisfied by the blocking issue closing** — merging
does not publish. It resolves only when the blocker is closed **and** the version its default branch
declares has appeared in the registry.

**Unless that repository publishes nothing.** A repository with no `package.json` on its default
branch, or one declaring `private`, ships no release for the check to wait on, so a closed blocker
there resolves. The answer is read from the blocker repository's own manifest and never from the
registry (a registry 404 also means "this token may not see it"). A manifest read that fails (rather
than answering 404) is told apart by HTTP status and still waits.

**The evaluation is an AND in that order.** While the blocker is open the registry is never
consulted, so a run never stalls on a publish from the moment it starts. The target is that exact
version, never "something newer". **A child no longer bumps the version**: the version moves only
when `pnpm josh release` runs, so the target is the release that includes the blocker, not the
default branch's version just after its merge (the previous release). The publish check shares
`josh propagate`'s implementation; it is not defined twice. History:
`docs/maintainers/epic-commands-rationale.md` → "Cross-repository epics".

## `josh epic:bundle <N>` — does this new issue belong with one already filed?

It runs right after an issue is filed: by `kickoff` / `fullrun` / `halfrun`, or by any Tier A filing
mid-implementation, including inside a `backlogrun`. **`pnpm josh issue:file` runs it as its last step**;
run it by hand only when that step printed `⚠`. **It recommends; it writes nothing.**

| Candidates | Do | Tier |
| --- | --- | --- |
| **The new issue itself already has an epic** | Nothing — an issue belongs to at most one | — |
| Already a child of an epic | Add to **that** epic; do not create a second | A |
| Spread across an epic and its **own parent** | Add to the inner epic — the parent already contains it | A |
| Spread across **different** epics | **Choose the one you recommend, add to it, and record why** | **A** |
| In no epic, two or more counting the new issue | Create an epic | A |
| No strong signal | Nothing | — |
| **The epic listing was cut short** | **Nothing** — every placing row above is withheld | — |

**A placing answer is acted on with `epic-bundle.md`** — what counts as a signal, the cut listing,
choosing between epics, and the `--decision-file` record that pays for the choice. `Nothing to
bundle.` needs no further read.

History: `docs/maintainers/epic-commands-rationale.md` → "`epic:bundle` — why issues filed apart are bundled afterwards";
the reasons behind `epic-bundle.md`: `docs/maintainers/epic-commands-rationale.md` → "`epic:bundle` — why each answer reads as it does";
behind `execution-waves.md`: `docs/maintainers/epic-commands-rationale.md` → "Execution waves — why a wave is not a mechanism".
