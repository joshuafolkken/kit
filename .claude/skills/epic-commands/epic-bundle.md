# `epic:bundle` — the detail behind the answer

Read this when a filing's `epic:bundle` answer places the issue (`add_to_epic`, `create_epic`, or a
choice between epics), or when `SKILL.md` → "`josh epic:bundle <N>` — does this new issue belong with
one already filed?" does not settle it. `Nothing to bundle.` needs neither. Reasons:
`docs/maintainers/epic-commands-rationale.md` → "`epic:bundle` — why each answer reads as it does".

**Only two things count as a signal**: the issues referring to each other in prose, or a `blocked-by`
already recorded between them. **A similar title never counts on its own.**

**The release issue is neither a candidate nor a subject**, like an epic — its `blocked-by` relations
are mechanical. Any other `blocked-by` or prose reference still counts.

**The search is not limited to the open backlog.** Every number the subject's own body names is read
(capped at twenty), whatever its state:

- A **closed** reference counts only when an open epic already tracks it; an **open** one counts either way.
- A **pull request** number is not a candidate.
- A failed read, or a reference past the cap, is reported as a gap — never folded into "no strong signal".
- **A number that does not exist is not a gap** — dropped in silence. Told apart **by HTTP status,
  never by `gh`'s wording**: 404 is nothing there; 403 and 429 are a rate limit.

**`none` is a legitimate answer** — the issue stays in the backlog. The review-cap follow-up's filing:
`prompts/review.md` → "Three-way disposition after the cap".

**A cut epic listing withholds every placing row**, `add_to_epic` as much as `create_epic` — an unseen
epic may already track the issue. The verdict says so, and the exit code stays `0`:

```text
Could not confirm which epic already tracks these — do not place this issue in one.
  the epics were not read in full, so an epic already tracking one of these may never have been seen
  Related: #<N>
```

It prints no children or order. What survives the cut is a membership that *was* found (the table's
first row).

**Placing an issue is not merging epics.** Choosing between two candidate epics is Tier A: take the one
you recommend and write the decision (taken, rejected, why, date) on **both** the issue and the epic's
`## Decisions`. **Merging two epics is a different action, and nothing here proposes it.**

**An epic and its own parent do not produce the spread verdict** — the issue goes to the inner epic.
**The narrowing drops parents, never peers**: an unrelated epic beside a nested chain, or a cyclic
declaration, still asks. Stop (Tier B) only where the epics left are genuinely too close to separate.

**Write both halves in the one call that places the issue: `pnpm josh epic --add <E> <N...>
--decision-file <path|->`.** It appends to the epic's `## Decisions` and comments the same text on
each child added. **Never hand-edit the epic body to add the entry.** Refused before anything is
written:

- **A line that is *nothing but* a `#A -> #B` chain** — it would be read as a declaration. Quote the
  order in backticks or a fenced block.
- **An empty record, or `--decision-file` with no usable path.**

For children the epic already tracks: `SKILL.md` → "Recording a decision".

**Its sibling runs before the filing: `pnpm josh issue:scout "<title>"`** — the same epic question for
an issue not yet filed, plus whether the work is already filed. **Both run**: `pnpm josh issue:file`
runs the scout before creating the issue and `epic:bundle` after. Full behavior:
`docs/josh-commands-backlog.md` → "`josh issue:file`".

**When the relation carries an order, record it** in `blocked-by` and in the epic's `Dependencies` —
on an addition as much as on a new epic. An order **nobody declared is not invented**.
