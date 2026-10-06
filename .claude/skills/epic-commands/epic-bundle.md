# `epic:bundle` — the detail behind the answer

**Read this when a filing's `epic:bundle` answer places the issue** — `add_to_epic`, `create_epic`,
or a choice between epics — or when the answer is one the summary in the `epic-commands` skill
(`SKILL.md` → "`josh epic:bundle <N>` — does this new issue belong with one already filed?") does not
settle. `Nothing to bundle.` needs neither.

"Two or more always means an epic" only fires when one request is split on the spot. Two issues filed
days apart that turn out to be the front and back of one job are executed separately, in whatever
order, with the reasoning recorded nowhere.

**Only two things count as a signal**: the issues referring to each other in prose, or a `blocked-by`
already recorded between them. **A similar title never counts on its own** — "related" expands
without limit, and the threshold is what keeps an unrelated issue out.

**The search is not limited to the open backlog.** Every issue number the subject's body names is read
on its own, whatever its state — otherwise the command answers correctly only in the minutes between
a follow-up issue being filed and its parent closing (joshuafolkken/kit#947). A **closed** reference
counts only when an open epic already tracks it, since the answer worth recovering is `add_to_epic`;
an epic created over a closed issue has nothing left to run. An **open** reference counts either way.
A read that fails — and a reference the per-issue cap never reached — is reported as a gap, never
folded into "no strong signal". A number that answers with a **pull request** is not a candidate at
all: `repos/{owner}/{repo}/issues/<N>` serves one too, and a merged PR does not report `CLOSED`.

**A number that does not exist is not a gap.** A typo, or another repository's number quoted in
prose, is dropped in silence — neither a candidate nor something the command reports it could not
read. Reported as a gap it puts `⚠ Could not read #N.` above the verdict, and the could-not-answer rule
(`prompts/review.md` → "Three-way disposition after the cap") stops an unattended run on exactly that, for a reference that never existed (joshuafolkken/kit#957). **The two
are told apart by HTTP status, never by `gh`'s wording**: 404 is nothing at that number, 403 and 429
are a rate limit. GitHub answers 404 for an issue the token may not see as well, so as not to leak
its existence — which does not reach this command, because it probes the repository whose open issues
it has just listed. The probe costs one REST request and runs **only** when a read has already
failed, and only on the path that needs the distinction: the backlog's own relation reads, up to two
hundred of them, never pay it, and the referenced-number reads are capped at twenty. **Only the
subject's own body is followed** — the reverse direction would scan every closed issue, and a
follow-up already names its parent. The reference parsing is the same implementation as
`epic:audit`'s implicit-dependency check, applied to the backlog instead of one epic. The open backlog
is small enough to scan whole, so there is no index or cache.

**`none` is a legitimate answer** — a self-review outside any workflow has no current issue to point
at, so the issue stays in the backlog: what the procedure requires is running the command and
following its answer, not landing every issue in an epic. The review-cap follow-up's filing and the
answer table it acts on are `prompts/review.md` → "Three-way disposition after the cap".

**Every row that *places* the issue asserts a negative, so a cut epic listing withholds all of them**
(joshuafolkken/kit#1697). "No epic already tracks this issue" — which `create_epic` asserts about the
candidates too — is only as good as the listing it was read from, and an epic past the cut tracks its
children invisibly. **`add_to_epic` rests on it as much as `create_epic` does**: adding the issue to
the epic a *candidate* sits in, while an unseen epic already tracks the issue itself, is the same
duplicate by another route. The cut was already on standard error
(`⚠ The epic listing …`) while standard output went on printing an executable
instruction such as `Create an epic for these (Tier A — do it).` — and the rule that reads a warning as "could not answer" (`prompts/review.md` → "Three-way
disposition after the cap") is written for one above
`Nothing to bundle.`, so it never reached this verdict. Acted on as Tier A, that is a **second epic
over an already-tracked issue**, which the auto-close and `epic:next` cannot both be right about
(joshuafolkken/kit#943). The verdict now says so itself:

```text
Could not confirm which epic already tracks these — do not place this issue in one.
  the epics were not read in full, so an epic already tracking one of these may never have been seen
  Related: #1662
```

**The children and the order are deliberately absent** — they are the recipe for the placement that
line says not to make. The exit code stays `0`, as it does for every other "do nothing" answer. **What
survives the cut is a membership that *was* found**: the table's first row names the epic it read
tracking the issue, and epics past the cut cannot unseat it.

**Placing an issue is not merging epics, and reading it as one is what used to stop runs.** Bundling
is reversible — one `epic --add` moves an issue to a different epic — so choosing between two
candidate epics is Tier A: take the one you recommend, and write the decision (what was taken, what
was rejected, why, and the date) on **both** the issue and the epic's `## Decisions`. **Merging two
epics is a different action, and nothing here proposes it.**

**An epic and its own parent no longer produce the spread verdict at all** (joshuafolkken/kit#1079).
They were never two peers to choose between — the parent already contains the child — so the pair is
narrowed to the inner epic and the issue is added there. The verdict had recorded three such false
positives, one of which stopped a whole batch over an issue whose implementation was finished and
whose pull request was mergeable. **The narrowing drops parents, never peers**: one unrelated epic
beside a nested chain still asks, and so does a cyclic declaration, where there is no inner epic to
pick. Stop only where the epics left are genuinely too close to separate, which is the toss-up
Tier B is for and is rare.

**The decision record is what pays for the autonomy.** Skipping it is not a shortcut past a
formality — it is the half that makes an unattended choice auditable, and without it the run has
simply taken a decision nobody can find afterwards.

**Write both halves in the one call that places the issue: `pnpm josh epic --add <E> <N...>
--decision-file <path|->`** (joshuafolkken/kit#1350). It appends the record to the epic's
`## Decisions` inside the body edit the insertion already makes — so the epic half costs no round trip
— and posts the same text as a comment on each child added. **Never hand-edit the epic body to add the
entry**: that is the operation `--add` exists to remove, and paying for it by hand is why the entry got
skipped. Two constraints on the record's own text, both refused before anything is written:

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
already been filed, from a title comparison (joshuafolkken/kit#1252). **Both run**, and neither
replaces the other: `pnpm josh issue:file` runs the scout before it creates the issue, and
`epic:bundle` afterwards, from the real number and the relations recorded against it.
Full behavior: `docs/josh-commands-backlog.md` → "`josh issue:file`".

**When the relation carries an order, record it** in `blocked-by` and in the epic's `Dependencies` —
on an addition as much as on a new epic. Without it the batch survives and the reason for it does
not. An order **nobody declared is not invented**.
