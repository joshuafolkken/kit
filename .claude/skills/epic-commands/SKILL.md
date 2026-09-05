---
name: epic-commands
description: The procedures for the `josh epic:*` commands that make an epic runnable without a person watching — `epic:plan` (front-load every decision into one batch), `epic:audit` (find contradictions across the children), `epic:next` (what is runnable, per repository), and `epic:bundle` (does a newly filed issue belong with one already in the backlog). Also how an epic spans repositories and why a cross-repository dependency waits for a publish. Read this before running any of those commands, before writing an epic that tracks a child in another repository, and right after filing an issue.
---

# The `josh epic:*` commands

These four commands are what turn an epic from a list of issue numbers into something a run can
execute unattended. The canonical extended reference is `prompts/collaboration-workflow/` — `epic-bundle.md`, `epic-audit.md` and `cross-repo-epic.md` between them; this
skill is the operational procedure, and the two must agree. **`epic:plan` is no longer among them**:
its body is single-sourced here (joshuafolkken/kit#1189, the joshuafolkken/kit#1174 rollout), and
`prompts/collaboration-workflow/epic-plan.md` is a pointer to this file rather than a second copy.

The workflow keywords themselves — `kickoff`, `fullrun`, `halfrun`, `queue`, `epicrun` — live in the
`workflow-commands` skill.

## The order they run in

```
epic:plan  phase 0 → epic:audit, and fix what it finds (Tier A)
           phase 1 → read the plan, triage every decision: auto / ask / defer
           phase 2 → put every `ask` as ONE question for the whole epic
           phase 3 → epicrun, which calls epic:next each round
```

## `josh epic:plan <E>` — one batch of decisions

Prints every child's number, title, body, labels, `blockedBy` and state as one JSON document. The
alias is `pnpm josh el <E>`.

Most of the stops an implementation makes could have been answered before it started. Arriving
scattered is what forces a person to wait through the run; asking per child asks the same question
several times; and the answers end up only in a conversation nobody can read back.

- **Phase 0 is not optional.** A batch decision made on a plan that contradicts itself has to be made
  again once the contradiction surfaces. Run `pnpm josh epic:audit <E>` before phase 1 and let it
  surface the four things a hand read misses — a dependency cycle, an ordering contradiction, an
  implicit dependency, and a child no task list tracks. **Fix what it finds as Tier A, without asking,
  and record the reasoning on the Issue**; only a contradiction that needs a person's judgement joins
  phase 2's `ask`.
- **Phase 0 is a step of the procedure, not a confirmation that may be skipped.** An epic whose
  contradictions surface only once a person says "go find the bugs" has no unattended execution to
  speak of — the run stalls at the first one, and nobody is watching. That is what phase 0 is for.
- **Triage** — every decision the plan surfaces goes into one of three classes. **What separates the
  first two is the margin, not the difficulty**: a class read off how hard a decision feels is what
  sends an `auto` into phase 2 and doubles the question a person is asked.

  | Class | What it is | What happens to it |
  | --- | --- | --- |
  | `auto` | Tier A — one option is clearly better on the merits | Decide it, and record it when the child is implemented |
  | `ask` | Tier B/C — the top options are close, or the action is irreversible | Collect it for phase 2 |
  | `defer` | Out of scope for this epic | File it as a follow-up Issue |
- **Phase 2 is one question for the whole epic**, never one per child.
- Record each answer in **both** the epic's `## Decisions` and a comment on each child it applies to.
  One without the other leaves either the child's reader without the reasoning or the epic without
  the decision.
- **Which command writes them depends on whether the child is being inserted.** A decision taken *as* a
  child joins the epic goes through `pnpm josh epic --add … --decision-file` — the `epic:bundle` section
  below is that flag's single source. Phase 2's answers are about children the epic **already tracks**,
  which that flag cannot serve: an insertion with nothing to add is refused outright. Until
  joshuafolkken/kit#1162 adds an entry point for already-tracked children, write the child comments with
  `gh issue comment` on each child the answer applies to, and **say in the report that the epic's
  `## Decisions` entry is still pending** — the entry going unwritten is exactly how two of the four most
  recent placements in joshuafolkken/kit#1262 ended up with a child comment and nothing on the epic.
  **Do not carry it on the next unrelated `--add --decision-file`**: that call posts the record as a
  comment on the child it is *inserting*, so a decision about `#A` and `#B` would arrive on `#C`, which
  has nothing to do with it — and `#A` and `#B` would still get nothing from that call.
- **Recording a decision removes that child's `needs-decision` label** (Tier A). Without it the child
  stays parked after the answer arrived. The label-clearing rule itself is defined by
  `.claude/skills/workflow-commands/epicrun.md` → "park and continue"; what this section adds is the
  moment it fires — the answer being written down.

```md
## Decisions

### <the point that was decided>

- 対象: #101, #102
- 採用: <the option taken>
- 却下: <the option rejected>
- 理由: <why the taken option is clearly better>
- 決定日: <YYYY-MM-DD>
```

An epic whose task list tracks nothing is an empty plan, not a failure. An epic whose *body could not
be read* is a failure — an empty plan there is indistinguishable from a finished one.

## `josh epic:audit <E>` — contradictions across the children

`epic:check` verifies one epic's *format*. Nothing verified that the children agree, and a hand audit
of a real epic found two contradictions that would have stalled the implementation while
`epic:check` reported every requirement as passing.

Run it **without being asked**: at the start of an `epicrun`, as `epic:plan`'s phase 0, and right
after a child is added or a dependency changed.

The cycle and declaration-mismatch checks are `epic:next`'s, reused rather than re-derived. What this
adds is reading *inside* the children:

| Check | Level |
| --- | --- |
| A child's body names another child, nothing orders the two | warning |
| A child's **acceptance criteria** name another child, nothing orders the two | **error**; a warning once both children are closed, and a warning when the pair is in two repositories (joshuafolkken/kit#1128 — such an order only became recordable with joshuafolkken/kit#1126, so an error would stop every epic written before it). A warning there does **not** mean the pair is safe: the child is still offered as runnable, and recording the relation is what clears it |
| A body cites a missing or already-closed issue | warning |
| An issue names this epic as parent that the task list does not track | warning |
| The search for those issues could not read the open backlog | **error** |
| That search stopped before the end of the backlog | warning |

**Only errors fail it.** The first check fires on a legitimate forward reference as readily as on a
real missing dependency; failing on both would make design notes unwritable. A forward reference the
other child *already depends on* is not reported at all.

**A pair whose children are both closed is a warning, not an error.** What makes an undeclared order
a contradiction is that the criteria's child *can run first*, and neither child has any execution
left — so an epic that once forgot to declare an order would otherwise fail its audit forever, which
stops every future `epicrun` on it at the first step. It is demoted rather than dropped because
dropping it hands the same pair to the first check, which reports it as an implicit dependency
instead: the same one line, minus the detail that the name is in the acceptance criteria
(joshuafolkken/kit#1010).

**Fixing what it finds is Tier A** — re-pointing a dependency or correcting prose is reversible and
will otherwise stall the work. Park with `needs-decision` only when the contradiction is a design
choice nobody has made.

**The two `orphan search` findings are the exception, because neither is a contradiction.** They are
about the search itself rather than about anything the children say (joshuafolkken/kit#1033):

- `✖ orphan search: Could not list the open issues…` — the search never ran, so "no orphans" would
  be a claim about a listing that never arrived. It fails the audit, which stops an `epicrun` at its
  step 0. **Re-run the audit**; that is the whole response. There is nothing to fix and nothing to
  decide, so neither Tier A nor a `needs-decision` park applies. If it keeps failing, check
  `gh auth status` and whether the rate limit has reset.
- `⚠ orphan search: The open-issue scan hit its …` — the search covered only the newest part of the
  backlog (500 issues, or 50 bodies mentioning the epic). It ran, so the audit passes; read the line,
  and look further down the backlog by hand if an orphan is expected there.

**One thing it cannot check** belongs to planning: when a child introduces a new label, command,
state or artifact, list the existing code referencing that concept and confirm some child owns
updating it. Label names are single-sourced in `scripts/git/issue-labels.ts`.

## `josh epic:next <E>` — what is runnable

Returns **every** runnable child, bundled per repository with the local checkout to run it in.
`--repo <owner/repo>` narrows to one and prints a single token: the issue number, or the verdict.

Children that are not runnable are sorted by **whether waiting helps**, never by label:

| Bucket | Caller does |
| --- | --- |
| Runnable | Run it |
| Waiting on time | Wait and ask again |
| Waiting on a person | Stop and report |

Reading labels instead fails in an ordinary state: when one repository's child has closed and
another's is waiting for a release to publish, nothing carries `in-progress` or `needs-decision` —
and a label-based reading calls that "done" in the one moment it must wait.

Two things stop the command rather than being worked around: a **circular dependency**, and a
**disagreement between the epic body and the `blocked-by` relations** (an epic written before `josh`
recorded them, a recording that failed, or a relation hand-added since). Only a line that is
*nothing but* a chain counts as a declaration — a prose line recommending an execution order is a suggestion, not a dependency.

## Epics that span repositories

Write cross-repository children in the task list as `owner/repo#N` or a full issue URL. Their state
is read against that repository through `gh api`, so **no local clone is needed to learn it** — only
to implement.

- **The owner restriction is inherited unchanged**: a repository with a different owner is never a
  target, by any route.
- **The epic auto-closes only when every cross-repository child's state could actually be read.** One
  unreadable child leaves it open, exactly as before.
- **An epic in another repository must be referenced as `owner/repo#N`** — `epicrun
  joshuafolkken/kit#858`. A bare `#N` resolves to *this* repository's issue of that number.

**A dependency that crosses a repository is not satisfied by the blocking issue closing.** Merging
does not publish: the merge, the auto-tag and the publish run one after another, so a consumer told
it may start at that moment installs the previous release or fails outright — "it breaks sometimes",
the hardest kind to diagnose. It resolves only when the blocker is closed **and** the version its
default branch declares has appeared in the registry.

**Unless that repository publishes nothing** (joshuafolkken/kit#1129). A repository with no
`package.json` on its default branch, or one declaring `private`, ships no release for the check to
wait on — so a closed blocker there resolves rather than waiting until the run's own eight-hour
timeout with nothing an operator can edit to clear it. The answer is read from the blocker
repository's own manifest and never from the registry: a registry 404 also means "this token may not
see it", so resolving on one would start a consumer child before its blocker's release existed.

**The evaluation is an AND in that order.** While the blocker is open the registry is never
consulted, so a run never stalls on a publish from the moment it starts. The target is that exact
version, never "something newer" — a consumer several releases behind would otherwise be satisfied by
a publish that predates the change.

## `josh epic:bundle <N>` — does this new issue belong with one already filed?

Run it right after an issue is filed: by `kickoff` / `fullrun` / `halfrun`, or by any Tier A filing
mid-implementation, including inside an `epicrun`. **It recommends; it writes nothing.**

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
read. Reported as a gap it puts `⚠ Could not read #N.` above the verdict, and the rule below stops an
unattended run on exactly that, for a reference that never existed (joshuafolkken/kit#957). **The two
are told apart by HTTP status, never by `gh`'s wording**: 404 is nothing at that number, 403 and 429
are a rate limit. GitHub answers 404 for an issue the token may not see as well, so as not to leak
its existence — which does not reach this command, because it probes the repository whose open issues
it has just listed. The probe costs one REST request and runs **only** when a read has already
failed, and only on the path that needs the distinction: the backlog's own relation reads, up to two
hundred of them, never pay it.

| Candidates | Do | Tier |
| --- | --- | --- |
| **The new issue itself already has an epic** | Nothing — an issue belongs to at most one | — |
| Already a child of an epic | Add to **that** epic; do not create a second | A |
| Spread across **different** epics | **Choose the one you recommend, add to it, and record why** | **A** |
| In no epic, two or more counting the new issue | Create an epic | A |
| No strong signal | Nothing | — |

**Placing an issue is not merging epics, and reading it as one is what used to stop runs.** Bundling
is reversible — one `epic --add` moves an issue to a different epic — so choosing between two
candidate epics is Tier A: take the one you recommend, and write the decision (what was taken, what
was rejected, why, and the date) on **both** the issue and the epic's `## Decisions`. **Merging two
epics is a different action, and nothing here proposes it**: this verdict fires whenever related
issues sit in different epics, which includes an epic and its own parent — joshuafolkken/kit#1079
records three such false positives, one of which stopped a whole batch over an issue whose
implementation was finished and whose pull request was mergeable. Stop only where the two epics are
genuinely too close to separate, which is the toss-up Tier B is for and is rare.

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

`epic:plan` phase 2's answers are about children the epic already tracks and cannot use this flag; that
section says what to do instead.

**Its sibling runs before the filing, not after it: `pnpm josh issue:scout "<title>"`.** That command
answers the same epic question for an issue that does not exist yet — this decision, called rather
than restated — and beside it the one thing this one deliberately refuses: whether the work has
already been filed, from a title comparison (joshuafolkken/kit#1252). **Both run**, and neither
replaces the other: the scout is what a `new` entry point asks before `gh api … issues`, and
`epic:bundle` is what it asks afterwards, from the real number and the relations recorded against it.
Full behavior: `docs/josh-commands.md` → "`josh issue:scout`".

**When the relation carries an order, record it** in `blocked-by` and in the epic's `Dependencies` —
on an addition as much as on a new epic. Without it the batch survives and the reason for it does
not. An order **nobody declared is not invented**.
