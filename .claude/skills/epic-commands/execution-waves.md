# Execution waves — parallel, then one alone, then the rest

**Read this when an epic's children need an order between groups** — a wave boundary, or one child
that must run alone. It is a reference of the `epic-commands` skill (`SKILL.md`), which carries the
commands themselves; the dependency declaration this file builds on is `SKILL.md` → "`josh epic:next
<E…>` — what is runnable".

**A wave is not a mechanism, and there is nothing to add for one.** "Run #A, #B and #C together, then
#D by itself, then the rest together" is already expressible with the dependency declaration
`SKILL.md` describes, and wanting it only became common once parallel lanes
(joshuafolkken/kit#1170) let several children run at once. What was missing was never the mechanism —
it was that nobody had written down how to build one, or when not to (joshuafolkken/kit#1584).

## The shape

**A wave boundary is drawn by chaining every child of the later wave to every child of the earlier
one.** Wave 1 `{#A, #B, #C}` → wave 2 `{#D}` → wave 3 `{#X, #Y, #Z}` is written in the epic's
`## Dependencies` as three chain lines:

```
#A -> #D -> #X
#B -> #D -> #Y
#C -> #D -> #Z
```

- **#A #B #C are blocked by nobody, so they start together** — as many at once as there are free lanes.
- **#D is `time` until all three have closed**, and becomes runnable the moment the last one does.
- **#X #Y #Z are blocked by #D, so #D necessarily runs alone.**
- **#D closing releases wave 3**, which again runs as wide as the lanes allow.

**The block above is an illustration, not something to paste.** `parse_dependency_chains` strips
fenced blocks before it matches, so a `## Dependencies` section whose chains sit inside a fence reads
as **no declaration at all** rather than as an error — and `#A` / `#B` are not issue numbers anyway.
The lines go into the epic body unfenced, with real numbers.

**Deleting a declared order is `pnpm josh epic --remove <E> <M> <N> [<N2> …]`, and never a hand edit
either** (joshuafolkken/kit#1712). The arguments are a path, so each consecutive pair is one order and
a whole chain goes in one call; the body's declaration and the `blocked-by` relations are written from
that one input, exactly as `--add` writes them. **The ends are never reconnected** — `#A -> #B -> #C`
minus `#B -> #C` leaves `#A -> #B`, and taking out a middle child's two links leaves `#A` and `#C`
unordered rather than declaring `#A -> #C`. Deleting the last link writes the unordered sentence, so
the section never ends up with no machine-readable declaration. Pass `--decision-file` to record why;
the record lands on the epic's `## Decisions` and on both ends of every deleted order. Doing either
half by hand is the `declaration_mismatch` below, arrived at from the other direction.

**Write the boundary with `pnpm josh epic --add`, not by hand.** A declared link with no recorded
`blocked-by` relation is the `declaration_mismatch` that `find_anomalies` reports, and it stops
`epic:next` and the run that consumes it outright; the rule `epic-bundle.md` ends on — record the order in `blocked-by` **and**
in `Dependencies` — is what a wave has to satisfy, and editing the body alone satisfies half of it.
**`--before <hub>` and `--after <hub>` are both refused while the hub sits in more than one chain
with nothing after it** — which is exactly what a hub is the moment the earlier wave has been chained
into it. `chains_containing` finds several indices; `is_branching_after` does not hold, because it
requires a successor in **every** chain naming the target and a hub has none in any of them; so
`ambiguous_position_error` is raised (`scripts/epic/epic-chains.ts`). **The first child of the
next wave therefore goes into the declaration by hand**, with its `blocked-by` recorded to match.
Once the hub has a successor, `--after <hub>` branches a new line and the rest of that wave goes in
with it.

**Nothing in the parsing or the consistency check forbids this.** `DECLARED_CHAIN_LINE` in `scripts/epic/epic-parse.ts`
asks only that a line be *nothing but* a chain, so there may be any number of chain lines and **one
child may be an endpoint of several of them** — `parse_dependency_links` expands each line
independently and flattens the result, dropping only self-loops. `find_anomalies` in
`scripts/epic/epic-graph.ts` rejects exactly two things, a **cycle** and a **disagreement between the
declaration and the recorded `blocked-by`**; a fan-in and a fan-out are neither.

**The number of lines is the size of the widest wave**, because a one-child wave is a hub and the
chains through it collapse into one line each. Where both sides of a boundary hold several children
the count grows — and that is the moment to ask whether the boundary is real, rather than to go
looking for a shorter notation.

## Running one child alone is a wave of one

**There is no `solo` mechanism, and none is needed.** "This one must not run beside anything" is the
shape above with a wave of size one: chain into it every child that must not overlap it, and out of
it every child that must not precede it. Adding a third axis — an exclusivity label, an
`## Exclusive` section — would put a second way to say what the dependency declaration already says,
and a second consistency check to keep the two agreeing.

## When a wave may be declared

**Declare a boundary only where the later wave needs the earlier wave's artifact.** That is the whole
condition, and it is narrower than it sounds:

- **A mere preference of order is not a dependency.** Wanting one child to go first — to see its
  result early, to get the risky one out of the way — is presentation order, and joshuafolkken/kit#1583
  is where that belongs. Substituting a dependency for it buys the order and pays with the stall below.
  **Write it with `--order-before <M>` / `--order-after <M>`** (joshuafolkken/kit#1738), which move the
  task-list row and declare nothing; `--before` / `--after` are for an order that really is a
  dependency. Neither of the order-only flags helps at a **wave boundary**, which is a dependency by
  definition — the hub case below stays what it is.
- **Two children that merely edit the same file are not a dependency.** A textual conflict resolves
  inside the lane: every run merges `origin/main` before its gate (`pnpm josh main:merge`), and an
  overlap that lands after it is resolved where it surfaces (`backlogrun-recovery.md` → "Conflicts are
  not predicted"). Run them in parallel; the per-conflict price is `backlogrun-lanes.md` → "Lanes —
  running more than one child at a time".
- **Two children that would each build the same mechanism are a dependency.** No merge reconciles two
  implementations of one thing — the later child must build on the earlier one's, so the boundary stays.
- **No reason to wait means no declaration.** An epic whose children are mostly independent says so in
  prose and leaves the graph empty.

## What a jam does, and how it is cleared

**Declare a boundary and one stuck child in the earlier wave stops every wave behind it.**
`from_blockers` in `scripts/epic/epic-classify.ts` propagates `human`: a wave-1 child labelled
`needs-decision` makes every child behind it "waiting on a person" rather than "waiting on time".

**The park itself is not the halt, and reading it as one hides how the cost arrives.** `backlogrun` parks
that child and goes on running the rest of wave 1 exactly as it always does; the session stops once
those close and nothing is runnable, because every later wave has been classified `human`. So a
boundary is paid for at the *end* of the wave rather than at the moment one child parks — which is
what makes one easy to declare and expensive to have declared. **Clearing it is removing that child's
`needs-decision`** once the decision has been recorded — the removal recording a decision already
requires — after which the waves behind it become runnable on the next round.

This is why the answer to "how do I build waves" is a paragraph rather than a feature. **A wave is
declared for a real wait and removed when the wait ends; it is not the standing shape of an epic.**

## The worked example — joshuafolkken/kit#1474

That epic has grown to **46 children while its declared chains have stayed at three**, and its body
says why:

> **鎖として宣言していない。** 19 件はほぼ独立しており、順序を依存として宣言すると 1 件詰まっただけ
> で残り全部が止まる。以下は推奨であって制約ではない。

The nineteen that paragraph was written about are ordered in **prose — a group, not a graph** — so a
reader gets the intent and no run is stopped by it, and none of the children added since has needed a
chain either. joshuafolkken/kit#1262 is the same lesson from the other
side: **24 false dependencies invented by `epic --add` have been removed from it**, each one an order
nobody needed that could have stopped everything behind it.
