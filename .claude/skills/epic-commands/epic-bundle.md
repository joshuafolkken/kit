# `epic:bundle` — the detail behind the answer

**Read this when a filing's `epic:bundle` answer places the issue** — `add_to_epic`, `create_epic`,
or a choice between epics — or when the answer is one the summary in the `epic-commands` skill
(`SKILL.md` → "`josh epic:bundle <N>` — does this new issue belong with one already filed?") does not
settle. `Nothing to bundle.` needs neither.

**Only two things count as a signal**: the issues referring to each other in prose, or a `blocked-by`
already recorded between them. **A similar title never counts on its own** — "related" expands
without limit, and the threshold is what keeps an unrelated issue out.

**The search is not limited to the open backlog.** Every issue number the subject's body names is read
on its own, whatever its state. A **closed** reference counts only when an open epic already tracks
it, since the answer worth recovering is `add_to_epic`; an epic created over a closed issue has
nothing left to run. An **open** reference counts either way. A read that fails — and a reference the
per-issue cap never reached — is reported as a gap, never folded into "no strong signal". A number
that answers with a **pull request** is not a candidate at all: `repos/{owner}/{repo}/issues/<N>`
serves one too, and a merged PR does not report `CLOSED`.

**A number that does not exist is not a gap.** A typo, or another repository's number quoted in
prose, is dropped in silence — neither a candidate nor something the command reports it could not
read. **The two are told apart by HTTP status, never by `gh`'s wording**: 404 is nothing at that
number, 403 and 429 are a rate limit. The referenced-number reads are capped at twenty, and **only
the subject's own body is followed**.

**`none` is a legitimate answer** — a self-review outside any workflow has no current issue to point
at, so the issue stays in the backlog: what the procedure requires is running the command and
following its answer, not landing every issue in an epic. The review-cap follow-up's filing and the
answer table it acts on are `prompts/review.md` → "Three-way disposition after the cap".

**Every row that *places* the issue asserts a negative, so a cut epic listing withholds all of them.**
"No epic already tracks this issue" — which `create_epic` asserts about the candidates too — is only
as good as the listing it was read from, and an epic past the cut tracks its children invisibly.
**`add_to_epic` rests on it as much as `create_epic` does**: adding the issue to the epic a
*candidate* sits in, while an unseen epic already tracks the issue itself, is the same duplicate by
another route. The verdict says so itself:

```text
Could not confirm which epic already tracks these — do not place this issue in one.
  the epics were not read in full, so an epic already tracking one of these may never have been seen
  Related: #<N>
```

**The children and the order are deliberately absent** — they are the recipe for the placement that
line says not to make. The exit code stays `0`, as it does for every other "do nothing" answer. **What
survives the cut is a membership that *was* found**: the table's first row names the epic it read
tracking the issue, and epics past the cut cannot unseat it.

**Placing an issue is not merging epics.** Bundling is reversible — one `epic --add` moves an issue
to a different epic — so choosing between two candidate epics is Tier A: take the one you recommend,
and write the decision (what was taken, what was rejected, why, and the date) on **both** the issue
and the epic's `## Decisions`. **Merging two epics is a different action, and nothing here proposes
it.**

**An epic and its own parent do not produce the spread verdict at all.** The parent already contains
the child, so the pair is narrowed to the inner epic and the issue is added there. **The narrowing
drops parents, never peers**: one unrelated epic beside a nested chain still asks, and so does a
cyclic declaration, where there is no inner epic to pick. Stop only where the epics left are
genuinely too close to separate, which is the toss-up Tier B is for and is rare.

**The decision record is what pays for the autonomy** — without it the run has taken a decision
nobody can find afterwards.

**Write both halves in the one call that places the issue: `pnpm josh epic --add <E> <N...>
--decision-file <path|->`.** It appends the record to the epic's `## Decisions` inside the body edit
the insertion already makes, and posts the same text as a comment on each child added. **Never
hand-edit the epic body to add the entry** — that is the operation `--add` exists to remove. Two
constraints on the record's own text, both refused before anything is written:

- **No line that is *nothing but* a `#A -> #B` chain.** Such a line is read as part of the epic's
  declaration wherever it sits in the body, so the record would declare an order nobody decided. Quote
  the order inside backticks, or put it in a fenced block; either is accepted.
- **The record must say something, and the path must be readable.** An empty file is refused, and so is
  `--decision-file` with no usable path — otherwise the insertion lands, no record is written anywhere,
  and the command still exits 0.

Answers about children the epic already tracks cannot use this flag; `SKILL.md` → "Recording a
decision" says what to do instead.

**Its sibling runs before the filing, not after it: `pnpm josh issue:scout "<title>"`.** That command
answers the same epic question for an issue that does not exist yet — this decision, called rather
than restated — and beside it the one thing this one deliberately refuses: whether the work has
already been filed, from a title comparison. **Both run**, and neither replaces the other:
`pnpm josh issue:file` runs the scout before it creates the issue, and `epic:bundle` afterwards, from
the real number and the relations recorded against it. Full behavior:
`docs/josh-commands-backlog.md` → "`josh issue:file`".

**When the relation carries an order, record it** in `blocked-by` and in the epic's `Dependencies` —
on an addition as much as on a new epic. Without it the batch survives and the reason for it does
not. An order **nobody declared is not invented**.
