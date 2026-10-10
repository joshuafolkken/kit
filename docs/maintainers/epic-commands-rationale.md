# `josh epic:*` commands — rationale

This is maintainer-only rationale behind `.claude/skills/epic-commands/SKILL.md`: the history and the
measurements that justify `epic:audit`, cross-repository epics and `epic:bundle`. It is never read
during a run — every trigger, command, verdict and bound an agent acts on stays in the skill, and a
change to this file changes no rule. It used to live, in Japanese, in the three epic topic files
under `prompts/collaboration-workflow/`, which now point at the skill (joshuafolkken/kit#2892).

## `epic:audit` — why the children are read across

`epic:check` verifies one epic's format, and nothing verified that the children agree. A hand audit of
joshuafolkken/kit#858's children found two contradictions that would have stalled the implementation,
while `epic:check` reported all four requirements as passing:

- **A circular dependency** — #863's body said it used #864's findings, and #864's body said its
  publish check shared one implementation with #863. Neither had a `blocked-by`, and the epic body
  declared both independent.
- **An order contradiction** — #860's acceptance criteria required #863 / #864's artifacts, while the
  dependency graph let #860 run before both.

A state found only when a person asks for bugs to be hunted is not one an unattended run can rely on.

The same audit found three ripple defects no mechanical check catches — a new concept whose existing
references nobody owned updating: the `needs-decision` label was introduced with nobody adding it to
the exclusion set, `epicrun` was introduced while epic bodies went on naming the old command, and
`in-progress` was applied with nothing removing it. That is the origin of the planning step in the
skill.

**Why a pair with a closed end is demoted rather than dropped.** An error there stopped
joshuafolkken/kit#908 at the first step of every resume while `epic:next` happily returned its next
child — the error's reason (the child can run first) and what actually blocked the run had come apart
(joshuafolkken/kit#1010). Dropping the finding would not shorten the output: the same pair would
reappear one line lower as an `implicit dependency`, minus the one detail worth reading. What makes
an undeclared order a contradiction is that the criteria's child _can run first_, and one end closing
is enough to make that false: a closed naming child has already run, and a closed named child has
already delivered what the criteria ask for. The demotion was widened from both-closed to
either-closed by joshuafolkken/kit#1597, after a closed child citing an open sibling **as evidence**
held an epic red at step one.

**Why the first check is only a warning.** It fires on a legitimate forward reference as readily as
on a real missing dependency; failing on both would make design notes unwritable, so the reader
judges and the machine only keeps it from being missed. Acceptance criteria that require what a
child free to run later produces cannot be met however anyone decides, which is why that check is
an error.

**Why a cross-repository pair is a warning** (joshuafolkken/kit#1128). Such an order only became
recordable with joshuafolkken/kit#1126, so an error would stop every epic written before it.

## Cross-repository epics

A request often spans kit, app-kit, game-kit and joshuafolkken-com, so an epic can hold children in
other repositories. The owner restriction is joshuafolkken/kit#869's, inherited unchanged, and the
checkout map `epic:next` prints from is the same issue's.

**Why a cross-repository dependency waits for a publish.** When a kit issue closes, the merge, the
auto-tag and the npm publish are still running one after another. A consumer child started at that
moment either fetches a version that does not exist yet or implements against the old one — the
"breaks sometimes" failure that is hardest to diagnose. The wait targets an exact version because a
consumer several releases behind would otherwise be satisfied by an older publish that lacks the
change.

**Why a repository that publishes nothing does not wait** (joshuafolkken/kit#1129). Waiting for a
release that can never exist held the run until its eight-hour limit, with nothing an operator could
edit to clear it. The answer comes from the blocker's manifest rather than the registry because a
registry 404 also means "this token may not see it", so resolving on one would start a consumer
child before its blocker's release existed.

**Why the target is not the default branch's version** (joshuafolkken/kit#1486). Once a child stopped
bumping the version, the default branch's version just after the blocker's merge is the previous
release, which would satisfy the wait at once.

## `epic:bundle` — why issues filed apart are bundled afterwards

"Two or more always means an epic" fires only when one request is split on the spot. Issues filed at
different times were never bundled, so three cases slipped through: a Tier A filing mid-implementation
that had an order with an open issue, two issues filed days apart that were the front and back of one
job, and an existing issue later found to need an execution order. Each ran on its own, out of order,
with the reason for the split recorded nowhere.

**The follow-up filing route.** The review cap (`prompts/review.md` → "Review round cap") is the
workflow's busiest filing route, yet its procedure long stopped at "file it and reference the current
issue", with nothing leading to the bundling. joshuafolkken/kit#943 was cut from a second review round,
named its parent `joshuafolkken/kit#891` in its body, and joined no epic; #891 closed three minutes later. On
the same route joshuafolkken/kit#911 ran the command, `epic:bundle` named the epic, and the issue was
added. **The only difference was whether the command was typed** (joshuafolkken/kit#946). The second
layer of #943's miss — a filing after the parent closed answering `Nothing to bundle.` forever, because
the search read open issues only — is joshuafolkken/kit#947, which is why the search now reads every
number the body names whatever its state.

**Why the filing steps run inside the CI wait.** Measured, `epic:bundle` takes 43 s and `epic --add`
18 s (joshuafolkken/kit#1229), while joshuafolkken/kit#1238's `followup` spent 78 of its 122 s waiting
for CI (joshuafolkken/kit#1239). Filing changes no code, so the running CI stays valid — unlike
running review round 1 beside CI, which joshuafolkken/kit#1216 (b) rejected because every pushed fix
restarts CI. Round 2 reads only the fix delta and usually changes nothing, so it does run beside CI
(joshuafolkken/kit#1261).

**Why the filing branch is narrow** (joshuafolkken/kit#1469). The review-cap route was the largest of
the backlog's three net sources, so the default disposition moved to "drop with a one-line PR note",
and filing is kept for confirmed defects that reach a runtime path. The bundling steps therefore fire
less often than they used to — a changed default, not a skipped step.

**Why a nonexistent number is dropped in silence** (joshuafolkken/kit#957). Reported as a gap, one
mistyped `#N` in prose put `⚠ Could not read #N.` above the verdict and stopped an unattended run for a
reference that never existed.

## Creating an epic by hand

The reasoning below used to live, in Japanese, in `prompts/collaboration-workflow/issue-template.md`,
which now keeps the "always create an epic" trigger, a pointer to the skill, and the by-hand fallback
steps with the body template (joshuafolkken/kit#3178).

**Why every split gets an epic.** Kept as a comment on the first child, the split rationale ends up
inside the issue a batch merges and closes first, burying the plan for the rest. An earlier caveat
("with few children, the epic costs more than it organizes") lost its ground once `followup` began
auto-closing an epic whose children are all closed (`scripts/epic/epic-close.ts`): with no abandoned
epic left to manage, the only risk is misjudging the branch. A `closes #<epic>` in the last PR was
rejected because it also fires when a batch fails midway.

**The body template** `pnpm josh epic` renders:

```md
## Split rationale

<why this split>

## Dependencies

#101 -> #102 -> #103

## Execution

backlogrun #<E> --only

## Progress

- [ ] #101 <title>
- [ ] #102 <title>
```

- `Progress` is a task list because GitHub ticks only that notation when the child closes; it never
  closes the epic itself, which is `followup`'s job (and why the `epic` label and the task list are both
  required — either missing leaves the epic open).
- `Dependencies` is an arrow chain (`->` or `→`) because `followup`'s missing-relation warning fires
  only on that notation. Order-free batches write `None — the children are independent; any execution
order works.` rather than deleting the section, so "no order" and "forgot" stay distinct. A reason
  appended to the chain line (`#101 -> #102 (uses #101's API)`) is not read as a declaration: the three
  readers (`epic:check`, `epic:next`, `epic --add`) accept only chain-only lines so a prose
  "recommended order" outside the section is never misread (joshuafolkken/kit#858,
  joshuafolkken/kit#1155). The chain and `None — …` together is a contradiction `epic:check` refuses.
- The warning checks only that at least one native relation exists, not the chain's shape — inferring
  order from the task list would produce false positives, and an order-free epic legitimately has zero.
- A task-list child in another repository disables auto-close, because its state cannot be read
  without naming that repository; a backlink written as a checkbox line hits the same rule.

**The fallback, where `josh` is unavailable,** stays in `prompts/collaboration-workflow/issue-template.md`
→ "複数 Issue に分割するときの epic Issue": it is the one part a consumer without a working `josh` must
reach, and `docs/` is not shipped. Its four steps are explained here.

**Why step 4 resolves a database id.** The endpoint takes a database id, not an issue number, and does
not check the id belongs to this repository: a raw number returns 200 and records an unrelated issue in
some other repository (measured in joshuafolkken/kit#1026). `pnpm josh epic` resolves the id before
writing. Relations are added after creation so that a relation failure loses only the relation, never
the issue; the command reports the count and continues.

**Why step 2's `|| true` is safe.** It swallows REST's 422 `already_exists`. `POST /issues` creates a
missing label on the spot with default color and description (joshuafolkken/kit#1026), so a swallowed
failure loses only those, and `epic:next` and auto-close read the name alone.

**Native relations, and why sub-issues were not adopted.** `gh issue edit --add-blocked-by` /
`--parent` and `gh issue view --json blockedBy,subIssues` exist from `gh` 2.94.0 (confirmed on 2.97.0),
but they go through GraphQL and fail with 403 in cloud sessions (joshuafolkken/kit#1022), so no
procedure uses them — everything goes through the REST endpoint via `gh api`. Dependencies are adopted:
a child shows what it waits for in the UI and API, though they only display and never block, so order
is still enforced by `--ordered` and `backlogrun`. Sub-issues are not: they express containment, not
order, and are limited to one repository owner — neither reason depends on CLI support.

## `epic:next` — why it answers as it does

**Why several epics rank by argument order** (joshuafolkken/kit#1493). Dependency depth does not
compare across graphs: depth is measured inside one epic and there is no relation between two epics
to normalize against, while argument order is the one ranking a person typed and can change.

**Why task-list order inside one epic** (joshuafolkken/kit#1583). The order was the lowest issue
number until then, on the premise that number order is split order — false for any epic that gains
children as work is found. `--order-before` / `--order-after` (joshuafolkken/kit#1738) made moving
the row a command rather than a hand edit.

**Why lane occupancy is read from the listing.** Two sessions counting to the limit in their own
memory would double it. It is an advisory guard rather than a mutex: the label is applied after the
read, so what it closes is the window that actually occurs — a lane holding the label for minutes.

**Why an epic child is never offered** (joshuafolkken/kit#1476). Before this the row fell through to
the dependency reading, which makes anything unblocked runnable, and `backlogrun` passed the epic to
`fullrun` as an ordinary issue — a run with nothing to implement.

**Why the buckets ignore labels.** Reading labels fails in an ordinary state: when one repository's
child has closed and another's is waiting for a release to publish, nothing carries `in-progress` or
`needs-decision` — and a label-based reading calls that "done" in the one moment it must wait.

## `epic:bundle` — why each answer reads as it does

**Why closed references are read** (joshuafolkken/kit#947). Without it the command answers correctly
only in the minutes between a follow-up issue being filed and its parent closing.

**Why the nonexistent-number probe is cheap and narrow.** GitHub answers 404 for an issue the token
may not see as well, so as not to leak its existence — which does not reach this command, because it
probes the repository whose open issues it has just listed. The probe costs one REST request and
runs only when a read has already failed, and only on the path that needs the distinction: the
backlog's own relation reads, up to two hundred of them, never pay it. Only the subject's own body is
followed because the reverse direction would scan every closed issue, and a follow-up already names
its parent. The reference parsing is the same implementation as `epic:audit`'s implicit-dependency
check, applied to the backlog instead of one epic; the open backlog is small enough to scan whole, so
there is no index or cache.

**Why a cut listing withholds every placing row** (joshuafolkken/kit#1697). The cut was already on
standard error (`⚠ The epic listing …`) while standard output went on printing an executable
instruction such as `Create an epic for these (Tier A — do it).` — and the rule that reads a warning
as "could not answer" (`prompts/review.md` → "Three-way disposition after the cap") is written for
one above `Nothing to bundle.`, so it never reached this verdict. Acted on as Tier A, that is a
second epic over an already-tracked issue, which the auto-close and `epic:next` cannot both be right
about (joshuafolkken/kit#943).

**Why choosing between epics is Tier A.** Reading a placement as a merge of epics is what used to
stop runs; bundling is reversible, merging is not.

**Why an epic and its parent are narrowed** (joshuafolkken/kit#1079). They were never two peers to
choose between. The verdict had recorded three such false positives, one of which stopped a whole
batch over an issue whose implementation was finished and whose pull request was mergeable.

**Why `--decision-file` writes both halves** (joshuafolkken/kit#1350). The epic half costs no round
trip inside the body edit the insertion already makes. Paying for the entry with a hand edit of the
epic body is why it got skipped; skipping it is not a shortcut past a formality but the half that
makes an unattended choice auditable. Leaving the entry unwritten is how two of the four most recent
placements in joshuafolkken/kit#1262 ended up with a child comment and nothing on the epic — the
already-tracked case still waits for an entry point (joshuafolkken/kit#1162).

**Why `issue:scout` is a separate command** (joshuafolkken/kit#1252). Whether the work was already
filed is a title comparison, which `epic:bundle` deliberately refuses as a signal.

## Execution waves — why a wave is not a mechanism

Wanting waves only became common once parallel lanes (joshuafolkken/kit#1170) let several children
run at once. What was missing was never the mechanism — it was that nobody had written down how to
build one, or when not to (joshuafolkken/kit#1584). `epic --remove` (joshuafolkken/kit#1712) is the
deletion counterpart of `--add`.

**Why `--before` / `--after <hub>` are refused.** `chains_containing` finds several indices;
`is_branching_after` does not hold, because it requires a successor in every chain naming the target
and a hub has none in any of them; so `ambiguous_position_error` is raised
(`scripts/epic/epic-chains.ts`).

**Why fan-in and fan-out are allowed.** `DECLARED_CHAIN_LINE` in `scripts/epic/epic-parse.ts` asks
only that a line be nothing but a chain, and `parse_dependency_links` expands each line independently
and flattens the result, dropping only self-loops. `find_anomalies` in `scripts/epic/epic-graph.ts`
rejects only a cycle and a declaration / `blocked-by` disagreement.

**Why there is no `solo` mechanism or exclusivity label.** A third axis — an exclusivity label, an
`## Exclusive` section — would put a second way to say what the dependency declaration already says,
and a second consistency check to keep the two agreeing. The answer to "how do I build waves" is
therefore a paragraph rather than a feature, and the cost of a declared boundary arriving at the end
of a wave rather than at the park is what makes one easy to declare and expensive to have declared.

**The worked example — joshuafolkken/kit#1474.** That epic has grown to 46 children while its
declared chains have stayed at three, and its body says why:

> **Not declared as a chain.** The 19 are nearly independent; declaring an order as a dependency
> would stop all the rest the moment one gets stuck. What follows is a recommendation, not a
> constraint. (translated)

The nineteen that paragraph was written about are ordered in prose — a group, not a graph — so a
reader gets the intent and no run is stopped by it, and none of the children added since has needed
a chain either. joshuafolkken/kit#1262 is the same lesson from the other side: 24 false dependencies
invented by `epic --add` have been removed from it, each one an order nobody needed that could have
stopped everything behind it.

## Where each rule came from

- The skill as the single source of these commands, with this file holding the history —
  joshuafolkken/kit#2892
- `epic:audit` closed-pair demotion — joshuafolkken/kit#1010, widened by joshuafolkken/kit#1597
- `epic:audit` cross-repository pair as a warning — joshuafolkken/kit#1128
- `epic:audit` epic-row finding, and `epic:next` never offering an epic child —
  joshuafolkken/kit#1476
- `epic:audit` orphan-search findings — joshuafolkken/kit#1033
- `epic:next --lanes` — joshuafolkken/kit#1491; several epics in one call — joshuafolkken/kit#1493
- Task-list order inside an epic — joshuafolkken/kit#1583; `--order-before` / `--order-after` —
  joshuafolkken/kit#1738
- A blocker outside every named epic — joshuafolkken/kit#1943
- Cross-repository checkout map and owner restriction — joshuafolkken/kit#869; non-publishing
  repositories — joshuafolkken/kit#1129; no child version bump — joshuafolkken/kit#1486
- `epic:bundle` reading closed references — joshuafolkken/kit#947; dropping nonexistent numbers —
  joshuafolkken/kit#957; cut listing — joshuafolkken/kit#1697; parent narrowing —
  joshuafolkken/kit#1079; `--decision-file` — joshuafolkken/kit#1350; `issue:scout` —
  joshuafolkken/kit#1252
- Entry point for decisions on already-tracked children (pending) — joshuafolkken/kit#1162
- Execution waves — joshuafolkken/kit#1584; `epic --remove` — joshuafolkken/kit#1712
