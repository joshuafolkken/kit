# The split assessment — one definition, every entry point

Before any entry point starts work on an Issue, decide whether the request is really **one**
deliverable or several. This file is the single definition; every command applies it identically.
`kickoff new` used to be the only entry that assessed scope, which is how a request that should have
been three Issues could reach a merge as one pull request (joshuafolkken/kit#865).

## The question

**The default is not to split.** Two questions have to answer yes **together**; either one alone
leaves the work as one Issue (joshuafolkken/kit#1469):

1. **Does the request contain two or more deliverables that could each be merged separately?**
2. **Does the whole of it clearly exceed what one verification gate can confirm in one pass?** The
   guide is **about 10 changed files and about 400 changed lines**. Under that, it is one Issue
   however many separable pieces a reader can name inside it.

Separately mergeable is still the first test, and it is unchanged: a change that must land in one
commit to be correct is one deliverable however big it is. What changed is that **separability alone
no longer splits anything** — it is now a necessary condition rather than a sufficient one.

**The guide is a guide, and "clearly" is the operative word.** A run that has to argue itself past
the numbers has already answered no. They are read against the whole request's estimate, not against
the diff a first pass happens to produce, and a request that lands at 11 files is not thereby a
split.

## Why the default is not to split

**The rules were manufacturing Issues faster than runs could close them.** Over the seven days to
2026-09-06 the backlog took 257 filings against 163 closures — **+13.4 Issues a day**, with filings
beating closures on **all fourteen** of the preceding fourteen days — while a `fullrun` ran a median
of about ten minutes from pull request to merge. **Execution was never the bottleneck; arrival was**,
and this assessment was one of the three routes producing it: `route:split` accounted for **28 of
the 119 open Issues (24%)**.

**Separability is not scarce, which is why a test made only of it splits nearly everything.** Almost
any request can be described as several deliverables that could each ship alone, so the old test bit
on requests worth a handful of lines: joshuafolkken/kit#1205 through #1209 are five Issues of the
same shape, each a sentence's worth of work. The second question is what makes the test bite only
where one Issue would genuinely be unverifiable in one pass.

**It moved with the other two, in one commit.** The review round cap's default and the WIP cap
changed alongside it, for the reason joshuafolkken/kit#1469 gives: a ceiling on open Issues that
arrives while the manufacturing routes are still open stops execution without stopping arrival, and
leaves the state worse than before.

## Diff size is not a reason to split, and that is measured

**Size is a bar a split has to clear; it is never a reason to split.** Question 2 is a *minimum* —
below it the work stays whole — and nothing anywhere makes a large diff a reason to divide one.
joshuafolkken/kit#1436 proposed exactly that reason: a diff-size arm that would split a large Issue,
on the ground that review round 1's wall clock tracks how much it is handed to read. **It does track
it — and splitting an Issue in two to shorten round 1 lengthens it**, because each Issue pays round
1's fixed cost again while the size-dependent part is merely divided between the halves. The fit, the
sample, the unreadable share of it and the decision are `prompts/review.md` → "Round 1's cost does
track the change size, and splitting is still not how to cut it", which is the single source. **A
proposal to add a size threshold that splits more is required to say why that data does not reach
it**, which is a different bar from being refused.

**joshuafolkken/kit#1469's threshold points the other way, which is why the two are not in
contradiction.** At every diff size the current test splits as often as the old one or less often
and never more, so it can only remove intercepts the measurement above says a split adds — the same
data supports both decisions. **What this section refuses is any arm that would raise the number of
splits at some size**, whatever ground it is argued from.

## What each entry point does with the answer

| Entry | Single | Two or more |
| --- | --- | --- |
| `kickoff new` | Create one Issue, post the plan, stop | Create the children, create a **new epic**, stop |
| `kickoff #N` | Post the plan on `#N`, stop | Create the children, then **promote `#N`** or create a new epic (below), stop |
| `fullrun new` / `halfrun new` | Proceed as usual | Create the children and the epic, then **stop** |
| `fullrun #N` / `halfrun #N` | Proceed as usual | Create the children, promote or create the epic, then **stop** |

## A prerequisite is not a split

"This needs something else done first" is a different answer from "this is really several things".
A split means the request in hand contains two or more deliverables; a prerequisite means it is
still **one** deliverable that has another one in front of it. Reading the second as the first sends
it down this file's procedure, which files children that do not exist and stops every entry but
`epicrun` — where a prerequisite is instead recorded as a dependency and run straight through. The prerequisite rule is
defined in `SKILL.md` → §2d, which is its single source; each entry's own branch is in
`epicrun.md` → "A prerequisite discovered mid-run" and, for the stopping entry points, in
`fullrun.md` / `halfrun.md` (joshuafolkken/kit#891).

## Two or more always means an epic

**Splitting into two or more Issues always creates an epic. There is no count threshold and no
ordering condition to evaluate.** This is about what follows a split, never about whether to make
one — the bar for that is "The question" above, and once it is cleared this rule takes over
unchanged. This rule already existed for `kickoff new`; extending the
assessment to every entry extends the rule with it. **An entry point that applies a different
condition is a defect** — the whole point of one definition is that where the split was noticed
cannot change what happens next.

The epic is the non-closing home for the split rationale. A comment on the first child is buried the
moment that child merges and closes, which happens on every split.

**Each split child is filed with the `route:split` label.** `kickoff.md`'s multi-issue path carries
it in the `gh api … issues` call; every entry that files children through this assessment applies
the same label, so the backlog's composition stays countable by filing route rather than by grepping
issue bodies (joshuafolkken/kit#1083).

## Promote, or create a new epic

`kickoff #N` and the `#N` runs have one branch, and it is Tier A — decide it and record the reasoning
on the Issue, without asking.

- **`#N` is a request, a discussion, or a container → promote it.**
  `pnpm josh epic --promote <N> <N1> <N2> ... [--ordered]`. The body is appended to, never replaced,
  so the discussion that produced the split stays where it was written.
- **`#N` is itself one of the deliverables → keep `#N` as a child and create a new epic.**
  A bug report that turns out to need three fixes is the case: promoting the report would leave the
  report itself with nowhere to live.

## `epicrun` is the one entry that does not stop

The table above is about the entries that ask for one Issue's authorization. `epicrun` asked for the
batch's, so a split found under it is filed and continued through rather than stopped — including
when the `epicrun` was given a bare, non-epic Issue, where the split is what creates the epic in the
first place (`epicrun.md` → "When `#N` is not an epic", joshuafolkken/kit#892). The assessment itself
is identical; only what follows the answer differs, and it differs because the authorization already
covers a batch.

## Finding a split mid-run stops the run

`fullrun` and `halfrun` **stop** after filing the children and the epic. They do not continue into
implementation, and they do not silently become an `epicrun`.

Typing `fullrun` approved implementing and merging **one** Issue. A batch of N is a different
authorization, and quietly widening it would take a decision the person never made. Stopping also
preserves the one deliberate human touch point in the epic flow — the batch decision
(joshuafolkken/kit#862).

Report what was filed and end with:

> Please run `epicrun #<E>` to execute this epic.

## There is no `kickoff epic`

A separate keyword for "split this conversation into an epic" would duplicate `kickoff new` exactly,
leaving a person to decide which of two commands to type for one job. That is more human involvement,
which is the opposite of what these commands are for. The assessment above is how a split is reached
from every entry.

## Issues filed separately, found related later

Issues that were filed at different times and turn out to be related afterwards are **not** a split
either — a split is about one request in hand containing several deliverables, not about relating
things that already exist. That case is outside this assessment, and `pnpm josh epic --promote` is
what handles it, as a separate use of the same command (joshuafolkken/kit#873).
