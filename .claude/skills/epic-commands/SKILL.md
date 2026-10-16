---
name: epic-commands
description: Procedures for `josh epic:audit`, `epic:next` and `epic:bundle`. Read it before running one, before an epic tracks a child in another repository, when `epic:bundle` places a filed issue, and when recording a decision on a `needs-decision` child.
---

# The `josh epic:*` commands

The workflow keywords themselves — `kickoff`, `fullrun`, `halfrun`, `prrun`, `backlogrun` — live in the
`workflow-commands` skill.

## The order they run in

```
epic:audit → find contradictions across the children, and fix what it finds (Tier A)
backlogrun → which calls epic:next each round
```

Front-loading every `needs-decision` is `backlogrun`'s job: `backlogrun-steps.md` → "Resolve what
the plan can resolve, before starting". A `backlogrun #E --only`'s pre-check is `epic:audit`.

Read `execution-waves.md` only when children need an order between groups (a wave boundary, or a child
that must run alone), and `epic-bundle.md` only when a filing's `epic:bundle` answer places the issue.

## Recording a decision

Record it in both places: the epic's `## Decisions` log, and a comment on each child it applies to.
Recording a decision removes that child's `needs-decision` label (Tier A; `backlogrun-park.md` →
"park and continue").

- **Decided as a child joins the epic**: `pnpm josh epic --add … --decision-file` writes both
  (`epic-bundle.md`).
- **About a child the epic already tracks**: that flag refuses an insertion with nothing to add.
  Comment on each child with `pnpm josh issue:comment <N> --body-file <path>`, and **say in the report
  that the epic's `## Decisions` entry is still pending**.

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

A split into two or more issues always gets an epic (`prompts/collaboration-workflow/issue-template.md`),
created with the command, never by hand:

```bash
pnpm josh epic "<epic-title>" <N1> <N2> ...            # order-free batch
pnpm josh epic "<epic-title>" <N1> <N2> ... --ordered  # argument order is the dependency order
# --rationale-file <path|-> fills Split rationale; --origin <owner/repo#N> adds the backlink
```

After any hand edit run `pnpm josh epic:check <E>` (exit 1 when the body no longer parses).
`pnpm josh followup` closes the epic once every task-list child is closed; one tracking a
cross-repository child is closed by hand. Without `josh`: `issue-template.md`.

## `josh epic:audit <E>` — contradictions across the children

`epic:check` verifies the format; this verifies the children agree. Run it **without being asked**
when a `backlogrun` starts a named epic's children, and right after a child is added or a dependency
changed. Cycle and declaration checks are reused from `epic:next`; it adds:

| Check | Level |
| --- | --- |
| A child's body names another child, nothing orders the two | warning |
| A child's **acceptance criteria** name another child, nothing orders the two | **error**; a warning once both are closed or when the pair spans two repositories — the child is still offered as runnable until the relation is recorded |
| A body cites a missing or already-closed issue | warning |
| A task-list row points at another **epic** | warning — `epic:next` already withholds the row; a person should look |
| An issue names this epic as parent that the task list does not track | warning |
| The search for those issues could not read the open backlog | **error** |
| That search stopped before the end of the backlog | warning |

**Only errors fail it** (exit 1). A forward reference the other child already depends on is not
reported. A pair is demoted to a warning only when the closed state is **confirmed** (any state but
`CLOSED` normalizes to `OPEN`).

**Fixing what it finds is Tier A** — fix it and record why on the issue. Park with `needs-decision`
only for a design choice nobody has made.

The two `orphan search` findings are about the search, not the children:

- `✖ orphan search: Could not list the open issues…` — **re-run the audit**; nothing to fix or decide.
  If it keeps failing, check `gh auth status` and the rate limit.
- `⚠ orphan search: The open-issue scan hit its …` — only the newest 500 issues (or 50 bodies) were
  covered; the audit passes. Look further by hand if an orphan is expected.

**It cannot check** that when a child introduces a new label, command, state or artifact, some child
owns updating the existing code referencing that concept — do that at planning. Label names live in
`scripts/issue/issue-labels.ts`.

## `josh epic:next <E…>` — what is runnable

Returns **every** runnable child, bundled per repository with its local checkout. `--repo <owner/repo>`
narrows to one and prints a single token (an issue number or the verdict); `--lanes` beside it prints
one number per line, **up to the number of free lanes in that repository**.

- **Several epics answer as one**: every argument before the first flag is an epic; their runnable
  children merge into one pool per repository. **Priority is the order the epics were named**, then
  each epic's own task-list order (its declared chain still decides what is runnable).
- **Reorder with `pnpm josh epic --add <E> <N> --order-before <M>`** (or `--order-after <M>`), never a
  hand edit; declarations and `blocked-by` relations stay as they were. Moving a row does not free a
  child a chain still holds — the command prints a ⚠️ line instead.
- **A child two epics track enters once**, kept by the epic named earlier.
- **One unusable graph refuses the whole answer**; **one reference that does not parse fails the
  read**. Worked form: `docs/josh-commands-backlog.md` → "`josh epic:next`".

**An `in-progress` issue occupies a lane, not the repository.** Free lanes are `JOSH_LANE_LIMIT`
(**default 4**) minus that repository's `in-progress` listing. At zero the answer is `wait`, with the
holders on standard error. A parked child releases its lane; a `needs-human-review` stop keeps it.

**A child that is itself an epic is never offered** and waits on a *person*. The test is the child's
`epic` label, never how its row is written: a cross-repository `owner/repo#N` row that is not an epic
stays runnable. **A parent epic over another epic never auto-closes** (a grandchild's merge never
reaches it); `epic:audit` reports the row.

Children that are not runnable are sorted by **whether waiting helps**, never by label:

| Bucket | Caller does |
| --- | --- |
| Runnable | Run it |
| Waiting on time | Wait and ask again |
| Waiting on a person | Stop and report |

**A blocker outside every named epic is weighed**: closed, it resolves (cross-repository: after its
release); open and tracked by an epic named in the same call, the child waits on time (or on a person,
if the blocker does); open and untracked, the child waits on a person and the blocker is named on
standard error; an unknown state reads as waiting. **Order two epics with a native `blocked-by`
relation and name both** — `epic:next <E1> <E2>`, or `backlog:next`.

Two things stop the command: a **circular dependency**, and a **disagreement between the epic body
and the `blocked-by` relations**. Only a line that is *nothing but* a chain is a declaration — a prose
line recommending an execution order is a suggestion, not a dependency.

## Epics that span repositories

Write cross-repository children as `owner/repo#N` or a full issue URL. Their state is read through
`gh api`, so **no local clone is needed to learn it** — only to implement.

- **The owner restriction is inherited unchanged**: a different owner is never a target.
- **The epic auto-closes only when every cross-repository child's state could be read.**
- **An epic in another repository is referenced as `owner/repo#N`** — `backlogrun
  joshuafolkken/kit#<E> --only`, `epic:next joshuafolkken/kit#<E> --repo joshuafolkken/app-kit`. A
  bare `#N` is this repository's issue.
- **`epic:next` prints each candidate's local checkout**; none prints `(no local checkout)` and is
  **never cloned on its own**.

**A cross-repository dependency resolves only when the blocker is closed and the version its default
branch declares is in the registry** (checked in that order; that exact version). A child no longer
bumps the version, so the target is the release that includes the blocker. **Unless that repository
publishes nothing**: no `package.json` on its default branch, or `private`, resolves on close — read
from its manifest, never the registry; a failed manifest read (not a 404) still waits. The publish
check is `josh propagate`'s.

## `josh epic:bundle <N>` — does this new issue belong with one already filed?

Runs right after any filing; **`pnpm josh issue:file` runs it as its last step** — run it by hand only
when that step printed `⚠`. **It recommends; it writes nothing.**

| Candidates | Do | Tier |
| --- | --- | --- |
| **The new issue itself already has an epic** | Nothing — an issue belongs to at most one | — |
| Already a child of an epic | Add to **that** epic; do not create a second | A |
| Spread across an epic and its **own parent** | Add to the inner epic — the parent already contains it | A |
| Spread across **different** epics | **Choose the one you recommend, add to it, and record why** | **A** |
| In no epic, two or more counting the new issue | Create an epic | A |
| No strong signal | Nothing | — |
| **The epic listing was cut short** | **Nothing** — every placing row above is withheld | — |

**A placing answer is acted on with `epic-bundle.md`**. `Nothing to bundle.` needs no further read.
