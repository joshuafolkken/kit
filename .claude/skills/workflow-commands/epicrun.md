# `epicrun` — Unattended execution of an epic's children

`epicrun #<E>` runs an epic to completion without a person watching it. Read `fullrun.md`,
`chain-rule.md` and `followup.md` as well — each child is a `fullrun` — and read this file for what
running many of them unattended changes.

It also accepts an Issue that is **not** an epic; see "When `#N` is not an epic" below.

**An epic in another repository must be referenced as `owner/repo#E`** — `epicrun
joshuafolkken/kit#858` from an app-kit checkout. A bare `#858` resolves to *this* repository's issue
858, a different issue entirely, so the qualification is required rather than optional
(joshuafolkken/kit#864).

## When `#N` is not an epic

`epicrun` accepts an ordinary Issue as well as an epic. `epicrun #<N>` on an Issue with no task list
runs `#<N>` as a `fullrun` — the same plan, verification gate, PR and merge — and then finishes.

The point is *when* the person is involved. Typing `epicrun` up front is the batch authorization
given once, before anything is known; `fullrun` is the authorization for one Issue, which is why a
`fullrun` that discovers a split has to stop and ask for the batch one. Both amount to a single
human action — this one just spends it at the start, for work already expected to grow
(joshuafolkken/kit#892).

So inside `epicrun #<N>`, a prerequisite or a split found mid-run does **not** stop the run:

1. File the new Issue(s) — no confirmation; the batch was already approved by the keyword.
2. **Stash the work in progress and remove `in-progress` from `#<N>`**, exactly as steps 2 and 4 of
   "A prerequisite discovered mid-run" do — `git stash push -u -m "..."` with the `-u` (a new
   `*.test.ts` is untracked), the `gh issue comment <N>` that records the stash so whatever resumes
   `#<N>` knows to pop it, and `gh issue edit <N> --remove-label "in-progress"`. The reasons are the
   same two: the tree is dirty on the default branch and the next child begins with `git switch main
   && git pull`, and `epic:next` classifies a child carrying `in-progress` as waiting on time
   **before** it consults any blocker, so `#<N>` would never be offered again and the epic would
   stall. **The path is new; the mechanics are not, and none of them is optional here.**
3. **Ask `pnpm josh epic:bundle <N>` whether an epic already tracks `#<N>` before creating one.** It
   names the epic (`#893 already tracks this issue`) rather than only reporting that one exists. A
   bare Issue handed to `epicrun` can already be somebody's epic child — nothing stops
   `epicrun #943` on a child of `#893` — and creating a second epic over it gives the auto-close two
   task lists to disagree about, on the entry point that runs with nobody watching
   (joshuafolkken/kit#943).

   | Answer | What to do |
   | --- | --- |
   | An epic `#<E>` already tracks `#<N>` | `pnpm josh epic --add <E> <P> --before <N>` for a prerequisite, or `--add <E> <N1> ...` for a split. **Do not create a second epic.** Continue the loop against `#<E>` |
   | No epic tracks it | Create one — the command depends on what was found (table below) |
   | **The command could not answer** | Park `#<N>` with `needs-decision` and report. "Could not tell" is not "no epic tracks it", and reading it as such recreates the duplicate this step prevents |

   When creating one, `#<N>` is being implemented, so it is itself one of the deliverables — which is
   why this path always takes the keep-as-a-child arm of `split-assessment.md`'s promote-or-create
   branch, rather than choosing between the two. **Which command depends on what was found**, because
   `--ordered` makes the argument order the dependency chain:

   | Found | Command |
   | --- | --- |
   | A prerequisite `<P>` | `pnpm josh epic "<title>" <P> <N> --ordered` — the prerequisite comes **first**; reversing them records the inverse `blocked-by` and the run implements the deliverable before the thing it needs |
   | A split into independent children | `pnpm josh epic "<title>" <N> <N1> ...` — **no `--ordered`**, which would serialize children that have no order and record `blocked-by` relations nobody declared |
   | A split whose children do have an order | `pnpm josh epic "<title>" ... --ordered`, arguments written in that order |

4. **Run `pnpm josh epic:audit <E>` now**, not earlier. The audit below is written for a run that
   starts from an epic; on this path there is no epic until step 3, and `epic:audit` refuses an
   Issue with no task list exactly as `epic:next` does — running it against the bare `#<N>` would
   stop the run at its first step, which is the opposite of what this entry point is for.
5. **Do not stop.** Continue into the loop below against the new epic `#<E>`.

**Nothing found means no epic.** If `#<N>` reaches its merge without a prerequisite or a split
turning up, the run finishes there. An epic is created only when there is a second child to put in
it — an epic holding one closed Issue is noise that the auto-close then leaves open.

**Every guard below applies on this path unchanged** — 30 children, 10 Issues filed, 3 consecutive
failures. They are the run's limits, not the epic's, and the whole reason this entry point removes a
confirmation is that the guards are what remain.

**This does not let `fullrun` promote itself.** The widening belongs to `epicrun` alone, because
`epicrun` is where the batch was authorized. A `fullrun` that discovered a split and built an epic
around itself would merge a batch on one Issue's authorization — it still files the children and the
epic and then **stops** (`split-assessment.md` → "Finding a split mid-run stops the run").

**`josh epic:next` is not changed by any of this.** It still refuses an Issue with no task list, and
still prints `#<N> tracks no children in a task list.` — the acceptance of a bare Issue belongs to
`epicrun`, which has not built an epic yet at that point and therefore never asks `epic:next` about
one.

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

A child in another repository is read through `gh --repo`, so no clone is needed to learn its state —
only to implement it. `epic:next` prints the local checkout for each repository's candidates, from
joshuafolkken/kit#869's map; a repository with no checkout here says so rather than being cloned.

**A dependency that crosses a repository is not satisfied when the blocking issue closes.** Merging
kit's issue does not publish kit, so a consumer child told it may start at that moment installs the
previous release, or fails outright. Such a dependency resolves only once the blocker is closed *and*
its release has appeared in the registry — and while the blocker is still open the registry is never
consulted, so a run never sits waiting on a publish from the moment it starts.

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

Run `pnpm josh epic:audit <E>` before step 1 below. **When the run began from a bare Issue there is
nothing to audit yet** — it has no task list, and `epic:audit` refuses one just as `epic:next` does;
that path runs the audit at the moment it creates the epic instead (above). An epic whose children contradict each other —
an acceptance criterion that needs something built later, two children each waiting on the other —
stalls the moment the run reaches the contradiction, and unattended is the worst time to find that
out. Errors stop the run; warnings are read and carried on past. Fixing what it finds is Tier A
(joshuafolkken/kit#870).

## `josh latest` runs once per session, not once per child

`josh latest` belongs to the **session**, not to a child. Run it once, the first time the loop below
hands back a child number — before implementing that child — and never again:

```bash
git stash            # only if the working tree has staged or modified files
git switch main && git pull
pnpm josh latest
git stash pop        # only if you stashed above
```

Then load the `dependency-update` skill and follow its procedure, exactly as `queue` does — the
overrides in **both** `pnpm-workspace.yaml` and `package.json`, and the one expected `devEngines`
pnpm bump. The stash is the same sanctioned one `queue` step 1 uses; without it `josh latest` runs
on a dirty tree.

**Session, not run** — the two differ whenever an epic spans repositories. Each session runs one
repository's children (above), so each one updates its own checkout: a second session that read
"once per run" and skipped it would merge that repository's children against stale dependencies and
never run `pnpm audit` there.

**Waiting until a child is in hand is what keeps the tree clean.** Run it before the first
`epic:next` instead and a run whose first answer is `wait`, `stop` or `complete` — an ordinary
outcome on a resumed run — leaves a rewritten `pnpm-lock.yaml` modified on the default branch with
nothing to commit it, which the next `git pull` then refuses to merge over.

A child's own `fullrun` requires `josh latest` before implementing, so following the loop literally
runs it once per child. That is what this section overrides, and the reason is not the seconds it
costs: **each run rewrites `pnpm-lock.yaml`, so every child's PR carries dependency updates that
have nothing to do with that child.** `/code-review` and CodeRabbit then read that diff, a CI
failure caused by an unrelated bump is attributed to the child — parking it, unattended, for a
defect it does not have — and the eslint cache key in `.github/workflows/ci.yml`
(`hashFiles('pnpm-lock.yaml')`) misses on every PR.

**The lock file the update rewrites lands with the first child.** `josh latest` leaves
`pnpm-lock.yaml` modified, and the first child's `pnpm josh git -y` commits it — so that one PR
carries the dependency bumps, exactly as the first issue of a `queue` does. What the hoist removes
is the other N-1 children carrying them; it does not make the first child's diff clean. Should the
first child then fail CI on a bump rather than on its own change, that is a dependency problem
found once — fix it forward before the child is parked for it.

**`git switch main && git pull` stays per child.** It is not hoisted with `josh latest`: it is what
brings the previous child's merge into the tree, and a child that skips it starts implementing on a
stale main. Only the dependency update moves to the run.

This is the same rule `queue.md` step 1 already states — `josh latest` once, before the first issue,
mandatory and never skipped. Two entry points to the same serial batch now read the same way; they
disagreed before (joshuafolkken/kit#913).

**A resumed `epicrun` is a new session**, so it runs `josh latest` once again before its first
child. The state that decides which children remain lives on GitHub, and the tree the resumed
session finds may be days old.

## The loop

`josh epic:next <E> --repo <this repository>` prints **one token** on standard output: an issue
number when there is a child to run, otherwise the verdict. Everything else goes to standard error,
so the token is what a shell captures.

```bash
answer=$(pnpm josh epic:next 858 --repo joshuafolkken/kit)
```

1. Run the command above.
2. **A number** — run that child as `fullrun #<N>` does, through the verification gate and the
   merge, **except that `josh latest` is not run** — it runs once, before this session's first
   child, and not again (above).
   `git switch main && git pull` still runs, per child. Then go back to step 1.
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

## A prerequisite discovered mid-run

Finding that something else in **this** repository has to land first is not a split, and not an
upstream defect. The child in hand is still one deliverable; it just needs another one before it.
It gets its own procedure because the two rules it sits between both end in a stop, and this one
must not (joshuafolkken/kit#891).

`<M>` below is the child being implemented when the prerequisite turned up; `<N>` is the new Issue.

1. File the prerequisite Issue `<N>` — Tier A for a first-party repository, no confirmation. It is
   filed **first** because the next step has to name it, and its number does not exist until it is.
2. **Stash the work in progress.** A child is implemented on the default branch with an uncommitted
   tree — `pnpm josh git` only creates the branch at commit time — so `<M>`'s half-finished edits are
   sitting there, and the next child's `git switch main && git pull` would either refuse or carry
   them into the prerequisite's branch and PR.

   ```bash
   git stash push -u -m "epicrun: paused #<M> for prerequisite #<N>"
   gh issue comment <M> --body "<what was stashed, and that #<N> must land first>"
   ```

   **`-u` is not optional**: a child's work almost always includes a new `*.test.ts`, which is
   untracked, and a stash without `-u` leaves exactly those files behind — the failure this step
   exists to prevent. The comment is what makes the paused state auditable, exactly as the
   upstream-interrupt rule requires, and it is what tells the session that resumes `<M>` that a stash
   is waiting for it. `git stash pop` when `epic:next` offers `<M>` again, after its
   `git switch main && git pull` — the prerequisite has merged by then, so expect to resolve
   conflicts rather than to apply cleanly.

3. `pnpm josh epic --add <E> <N> --before <M>` — one command writes the task-list row, the
   declaration and the `blocked-by` relation together (joshuafolkken/kit#890). Never edit the body
   by hand: the declaration and the relations then disagree, `epic:next` returns `error`, and the
   unattended run stops outright.
4. **Remove `in-progress` from `<M>`.**

   ```bash
   gh issue edit <M> --remove-label "in-progress"
   ```

   This is not tidying — it is what lets `<M>` run again. `epic:next` classifies a child carrying
   `in-progress` as waiting on time **before** it looks at any blocker, so a child left labelled is
   never offered again however long the run waits, and the epic stalls the moment the prerequisite
   merges. Nothing in the codebase removes the label; the session that stopped working on the child
   is the one that has to.

5. **Do not park.** Go back to step 1 of the loop. `epic:next` classifies the original child as
   resolving on its own and hands back the prerequisite first, so the order is kept with no human
   input at all.

**Parking is only for a prerequisite that cannot be expressed as a dependency** — one that needs a
design decision nobody has made, or that is a Tier B toss-up or a Tier C action. Parking one that
*can* be expressed inverts the whole point: `needs-decision` is cleared by a person, so a park taken
in the name of unattended execution is what makes the run need a person.

## Splitting a child mid-run

Discovering that a child is really several is not a reason to stop. File the new children (Tier A
for a first-party repository — no confirmation), then add them with `pnpm josh epic --add <E> <N...>
[--before <M> | --after <M>]` rather than editing the epic body by hand — for the reason above. Use
the same split criteria as `kickoff` (joshuafolkken/kit#865). If what remains of the original child
needs a person, park **that** child and move on.

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
