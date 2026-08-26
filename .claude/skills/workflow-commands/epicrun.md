# `epicrun` — Unattended execution of an epic's children

`epicrun #<E>` runs an epic to completion without a person watching it. Read `fullrun.md`,
`chain-rule.md` and `followup.md` as well — each child is a `fullrun` — and read this file for what
running many of them unattended changes.

**Today the epic and its children must live in the repository the session is standing in.**
`josh epic:next` refuses `owner/repo#E` outright rather than reading the number out of it, because
reading it would answer about *this* repository's issue of that number. The cross-repository form —
`epicrun joshuafolkken/kit#858` from an app-kit checkout — arrives with joshuafolkken/kit#864, which
owns resolving a child in another repository. Everything below is written so that lands as a
widening rather than a rewrite.

## What one invocation approves

**One `epicrun` approves every merge in the epic**, plus pushes to more than one repository and the
issues the run files itself. That is the point of the keyword: `queue` re-asks for authorization
every child, which is what forces a person to stay at the machine.

It does **not** approve anything outside the epic. A Tier C action still stops — for that child.

## Concurrency: one child per repository, repositories in parallel

Execution state lives on GitHub and nowhere else (`epic:next`, joshuafolkken/kit#860), so **an
`epicrun` need not be a single session.** One session per repository; each calls
`josh epic:next <E> --repo <owner/repo>` and runs only its own repository's children.

```bash
# In the kit checkout
pnpm josh epic:next 858 --repo joshuafolkken/kit
```

**Until joshuafolkken/kit#864 lands, that is one session**: `epic:next` reads the epic and every
child from the checkout it runs in, so a second session in another repository has nothing of that
epic to find. The `--repo` flag and the per-repository bundling are already in place, so #864 widens
this rather than replacing it — and the reasoning below is what that widening has to preserve.

**No locking is needed, and none is implemented.** Each session takes only its own repository's
children, and within a repository children run one at a time, so two sessions cannot reach for the
same child. That property comes entirely from the per-repository scoping — **the moment a later epic
allows two children of the same repository to run at once, it disappears, and that epic has to
introduce real mutual exclusion.** Do not read this section as "concurrency needs no coordination".

Why same-repository parallelism is out of scope here: `josh bump minor` would have two children
rewriting one `package.json`, one checkout cannot hold two branches without worktrees, and two
children touching the same files need conflict prediction. **Every one of those reasons is specific
to sharing a repository.** Across repositories the manifests are different files, the checkouts are
already separate, no file is shared, and Actions runs are independent — so none of them apply, and
cross-repository parallelism is in scope.

Parallelism only helps children that do not depend on each other. When app-kit's child needs kit's
new feature, that is recorded as `blocked-by` and `epic:next` makes it wait. That is the dependency,
not a limit of the model.

## Audit before the first child

Run `pnpm josh epic:audit <E>` before step 1 below. An epic whose children contradict each other —
an acceptance criterion that needs something built later, two children each waiting on the other —
stalls the moment the run reaches the contradiction, and unattended is the worst time to find that
out. Errors stop the run; warnings are read and carried on past. Fixing what it finds is Tier A
(joshuafolkken/kit#870).

## The loop

`josh epic:next <E> --repo <this repository>` prints **one token** on standard output: an issue
number when there is a child to run, otherwise the verdict. Everything else goes to standard error,
so the token is what a shell captures.

```bash
answer=$(pnpm josh epic:next 858 --repo joshuafolkken/kit)
```

1. Run the command above.
2. **A number** — run that child exactly as `fullrun #<N>` does, through the verification gate and
   the merge, then go back to step 1.
3. **`wait`** — sleep the polling interval and go back to step 1. This also covers "another
   repository has work but this one does not", which is a wait from here.
4. **`stop`** — report the parked children and finish.
5. **`complete`** — post the epic summary and finish.
6. **Exit code 1** — `epic:next` refused a cyclic or contradictory graph, or could not read a child.
   Report and finish.

## park and continue

When a child hits something this run may not decide — a Tier B toss-up, a Tier C action, an upstream
defect, a split that needs a person — **park the child and keep going.**

```bash
gh issue edit <N> --add-label "needs-decision"
gh issue comment <N> --body "<what needs deciding, and the options>"
```

Then return to step 1. The other children are unaffected unless they depend on this one, and
`epic:next` works that out.

**Parking replaces stopping the session, not the rule that produced the stop.** An upstream defect
is still filed immediately and unconditionally (Tier A for a first-party target), and a workaround
is still forbidden. What changes is the blast radius: the child waits, the run continues.

**Removing the label is Tier A — do it without asking.** When the decision is recorded (joshuafolkken/kit#862
writes it to the epic's `## Decisions`), remove the label and re-run `epicrun`; the state is on
GitHub, so the run picks up where it left off.

```bash
gh issue edit <N> --remove-label "needs-decision"
```

Without this the parked child never runs again — it is the second half of the human-in-the-loop
cycle, not an optional tidy-up.

## `in-progress` is removed by whoever finds it stale

Nothing in the codebase removes `in-progress`; a normal finish closes the issue, so it never
mattered. An interrupted run leaves it behind, and a child that carries it is excluded from every
future `epic:next` — permanently. **A session that detects a stale child removes the label itself**
(Tier A) and reports it, before continuing the loop.

```bash
gh issue edit <N> --remove-label "in-progress"
```

## Waiting, and never waiting forever

| Setting | Value | Why |
| --- | --- | --- |
| Polling interval | 60 s | A child's `fullrun` takes minutes; a shorter poll only spends API quota. |
| Stale `in-progress` | 90 min | Longer than any single child has taken; past it, the other session is gone. |
| Publish wait | 10 min | `josh propagate`'s own budget (joshuafolkken/kit#863). A failed publish never appears. |
| Whole run | 8 h | An unattended run that has not finished overnight needs a person, not more waiting. |

Each timeout **ends the wait and reports** — none of them is retried indefinitely. A stale child's
label is removed first (above), so the next poll can offer it.

`epic:next` does not report when a label was applied, so read that from the issue's timeline:

```bash
gh api "repos/{owner}/{repo}/issues/<N>/timeline" \
  --jq '[.[] | select(.event == "labeled" and .label.name == "in-progress") | .created_at] | last'
```

An empty answer means the label predates what the timeline returns, which is itself past the
window — treat it as stale.

Waiting is decided by `epic:next`'s classification, never by reading labels:

| `epic:next` says | `epicrun` does |
| --- | --- |
| Something is runnable | Run it |
| Nothing runnable, something resolves on its own | **Wait** |
| Nothing runnable, nothing resolves on its own, children remain | **Stop and report the parked children** |
| No open child | Finish |

The distinction is not academic. When kit's child has closed and app-kit's child is waiting for the
release to publish, there is no runnable child, nothing carries `in-progress` and nothing carries
`needs-decision` — a label-based reading calls that "done" and stops, in the one moment it must wait.

## Splitting a child mid-run

Discovering that a child is really several is not a reason to stop. File the new children (Tier A
for a first-party repository — no confirmation), add them to the epic's task list, and record the
dependencies. Use the same split criteria as `kickoff` (joshuafolkken/kit#865). If what remains of
the original child needs a person, park **that** child and move on.

## Guards

| Guard | Limit | On reaching it |
| --- | --- | --- |
| Children per run | 30 | Stop and report; an epic this large should be split. |
| Issues filed per run | 10 | Stop and report; a run filing more than this has lost the plot. |
| Consecutive child failures | 3 | Stop and report; something is wrong with the environment, not the children. |

A failure that is not consecutive parks its child and the run continues.

## Who sends the summary, and who propagates

With several sessions on one epic, **exactly one does the end-of-epic work: the session standing in
the repository that owns the epic.** It sends the epic completion summary, and it runs
`josh propagate` (joshuafolkken/kit#863) — which itself refuses to run outside the supplier
repository, so the two rules agree. Every other session finishes quietly when its own repository has
no children left.

Per-child completion notifications are unchanged: `pnpm josh followup --merge` sends one each, as in
any `fullrun`.

Send an epic **start** notification when the run begins, and an epic **completion** summary at the
end naming what was merged, what was parked and why, and what was filed.

## Stopping conditions

`epicrun` stops only here:

1. `epic:next` reports `complete` — the summary has been sent.
2. `epic:next` reports `stop` — every remaining child needs a person; report them.
3. `epic:next` reports `error` — a cyclic or contradictory graph.
4. A guard above was reached.
5. A timeout above elapsed.

**A child that needs a decision is not on this list.** It is parked, and the run continues.
