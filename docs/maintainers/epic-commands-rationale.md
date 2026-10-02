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
reappear one line lower as an `implicit dependency`, minus the one detail worth reading.

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
edit to clear it.

## `epic:bundle` — why issues filed apart are bundled afterwards

"Two or more always means an epic" fires only when one request is split on the spot. Issues filed at
different times were never bundled, so three cases slipped through: a Tier A filing mid-implementation
that had an order with an open issue, two issues filed days apart that were the front and back of one
job, and an existing issue later found to need an execution order. Each ran on its own, out of order,
with the reason for the split recorded nowhere.

**The follow-up filing route.** The review cap (`prompts/review.md` → "Review round cap") is the
workflow's busiest filing route, yet its procedure long stopped at "file it and reference the current
issue", with nothing leading to the bundling. joshuafolkken/kit#943 was cut from a second review round,
named `親: joshuafolkken/kit#891` in its body, and joined no epic; #891 closed three minutes later. On
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
