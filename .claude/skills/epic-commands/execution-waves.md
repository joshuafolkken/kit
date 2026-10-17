# Execution waves — parallel, then one alone, then the rest

Read this when an epic's children need an order between groups — a wave boundary, or one child that
must run alone. It builds on `SKILL.md` → "`josh epic:next <E…>` — what is runnable".

**A wave is not a mechanism, and there is nothing to add for one** — the dependency declaration
already expresses it.

## The shape

**Chain every child of the later wave to every child of the earlier one.** Wave 1 `{#A, #B, #C}` →
wave 2 `{#D}` → wave 3 `{#X, #Y, #Z}` in the epic's `## Dependencies`:

```
#A -> #D -> #X
#B -> #D -> #Y
#C -> #D -> #Z
```

- **#A #B #C are blocked by nobody, so they start together** — as many as there are free lanes.
- **#D is `time` until all three have closed**, then runnable.
- **#X #Y #Z are blocked by #D, so #D necessarily runs alone.**
- **#D closing releases wave 3.**

**The block above is an illustration, not something to paste**: chains inside a fence read as no
declaration at all. Write the lines unfenced, with real numbers.

**Write the boundary with `pnpm josh epic --add`, not by hand** — a declared link with no recorded
`blocked-by` is a `declaration_mismatch` that stops `epic:next` and the run. **`--before <hub>` and
`--after <hub>` are both refused while the hub sits in more than one chain with nothing after it**, so
**the first child of the next wave goes into the declaration by hand**, with its `blocked-by` recorded
to match; after that, `--after <hub>` branches the rest.

**Delete a declared order with `pnpm josh epic --remove <E> <M> <N> [<N2> …]`, never a hand edit.**
Each consecutive pair is one order. **The ends are never reconnected** (`#A -> #B -> #C` minus
`#B -> #C` leaves `#A -> #B`). Deleting the last link writes the unordered sentence.
`--decision-file` records why on the epic and on both ends.

**Any number of chain lines is allowed**; only a **cycle** and a **disagreement between the
declaration and the recorded `blocked-by`** are rejected. The line count is the widest wave; when both
sides of a boundary hold several children, ask whether the boundary is real.

## Running one child alone is a wave of one

**There is no `solo` mechanism.** Chain into it every child that must not overlap it, and out of it
every child that must not precede it.

## When a wave may be declared

**Only where the later wave needs the earlier wave's artifact.**

- **A preference of order is not a dependency** — use task-list order: `--order-before <M>` /
  `--order-after <M>` move the row and declare nothing. They do not help at a wave boundary.
- **Two children editing the same file are not a dependency** — run them in parallel; conflicts
  resolve in the lane (`pnpm josh main:merge`; `backlogrun-recovery.md` → "Conflicts are not
  predicted"; `backlogrun-lanes.md` → "Lanes — running more than one child at a time").
- **Two children that would each build the same mechanism are a dependency.**
- **No reason to wait means no declaration** — say so in prose and leave the graph empty.

## What a jam does, and how it is cleared

**One stuck child in an earlier wave stops every wave behind it**: a `needs-decision` child makes
every child behind it "waiting on a person" (`from_blockers` in `scripts/epic/epic-classify.ts`).
`backlogrun` parks it and runs the rest of the wave; the session stops once nothing is runnable.
**Clear it by removing that child's `needs-decision`** once the decision is recorded.

**A wave is declared for a real wait and removed when the wait ends.**
