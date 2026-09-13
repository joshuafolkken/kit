# The split assessment — one definition, every entry point

Before any entry point starts work on an Issue, decide whether the request is really **one**
deliverable or several. This file is the single definition; every command applies it identically.

## The question

**The default is not to split.** Two questions have to answer yes **together**; either one alone
leaves the work as one Issue:

1. **Does the request contain two or more deliverables that could each be merged separately?**
2. **Does the whole of it clearly exceed what one verification gate can confirm in one pass?** The
   guide is **about 10 changed files and about 400 changed lines**. Under that, it is one Issue however
   many separable pieces a reader can name inside it.

Separately mergeable is still the first test, and it is unchanged: a change that must land in one
commit to be correct is one deliverable however big it is. What changed is that **separability alone
no longer splits anything** — it is now a necessary condition rather than a sufficient one.

**The guide is a guide, and "clearly" is the operative word.** A run that has to argue itself past the
numbers has already answered no. They are read against the whole request's estimate, not against the
diff a first pass happens to produce, and a request that lands at 11 files is not thereby a split.

## Why the default is not to split

**The rules were manufacturing Issues faster than runs could close them.** Execution was never the
bottleneck; arrival was, and this assessment was one of the routes producing it: `route:split`
accounted for **28 of the 119 open Issues (24%)**.

**Separability is not scarce, which is why a test made only of it splits nearly everything.** Almost
any request can be described as several deliverables that could each ship alone, so the old test bit on
requests worth a handful of lines. The second question is what makes the test bite only where one Issue
would genuinely be unverifiable in one pass. The review round cap's default and the WIP cap changed
alongside it, in one commit.

## Diff size is not a reason to split, and that is measured

**Size is a bar a split has to clear; it is never a reason to split.** Question 2 is a *minimum* — below
it the work stays whole — and nothing makes a large diff a reason to divide one. Splitting an Issue in
two to shorten review round 1 lengthens it, because each Issue pays round 1's fixed cost again while
the size-dependent part is merely divided between the halves (`prompts/review.md` → "Round 1's cost
does track the change size, and splitting is still not how to cut it", the single source). **A proposal
to add a size threshold that splits more is required to say why that data does not reach it.**

## What each entry point does with the answer

| Entry | Single | Two or more |
| --- | --- | --- |
| `kickoff new` | Create one Issue, post the plan, stop | Create the children, create a **new epic**, stop |
| `kickoff #N` | Post the plan on `#N`, stop | Create the children, then **promote `#N`** or create a new epic (below), stop |
| `fullrun new` / `halfrun new` | Proceed as usual | Create the children and the epic, then **stop** |
| `fullrun #N` / `halfrun #N` | Proceed as usual | Create the children, promote or create the epic, then **stop** |

## A prerequisite is not a split

"This needs something else done first" is a different answer from "this is really several things". A
split means the request in hand contains two or more deliverables; a prerequisite means it is still
**one** deliverable that has another one in front of it. The prerequisite rule is `SKILL.md` → §2d, its
single source; each entry's own branch is in `epicrun.md` → "A prerequisite discovered mid-run" and, for
the stopping entry points, in `fullrun.md` / `halfrun.md`.

## Two or more always means an epic

**Splitting into two or more Issues always creates an epic. There is no count threshold and no ordering
condition to evaluate.** This is about what follows a split, never about whether to make one — the bar
for that is "The question" above. **An entry point that applies a different condition is a defect** —
the whole point of one definition is that where the split was noticed cannot change what happens next.

The epic is the non-closing home for the split rationale. A comment on the first child is buried the
moment that child merges and closes.

**Each split child is filed with the `route:split` label**, so the backlog's composition stays
countable by filing route rather than by grepping issue bodies.

## Promote, or create a new epic

`kickoff #N` and the `#N` runs have one branch, and it is Tier A — decide it and record the reasoning
on the Issue, without asking.

- **`#N` is a request, a discussion, or a container → promote it.**
  `pnpm josh epic --promote <N> <N1> <N2> ... [--ordered]`. The body is appended to, never replaced.
- **`#N` is itself one of the deliverables → keep `#N` as a child and create a new epic.** A bug report
  that turns out to need three fixes is the case: promoting the report would leave the report itself
  with nowhere to live.

## `epicrun` is the one entry that does not stop

`epicrun` asked for the batch's authorization, so a split found under it is filed and continued through
rather than stopped — including when the `epicrun` was given a bare, non-epic Issue, where the split is
what creates the epic (`epicrun.md` → "When `#N` is not an epic"). The assessment itself is identical;
only what follows the answer differs.

## Finding a split mid-run stops the run

`fullrun` and `halfrun` **stop** after filing the children and the epic. They do not continue into
implementation, and they do not silently become an `epicrun`. Typing `fullrun` approved implementing and
merging **one** Issue; a batch of N is a different authorization. Report what was filed and end with:

> Please run `epicrun #<E>` to execute this epic.

## There is no `kickoff epic`

A separate keyword for "split this conversation into an epic" would duplicate `kickoff new` exactly,
leaving a person to decide which of two commands to type for one job. The assessment above is how a
split is reached from every entry.

## Issues filed separately, found related later

Issues that were filed at different times and turn out to be related afterwards are **not** a split — a
split is about one request in hand containing several deliverables. That case is outside this
assessment, and `pnpm josh epic --promote` is what handles it.
