# `epicrun` — Unattended execution of an epic's children

`epicrun #<E>` runs an epic to completion without a person watching it. Read `fullrun.md`,
`chain-rule.md` and `followup.md` as well — each child is a `fullrun` — and read this file for what
running many of them unattended changes.

**What it changes about `queue` is the blast radius of a stop.** `queue` makes each issue's explicit
invocation its safety valve, so **a decision needed mid-implementation stops the whole session** —
and because nothing predicts *when* a child will need one, a person has to stay at the machine for
the length of the run. `epicrun` **sets aside only the child that needs the decision and moves on to
the others** (see "park and continue" below). That is what the keyword buys: the same guards, with
the blast radius of a stop reduced from the session to one issue. What each keyword *authorizes* is
a separate axis, and it is "What one invocation approves" below.

It also accepts an Issue that is **not** an epic; see "When `#N` is not an epic" below.

**An epic in another repository must be referenced as `owner/repo#E`** — `epicrun
joshuafolkken/kit#858` from an app-kit checkout. A bare `#858` resolves to *this* repository's issue
858, a different issue entirely, so the qualification is required rather than optional
(joshuafolkken/kit#864).

That qualification is not a form of its own: it is the `owner/repo#` prefix every entry point takes, and the definition is the same at every entry point — `SKILL.md` → "2c. The `owner/repo#` prefix". What it names here is where the *epic* lives; how the children are divided between sessions is "Concurrency" below.

## When `#N` is not an epic

`epicrun` accepts an ordinary Issue as well as an epic. `epicrun #<N>` on an Issue with no task list
runs `#<N>` as a `fullrun` — the same plan, verification gate, PR and merge — and then finishes.

The point is *when* the person is involved. Typing `epicrun` up front is the batch authorization
given once, before anything is known; `fullrun` is the authorization for one Issue, which is why a
`fullrun` that discovers a split has to stop and ask for the batch one. Both amount to a single
human action — this one just spends it at the start, for work already expected to grow
(joshuafolkken/kit#892).

So inside `epicrun #<N>`, a prerequisite or a split found mid-run does **not** stop the run:

1. File the new Issue(s) with the matching route label — `route:split` for a split, `route:tier-a` for a prerequisite (joshuafolkken/kit#1083) — no confirmation; the batch was already approved by the keyword.
2. **Stash the work in progress and remove `in-progress` from `#<N>`**, exactly as steps 2 and 4 of
   "A prerequisite discovered mid-run" do — `git stash push -u -m "..."` with the `-u` (a new
   `*.test.ts` is untracked), the `gh api repos/{owner}/{repo}/issues/<N>/comments` post that records the stash so whatever resumes
   `#<N>` knows to pop it, and `gh api -X DELETE repos/{owner}/{repo}/issues/<N>/labels/in-progress 2>/dev/null || true`. The reasons are the
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
   | **The command could not answer** — a non-zero exit, or a ⚠ warning about a truncated listing above a `Nothing to bundle.` verdict. The truncation warning is the one beginning `⚠ The epic listing …`, in either of two forms — `hit its …-epic cap` and `stopped at the …-issue page ceiling` — both saying the listing was not read to the end (joshuafolkken/kit#1067); `⚠ Could not read #N.` is one failed relation read and voids nothing. A definitive answer stands even beside a warning | Park `#<N>` with `needs-decision` and report. "Could not tell" is not "no epic tracks it", and reading it as such recreates the duplicate this step prevents |

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

It does **not** approve anything outside the epic, **except the issues a person has opted in with
`auto-ok`** — that label is the person's act, not the run's, which is what keeps the widening an
authorization rather than a self-authorization (see "After the epic" below). A Tier C action still
stops — for that child.

## Each child runs in a delegated unit

**A child is not run in the parent loop's context.** One child goes to an isolated execution unit,
and only its summary comes back (joshuafolkken/kit#984). The measurement is why: across one
`epicrun` that ran seven children in one context, the context averaged 99,789 over the first twenty
requests and 698,928 over the last twenty, and the same 490 requests broken every 50 — about one
child — would have billed 33% of what they did.

**The mechanism is not new.** It is the one joshuafolkken/kit#969 defined — the enumeration plus
`pnpm josh delegate` — with the unit changed from one step of a run to one child of an epic.
Building a second is the clone `CLAUDE.md` prohibits. Ask the command rather than deciding:

```bash
pnpm josh delegate epic-child   # → delegate
```

**The parent reads GitHub, never the summary.** That is `epic-child`'s verifier, and it is the whole
reason the unit may be delegated at all: a unit that reports a child finished without its PR merged
leaves that child open, and `pnpm josh issue:state <N>` says so in one call. The child's own
gate, `/code-review` and CI run inside the unit, and `pnpm josh followup --merge` will not touch the
PR until they are green. **Never advance the loop on the summary alone** — that discards the
verifier, and without it `epic-child` is not a delegatable unit.

**Read the state directly rather than asking `epic:next` again.** A child that did not finish still
carries `in-progress`, and `epic:next` classifies such a child as waiting on time before it consults
any blocker — so it answers `wait`, not the number, and a loop that took that as its check would
poll to the 90-minute stale window instead of learning that the child failed.

**The merge authorization reaches the unit.** The batch a person approved by typing `epicrun` covers
the unit that runs each child (joshuafolkken/kit#986 → `## Decisions`). Delegating changes which
context spends that authorization, not how far it reaches.

**So does the explicit invocation, and the brief is what carries it.** `CLAUDE.md` → "Explicit
invocation required" forbids starting a `fullrun`-shaped run that was never typed, and a unit
holding that rule with nothing to point at would refuse, return the child open, and be booked as a
failure. What the rule forbids is **inferring** a workflow from the shape of a request; it is not
a requirement that the keystroke land in the unit's own transcript. **The brief therefore names the
invocation it descends from** — `epicrun #<E>`, the child number, and that the child is to be run as
`fullrun #<N>` under that authorization. Written that way there is nothing to infer, which is the
whole of what the rule asks. A brief that omits it is the defect: the unit is then guessing, and
refusing is the correct answer to a guess.

**Where no isolated unit exists, run the child in the parent's context.** The hand-off below is what
covers that case — it is the backstop for delegation being unavailable, not an alternative to it.

## Concurrency: one child per repository, repositories in parallel

Execution state lives on GitHub and nowhere else (`epic:next`, joshuafolkken/kit#860), so **an
`epicrun` need not be a single session.** One session per repository; each calls
`josh epic:next <E> --repo <owner/repo>` and runs only its own repository's children.

```bash
# In the kit checkout
pnpm josh epic:next 858 --repo joshuafolkken/kit
```

A child in another repository is read against that repository through `gh api`, so no clone is
needed to learn its state — only to implement it. `epic:next` prints the local checkout for each
repository's candidates, from joshuafolkken/kit#869's map; a repository with no checkout here says
so rather than being cloned.

**A dependency that crosses a repository is not satisfied when the blocking issue closes.** Merging
kit's issue does not publish kit, so a consumer child told it may start at that moment installs the
previous release, or fails outright. Such a dependency resolves only once the blocker is closed *and*
its release has appeared in the registry — and while the blocker is still open the registry is never
consulted, so a run never sits waiting on a publish from the moment it starts.

**Unless that repository publishes nothing** (joshuafolkken/kit#1129). A repository with no
`package.json` on its default branch, or one declaring `private`, ships no release for the check to
wait on — so a closed blocker there resolves rather than waiting until the run's own eight-hour
timeout with nothing an operator can edit to clear it. The answer is read from the blocker
repository's own manifest and never from the registry: a registry 404 also means "this token may not
see it", so resolving on one would start a consumer child before its blocker's release existed.

**The exclusion is per repository, and `epic:next` is what applies it.** When
`josh epic:next --repo <owner/repo>` has a child to offer, it first asks that repository whether
anything is already running there: **any** open issue carrying `in-progress` and not parked makes
the answer `wait` — whichever epic that issue belongs to, and whether or not this epic tracks it at
all (joshuafolkken/kit#925). Two limits are part of the definition rather than gaps in it. It is
asked **only when there is a candidate**, so `stop` and `complete` are still answered while
something is in progress — neither of them is about to start anything. And a **parked** issue does
not hold the repository: `needs-decision` outranks `in-progress` here exactly as it does in the
classification, or `park and continue` would hand the repository to the child it just set aside.

**It is advisory and it is not atomic.** The label is applied by whoever is about to implement a
child, *after* this read — so two sessions starting in the very same instant can both read an idle
repository and both be handed the same child. What the check closes is the window that actually
occurs: a session already running a child holds the label for the whole of it, which is minutes,
against a race measured in seconds. Treat it as a guard that makes the invariant mechanical, not as
a mutex.

**It is scoped to the resource, not to the epic.** What two children contend for is one working
tree, one `main` and one `package.json` that `josh bump` rewrites, and none of those cares which
epic a child belongs to. The earlier reasoning here — each session takes only its own repository's
children, and within a repository children run one at a time — was true *inside one epic* and said
nothing about two: `epic-classify.ts` sorts only the children the epic tracks, so a second `epicrun`
started in the same checkout answered "nothing of mine is in progress" and both ran. What actually
serialized them was a person typing the runs one after another, which is a habit rather than a
property of the model.

**A stale label now holds the whole repository, so the stale rule reaches past this epic's own
children.** An interrupted run leaves `in-progress` behind, and that label holds the checkout rather
than one child —
so "`in-progress` is removed by whoever finds it stale" below applies to **any** open issue in the
repository, not only to this epic's children. `epic:next` names the issues holding the repository on
standard error for exactly that reason, and the 90-minute stale window bounds the wait.

**A listing it could not read is not an idle repository.** `epic:next` answers `wait` there rather
than offering the child — reading a failed read as "nothing is running" is the one direction this
guard may not fail in, because that answer *starts* work. It is not an error either: the listing
swallows a passing rate limit into the same failure, so an exit would end an unattended run over a
blip, while a persistent failure is already caught by the unreadable-child anomaly before this read
happens. So the loop polls, and the reason is on standard error. **A listing that was *cut short* is
the same answer** (joshuafolkken/kit#1067): the paging bounds every listing now, and a short one with
no visible holder is still not "nothing is running" — `wait`, with its own message, since clearing a
stale label would not change it.

**Two children of one repository still may not run at once** — the guard makes that mechanical
rather than customary, and it does not make same-repository parallelism safe. An epic that wants it
has to **replace** this guard, with worktrees and a manifest each child can rewrite alone, not merely
switch it off. Do not read this section as "concurrency needs no coordination": the coordination
exists, and it is this.

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
   merge, **in a delegated unit where one is available** (`pnpm josh delegate epic-child` →
   `delegate`; see "Each child runs in a delegated unit" above) and **in this session's own context
   where none is**, **except that `josh latest` is not run** — it runs once, before this session's
   first child, and not again (above).
   `git switch main && git pull` runs per child in whichever context implements it, **and again in
   this session afterwards** when the child was delegated — otherwise the parent's checkout never
   receives that merge and the next child starts on a stale default branch.

   When the unit reports back, **confirm the child from GitHub before believing it**:

   ```bash
   pnpm josh issue:state <N>                          # a child in this repository
   pnpm josh issue:state <N> --repo <owner/repo>      # a child in another one
   # state: CLOSED
   # labels: (none)
   # human_review: no
   ```

   **`--repo` is not optional for a cross-repository child.** Without it the read resolves `<N>`
   against the repository this session runs in, and confirms a completely different issue that
   happens to carry that number — silently, because that issue usually exists.

   `state: CLOSED` is the only answer that means the child finished. **Read the `human_review:` and
   `labels:` lines before calling anything else a failure**, because three different outcomes look
   alike from here — which is why one command prints all of them rather than three reads being made.

   **A non-zero exit is not `OPEN`.** The command exits non-zero without printing a state when the
   number resolves to nothing (`does not resolve`) and when the read itself failed (`could not
   read`), and the second is a rate limit or expired auth rather than anything about the child.
   Treating it as an unfinished child would count an environment fault against the
   consecutive-failure guard. Re-read before deciding.

   - **Open, carrying `needs-decision`** — the unit **parked** it, exactly as this session would
     have. That is not a failure: leave the label on, do **not** count it against the
     consecutive-failure guard, and go back to step 1. Three parks in a row are an ordinary epic,
     and counting them would abort the run as an environment fault.
   - **Open, and `human_review: yes`** — the child **stopped before its commit**, which is the run's
     own ending rather than a failure (§2z). **`Open` is part of the test, as it is for the two
     branches below**: a CLOSED child carrying the label finished and merged, so it is `state:
     CLOSED` and nothing else — reading it as a stop would strand `in-progress` on a closed issue,
     end the epic without its remaining children, and report a stop that never happened over an
     artifact that has already shipped. **Read that line, not the `labels:` one**: GitHub keeps the
     spelling a label was created with, so `Needs-Human-Review` is the same label, and matching the
     lowercase string by eye drops the child into the failure branch below — the label is stripped,
     the stop counts against the consecutive-failure guard, and the next child starts on this one's
     uncommitted tree (joshuafolkken/kit#1132). Leave `in-progress` **on** — the uncommitted
     work is still in the checkout and the child must go on holding the repository — do not park it,
     do not count it against the consecutive-failure guard, and do **not** go back to step 1. Finish
     the session and report. **Do not send a second `confirmation` Telegram** — the unit that ran the
     child already sent one for this stop, and `CLAUDE.md`'s rule is one per stop, not one per
     context that notices it. Where the child ran in this session's own context, that first
     notification is yours to send.
   - **Open, without `needs-decision`** — it failed. Remove the stale `in-progress` here (Tier A,
     per "`in-progress` is removed by whoever finds it stale"), count it against the
     consecutive-failure guard, and **park it** — the Guards table's "a failure that is not
     consecutive parks its child" applies to a delegated child as to any other. Parking is what
     stops the next `epic:next` from handing the same child straight back, retried without limit
     because each success in between resets the counter.

   **Never ask `epic:next` in place of this read.** A child that did not finish still carries
   `in-progress`, which `epic:next` classifies as waiting on time *before* it consults any blocker,
   so it answers `wait` — the loop would poll to the 90-minute stale window and learn nothing.

   Then **ask whether to hand off** — `pnpm josh cost --over 400000`, immediately after the merge and
   `pnpm josh ms` — and go back to step 1 on `under`, or finish the session on `over` (see
   "The hand-off" below).
3. **`wait`** — sleep the polling interval and go back to step 1. This also covers "another
   repository has work but this one does not", which is a wait from here.
4. **`stop`** — report the parked children and finish.
5. **`complete`** — post the epic summary, then run the pickup in "After the epic — issues opted
   in with `auto-ok`" below, and finish.
6. **Exit code 1** — `epic:next` refused a cyclic or contradictory graph, or could not read a child.
   Report and finish.

## The rule-compliance measurement is per child, not per epic

Each child's verification gate runs `pnpm josh eval:scope` and, on `required`, `pnpm josh eval`
(`eval-gate.md`). **`complete` does not run the suite again**, and a drop from the run's starting
measurement is therefore not something this loop computes.

The reason is not the cost. Every child that touched the distribution ran **all** the scenarios and
blocked on a failure, so the gradual degradation an epic-completion run would look for has already
been measured — at `complete` the tree is the one the last document-touching child measured, and a
second measurement of the same state is all that would be bought. It would also need a baseline
carried across children and sessions, which this run keeps nowhere but GitHub, and two `n/m` figures
compared in a suite where `?` is routine would fail an epic on the shared budget rather than on a
regression (joshuafolkken/kit#907).

**So the answer to "an unattended run has no instrument for output quality" is that it has one, and
it fires per child** — on the whole distribution, at merge-blocking strength. An epic that never
touches a distributed document runs it at neither point, which is correct: nothing changed what an
agent reads.

## After the epic — issues opted in with `auto-ok`

An epic's task list is not the whole backlog. An Issue small enough to need no human judgment sits
there forever unless somebody puts it in an epic, and as execution capacity grows the entrance —
what is eligible to be run at all — becomes the bottleneck rather than the running
(joshuafolkken/kit#906). `auto-ok` is the opt-in that widens it.

**Only a person applies `auto-ok`. Never apply it on your own judgement.** `epicrun #<E>` approves
the merges inside `#<E>` and nothing outside it ("What one invocation approves"), and this label is
the only way a person extends that approval past the epic's edge. A label an agent could apply to
itself would let an unattended run widen its own authorization — the self-widening
`split-assessment.md` forbids when it stops a `fullrun` that discovered a split — which is not a
guard at all. **Typing the command for the person is not applying it**: an explicit instruction in
the current turn ("label #912 `auto-ok`") is their decision and yours only to execute. Everything
else, "this one is obviously trivial" included, is a proposal — written as an Issue comment and left
for them.

**The pickup happens once the epic's children are done, and nowhere else.**

| `epic:next` answered | What happens to the pickup |
| --- | --- |
| a number | Run the child. No pickup — the epic's own children come first |
| `wait` | Wait. No pickup: the epic is still resolving, and outside work would run ahead of the batch that was authorized |
| `stop` | Report the parked children and finish. **No pickup** — the epic needs a person, and doing unrelated work instead buries that |
| `error` | Report and finish. No pickup |
| `complete` | Post the epic summary, then pick up below |

A run that began from a bare, non-epic Issue reaches the same point when that Issue merges without a
prerequisite or a split turning up ("Nothing found means no epic"): its authorized work is done, so
the pickup applies there too. One keyword must not mean two things.

**Ask the command which Issue, never `gh` directly.** The label name is single-sourced in
`scripts/git/issue-labels.ts`; typing the string into a `gh` query of your own puts a second copy of
it somewhere nothing checks.

```bash
answer=$(pnpm josh auto-ok:next)                 # the first time
answer=$(pnpm josh auto-ok:next --exclude <N>)   # every time after, naming the one just merged
answer=$(pnpm josh auto-ok:next --exclude <N>,<M>) # or every one this session has already run
```

**`--exclude` is not optional after the first pickup.** GitHub applies the `closes #N` side effect
asynchronously, so for a few seconds after the merge the issue you have just finished is still
listed as open. Without the flag the loop can be handed that same number back and re-implement work
that already shipped; the `in-progress` label happens to exclude it too, but that label is removed
by whoever finds it stale, so it is not something to rely on.

| Answer | What to do |
| --- | --- |
| A number | Run it exactly as `fullrun #<N>` does — delegated unit, verification gate, PR, merge — then ask again. **Unless it carries `needs-human-review`**, which degrades it exactly as it degrades a child: the gate runs, nothing is committed, and the run ends there rather than asking again (§2z) |
| `none` | Nothing is opted in. Finish the run |
| **Exit 1** — the listing could not be read | Report that the pickup could not be attempted, and finish. "Could not tell" is not `none`; reporting it is enough here only because the mistake stops work rather than starting some |

**An issue whose prerequisite is unresolved is never handed over.** The pickup reads the same
GitHub-native `blockedBy` relations `epic:next` builds its dependency graph from, and drops any
candidate declaring a blocker that has not closed. `auto-ok` says "this issue needs no decision" and
says nothing at all about order, so without this an unattended run could start a deliverable before
the thing it needs (joshuafolkken/kit#996).

**The order is the one the person was just shown.** `auto-ok:next` ranks with the same function the
`🗒 Next issues (newest first)` display uses at the end of every workflow — newest first, skipping
`epic`, `in-progress` and `needs-decision`. A second ordering would have the run start something
other than what that list has just named.

**The same ordering, though, is not the same set.** The dependency check above exists only on the
pickup side, so `auto-ok:next` can refuse an issue that `🗒 Next issues` is showing at the top of its
list. That difference is deliberate: a person can see the issue is blocked and decide to start it
anyway, and an unattended run has no such judgement to exercise.

**Everything a child gets, a picked-up Issue gets**: the split assessment, the two-layer work
summary, `josh latest` staying hoisted to the session, park-and-continue, and the
`pnpm josh cost --over 400000` hand-off check after each merge. One that needs a decision is parked
exactly as a child is, and the run asks again — and one carrying `needs-human-review` stops the run
exactly as a child carrying it does, so the pickup does not ask again either.

**The cap is 5 per run**, in the Guards table below. These issues went through no split assessment
as a batch, no `epic:audit` and no dependency graph — the label alone is the whole authorization, so
the cap is the only structural guard on them, and it is deliberately tighter than the epic's 30. On
reaching it, finish and report; the person types `epicrun` again for more.

**The label has to exist before anyone can apply it**, and a missing one is not an error: `gh`
answers an empty listing, `auto-ok:next` says `none`, and the run finishes exactly as it did before
this section existed. Opting in is the default absence. Create the label once per repository that
wants it:

```bash
gh api repos/{owner}/{repo}/labels -f name=auto-ok -f color=0e8a16 -f description="Opted in to unattended execution outside an epic"
```

## The hand-off — one session does not have to run the whole epic

**A session pays for every child it has already run, on every later turn.** What a turn costs is
decided by the accumulated preamble, not by what the turn does: measured across one `epicrun` that
ran six children in one context, the billed input was 222k per request during the first child and
645k during the sixth — the same work at 2.9x the price (joshuafolkken/kit#968). The growth is not
linear in the number of children; the k-th child re-reads the wreckage of the k-1 before it on every
turn.

**So the run hands off when the marginal cost crosses a line, and the line is read, not felt.**

```bash
pnpm josh cost --over 400000
```

It prints `over` or `under` on standard output and the measured figure on standard error. `over`
means the next turn of this session costs more than the threshold in billed input, and the number is
passed explicitly so a run cannot drift it by remembering it wrong.

**閾値 400,000 は計測が出した数字ではない。** joshuafolkken/kit#968 がそう書いたのは誤りで、joshuafolkken/kit#984 で訂正した。計測が支持するのは**ほぼ即座に区切ること**である — 50 リクエスト（≒ 子 1 件）ごとに区切れば課金入力は実測の 33% に収まり、区切り 1 回の費用（新しいセッションで常駐を書き直す約 56,000 ＋ EPIC と子 Issue の読み直し約 15,000 で概ね 70,000 トークン）に対して 1 回あたりの節約は約 14,500,000 トークン、**およそ 200 倍**の開きがある。損益分岐は最初の子の途中で既に超えており、400,000 に達した時点では割高な状態で数百ターン走った後である。

**400,000 が表しているのは、トークンと人の手数の釣り合いである。** 区切るたびに人が `epicrun #<E>` を打ち直すため、計測の答え（子ごとに区切る）をそのまま採ると無人性を失う。トークン対トークンではなく**トークン対人の手数**のトレードオフであり、そう書かれていなかった。

**その釣り合いは、子 1 件を委譲するようになった今の親のループには当てはまらない。** 親の文脈には要約しか積まれないため、この閾値に達すること自体がまれである。現在の 400,000 は、**委譲が使えない環境で親の文脈が膨らんだ場合の保険**として残っている数字であって、計測が導いた最適値ではない。

`over` and `under` are not the only answers: the command also **exits 1 with empty standard output** when there is no transcript, or no request in it. **Neither is `under`.** Reading "could not measure" as "still cheap" is the same mistake as reading an unreadable comment listing as "no findings" — report that the check could not answer, and hand off at that child.


### When to ask, and what to do

**Ask once per child, immediately after its merge and `pnpm josh ms`** — never mid-child. That
moment is the only one where nothing is in flight: the PR is merged, the working tree is on the
default branch and clean, and the epic's state on GitHub is complete. A hand-off taken anywhere else
would have to carry work that is not written down yet.

- **`under`** — go back to step 1 of the loop and run the next child.
- **`over`** — finish the session. Post the epic progress comment naming what merged and what
  remains, send a **`confirmation`** Telegram with the resume command in its body — a hand-off waits
  for the person to type the next command, which is what `confirmation` means; `completion` would
  announce an epic that has not completed — and stop with:

  > Please run `epicrun #<E>` to continue this epic in a fresh session.

  **報告は完了報告の書式で書かない。** 区切りは完了でも park でも失敗でもない**第 4 の停止**であり、専用の書式が `prompts/collaboration-workflow/report-format.md` →「区切りの報告（完了報告と区別する・必須）」にある。`原因 / 対応 / 結果` の 3 行は使わない — それは finished なランの形であり、epic はまだ終わっていない。書くのは 4 つ、**終わったこと / 残っていること / 止めた理由 / 次に打つコマンド**である。Telegram 本文も同じ書式で書く。

**This is not a failure and not a park.** No child needs a decision; the run is simply cheaper to
continue elsewhere. `needs-decision` is not applied, nothing is stashed, and no Issue is filed.

### What carries over, and where it lives

**Nothing is carried in the conversation.** Everything the next session needs it reads back:

| What the next session needs | Where it reads it |
| --- | --- |
| Which children remain, and which is runnable | `pnpm josh epic:next <E>` |
| The order and the dependencies | the epic body |
| What each remaining child is | the child Issue body |
| What already merged | the epic's task list, and the closed children |

That is the same state a resumed run has always used (joshuafolkken/kit#861), which is why the
hand-off needs no new mechanism — it makes deliberate what an interrupted run already did by
accident. **A planned hand-off is strictly more certain than an interruption**: an interruption can
land mid-child with a dirty tree and a stale `in-progress` label, and this cannot, because it is
only ever taken when a child has just closed.

**A resumed session is a new session**, so it runs `josh latest` once before its first child, exactly
as the rule above says.

## `needs-human-review` — the one stop that is not a park

A child carrying **`needs-human-review`** is degraded to a `halfrun`-shaped stop and **the whole run
ends there** — implementation and the verification gate run, nothing is committed, the working tree
is left dirty and unstashed, a `confirmation` Telegram carrying the resume command goes out, and the
remaining children are not started (joshuafolkken/kit#1125).

**This is the exception to park-and-continue below, and it is not an oversight.** Parking works
because the parked child leaves the checkout clean; this child does not. Its uncommitted work is the
artifact a person has to look at, so there is nothing to hand the next child a clean tree with —
which is exactly why the alternative that kept the batch running (commit and open a pull request,
merge nothing) was rejected: it satisfies "a person approves publication" and fails "a person
chooses", and the choosing is what the label exists for on a candidate-selection issue.

**The child goes on holding its repository.** `needs-decision` outranks `in-progress` in the
per-repository exclusion so a parked child releases the checkout; this label deliberately does not,
because releasing it would start the next child on top of uncommitted work.

**Never apply or remove the label** — `auto-ok`'s rule, at `auto-ok`'s strength. Full definition and
the `needs-decision` comparison: `SKILL.md` → §2z, which is the single source.

## park and continue

When a child hits something this run may not decide — a Tier B toss-up, a Tier C action, an upstream
defect, a split that needs a person — **park the child and keep going.**

```bash
gh api repos/{owner}/{repo}/issues/<N>/labels -f 'labels[]=needs-decision'
gh api repos/{owner}/{repo}/issues/<N>/comments -f body="<what needs deciding, and the options>"
```

`in-progress` is left as it is, and the parked child does **not** hold the repository under the
per-repository exclusion above — `epic:next` gives `needs-decision` precedence over `in-progress`
exactly as the classification does, so the next child is offered normally.

Then return to step 1. The other children are unaffected unless they depend on this one, and
`epic:next` works that out.

**Parking replaces stopping the session, not the rule that produced the stop.** An upstream defect
is still filed immediately and unconditionally (Tier A for a first-party target), and a workaround
is still forbidden. What changes is the blast radius: the child waits, the run continues.

**Removing the label is Tier A — do it without asking.** When the decision is recorded (joshuafolkken/kit#862
writes it to the epic's `## Decisions`), remove the label and re-run `epicrun`; the state is on
GitHub, so the run picks up where it left off.

```bash
gh api -X DELETE repos/{owner}/{repo}/issues/<N>/labels/needs-decision 2>/dev/null || true
```

Without this the parked child never runs again — it is the second half of the human-in-the-loop
cycle, not an optional tidy-up.

## `in-progress` is removed by whoever finds it stale

Nothing in the codebase removes `in-progress`; a normal finish closes the issue, so it never
mattered. An interrupted run leaves it behind, and a child that carries it is excluded from every
future `epic:next` — permanently. **A session that detects a stale child removes the label itself**
(Tier A) and reports it, before continuing the loop.

**It costs more than that one child now.** Since the repository-level exclusion above, an open issue
carrying `in-progress` makes `epic:next --repo` answer `wait` for the *whole repository* — so a stale
label stalls every epic that touches that checkout, including one on an issue this epic does not
track. **The rule therefore applies to any open issue in the repository, not only to this epic's
children**, and `epic:next` names the holders on standard error so there is something to go and look
at. **Age alone is not the test.** Check the 90-minute window below *and* look at what is holding it,
because three ordinary states hold the label legitimately for longer than that: a `halfrun` stopped
for manual verification, any run paused mid-child, and a child stopped by `needs-human-review` — that
last one waits on a person reading an artifact, which routinely outlasts ninety minutes, and the
label is carried alongside `in-progress` so the issue says plainly which state it is in. **All three
leave uncommitted work in the checkout** — the `needs-human-review` stop by specification, since it
commits nothing and stashes nothing — so `git status` there is the decisive read: a dirty tree means
the hold is real, and the answer is to leave the label alone and report, never to strip it and start
a second child on top of that work.

```bash
gh api -X DELETE repos/{owner}/{repo}/issues/<N>/labels/in-progress 2>/dev/null || true
```

## Waiting, and never waiting forever

| Setting | Value | Why |
| --- | --- | --- |
| Polling interval | 60 s | A child's `fullrun` takes minutes; a shorter poll only spends API quota. |
| Stale `in-progress` | 90 min | Longer than any single child has taken; past it, the other session is gone. |
| Publish wait | 10 min | `josh propagate`'s own budget (joshuafolkken/kit#863). A failed publish never appears. |
| Whole run | 8 h | An unattended run that has not finished overnight needs a person, not more waiting. |

Each timeout **ends the wait and reports** — none of them is retried indefinitely. A stale child's
label is removed first (above), so the next poll can offer it. **A graph that has deadlocked on a
cycle is not this loop's to untangle**: `epic:next` detects it and exits with an error, so `epicrun`
confines itself to ending the wait and reporting it.

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
| No open child | Post the epic summary, pick up the `auto-ok` issues ("After the epic" above), then finish |

The distinction is not academic. When kit's child has closed and app-kit's child is waiting for the
release to publish, there is no runnable child, nothing carries `in-progress` and nothing carries
`needs-decision` — a label-based reading calls that "done" and stops, in the one moment it must wait.

## A prerequisite discovered mid-run

Finding that something else in **this** repository has to land first is not a split, and not an
upstream defect. The child in hand is still one deliverable; it just needs another one before it.
It gets its own procedure because the two rules it sits between both end in a stop, and this one
must not (joshuafolkken/kit#891). The three-way distinction, the `route:tier-a` filing command and
the filing ceiling are `SKILL.md` → §2d, which is the single source; what follows is this entry's
branch.

`<M>` below is the child being implemented when the prerequisite turned up; `<N>` is the new Issue.

1. File the prerequisite Issue `<N>` with the `route:tier-a` label — Tier A for a first-party repository, no confirmation (joshuafolkken/kit#1083). It is
   filed **first** because the next step has to name it, and its number does not exist until it is.
2. **Stash the work in progress.** A child is implemented on the default branch with an uncommitted
   tree — `pnpm josh git` only creates the branch at commit time — so `<M>`'s half-finished edits are
   sitting there, and the next child's `git switch main && git pull` would either refuse or carry
   them into the prerequisite's branch and PR.

   ```bash
   git stash push -u -m "epicrun: paused #<M> for prerequisite #<N>"
   gh api repos/{owner}/{repo}/issues/<M>/comments -f body="<what was stashed, and that #<N> must land first>"
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
   gh api -X DELETE repos/{owner}/{repo}/issues/<M>/labels/in-progress 2>/dev/null || true
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

Discovering that a child is really several is not a reason to stop. File the new children with the `route:split` label (joshuafolkken/kit#1083) (Tier A
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
| `auto-ok` issues per run | 5 | Finish and report; the epic is done, and the rest keeps until the person asks again. |

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

1. `epic:next` reports `complete`, the summary has been sent, and the `auto-ok` pickup has
   answered `none`, reached its cap, or reported that it could not read the listing.
2. `epic:next` reports `stop` — every remaining child needs a person; report them.
3. `epic:next` reports `error` — a cyclic or contradictory graph.
4. A guard above was reached.
5. A timeout above elapsed.
6. `pnpm josh cost --over 400000` answered `over` just after a child merged — the run is cheaper to
   continue in a fresh session, and the resume command is in the report. This is the one stopping
   condition that is not a problem: nothing is parked, nothing is filed, and the epic is unchanged.

**A child that needs a decision is not on this list.** It is parked, and the run continues.

---

This file is the single source of the `epicrun` procedure; `prompts/collaboration-workflow/epicrun.md` is a pointer to it (joshuafolkken/kit#1188, the joshuafolkken/kit#1176 rollout of the joshuafolkken/kit#1174 pattern). That topic file used to open by declaring that the two had to agree, which is what made every rule here a rule to be written twice.
