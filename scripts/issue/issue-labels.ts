// The workflow label names, defined once. The epic auto-close, the epic validator, the issue-prep
// labeler and the next-issues display all key on these exact strings, and a drifted copy would
// fail silently — an epic filtered on the wrong name is simply never closed or never excluded.
//
// **A new label is defined here and added to `REPOSITORY_LABELS`** (`issue-label-definitions.ts`,
// which holds each label's color and description), so `josh start` and `josh sync` create it; a
// label deliberately not provisioned goes into `EXEMPT_FROM_PROVISIONING` with its reason. Every other module imports the constant rather than spelling the name —
// `issue-label-scan.test.ts` fails on a `*_LABEL` constant missing from `ALL_LABELS`, on a label name
// spelled outside this module, and on a label call naming a label `ALL_LABELS` does not hold.
const EPIC_LABEL = 'epic'
const BUG_LABEL = 'bug'
const ENHANCEMENT_LABEL = 'enhancement'
const BREAKING_CHANGE_LABEL = 'breaking-change'
const IN_PROGRESS_LABEL = 'in-progress'
// Applied by `kickoff` once its plan is on the issue, so the next command's `run:entry` reads the issue
// as planned and starts at the implementation rather than planning again.
// Namespaced like `run:solo`: a bare `planned` is a common roadmap label a person may already apply,
// and reading one as kickoff's mark would skip the planning that never happened.
const PLANNED_LABEL = 'run:planned'
// Applied by `issue:plan --planned` in place of `run:planned` when `--repo` names a repository other
// than the working checkout's: that plan's estimate came from the wrong tree (joshuafolkken/kit#7733).
// `issue-auto-ok.ts` excludes it; re-planning from the target's checkout removes it.
const PLAN_UNVERIFIED_LABEL = 'plan:unverified'
// Applied by `issue:file` in a `run:handoff fullrun new` / `halfrun new` / `prrun new` child: that run
// implements the Issue itself, so `issue-auto-ok.ts` excludes it from `backlogrun`'s pool
// (joshuafolkken/kit#9143). A refused `run:handoff` lifts it (`run-handoff-release.ts`); a person
// resumes a run stopped later with `fullrun #N`.
const HANDOFF_IMPLEMENTING_LABEL = 'handoff:implementing'
// Parks a child that cannot advance without a person deciding something. `epic:next` is what reads
// it: a parked child is why a run reports "nothing left that time will fix" rather than waiting
// forever.
const NEEDS_DECISION_LABEL = 'needs-decision'
// Parks a child the `backlogrun` driver could not finish mechanically — its session ended unfinished, or
// its ship hit the relaunch cap. **Not `needs-decision`**: nothing is asked of a person beyond fixing the
// cause and removing it, so the board and the idle report keep it out of the decisions they list. Parked
// all the same, so a child failing on one cause is not handed straight back until the cause is fixed.
const RUN_STALLED_LABEL = 'run:stalled'
// Marks an issue whose defect reaches the verification path, so it runs with nothing beside it.
// A run applies it from the verification-path enumeration in `backlogrun-lanes.md`;
// `backlog:next` enforces it (`backlog-solo.ts`), so the rule no longer rests on a judgement at
// dispatch time.
const RUN_SOLO_LABEL = 'run:solo'
// The other half of the same judgement: an issue a run read and found safe to run beside others.
// Without it an issue lacking `run:solo` could mean "judged parallel" or
// "never judged", and `backlog:next` withholds the second (`epic-triage.ts`).
const RUN_LANE_LABEL = 'run:lane'
// Puts an issue at the head of the backlog's ranking, below `priority:critical`. `issue:file` applies
// it from the body's priority declaration at its high level (`issue-priority.ts`), a person may apply it by
// hand, and **only a person removes it**: a run that could clear it could undo the person's ordering.
// Read by `issue-rank.ts`, the one place the ranking keys are decided.
const PRIORITY_HIGH_LABEL = 'priority:high'
// Ranks above `priority:high` — an urgent defect (one of the interrupt-filing conditions) or a lane
// speed-up worth at least a tenth of a merge's median lane time. Applied from the urgent declaration,
// or on a person's instruction by `josh issue:priority --critical` (never an agent's own judgment);
// it never interrupts a running lane, only takes the next free one. Only a person removes it.
const PRIORITY_CRITICAL_LABEL = 'priority:critical'
// Opts one issue outside any epic into unattended execution. **Only a
// person applies it.** `epicrun #<E>` approves the merges inside `#<E>`; this label is the only way
// a person extends that approval past the epic's edge, so a label an AI could apply to itself would
// let an unattended run widen its own authorization — which is not a guard at all.
const AUTO_OK_LABEL = 'auto-ok'
// Degrades one issue's run to a `halfrun`-shaped stop: it is implemented and taken through the
// verification gate, and then nothing is committed, pushed, opened as a pull request or merged.
// **Only a person applies it** — a mark a run could clear for itself is not
// a mark.
//
// It is the opposite of `auto-ok` in what it does: one widens unattended execution past an epic's
// edge, the other withholds the last step of it. Unlike `auto-ok`, which `issue:file` applies by
// default to work found by opted-in work, no run ever applies it. `auto-ok`
// answers "may this run at all", this one answers "may its result ship without a person looking".
//
// **Not `needs-decision`, and the difference is what the two sets below encode.** A parked issue is
// one a run must not *start*; this one is started, and only its ending is withheld. So it stays out
// of `NOT_DIRECTLY_RUNNABLE_LABELS` — an issue nobody would ever offer cannot be implemented — and
// out of `epic-busy.ts`'s parked set, because a stopped child leaves uncommitted work in the
// checkout and must go on holding the repository. Read as parked in either place, the next child
// would start on top of that work.
const NEEDS_HUMAN_REVIEW_LABEL = 'needs-human-review'
// The PR is ready for a person to inspect and merge on GitHub.
const NEEDS_HUMAN_MERGE_LABEL = 'needs-human-merge'
// Marks an issue whose work a run verified is **already merged**. Closing
// an Issue is Tier C, so a run that reaches that conclusion may not act on it — this label is its
// exit that is not Tier C.
//
// **It is not `needs-decision`, and the difference is the whole reason it exists.** A parked issue
// waits for an answer nobody has given; this one has its answer already — the work is done, and all
// that is left is the close, which is a person's. Parked, it goes back into the offer the moment a
// person clears the label, and the next run repeats the same investigation.
//
// **Only a person removes it, by closing the issue.** A run applies it; nothing in the workflow
// takes it off, because taking it off asserts the work is *not* done, which is the same claim in
// reverse and is no more a run's to make.
const ALREADY_DONE_LABEL = 'already-done'
// The mark of a measurement-only Issue a run closed itself (`josh issue:measured`). No pull request
// closes such an Issue, so the merge reference a sweep reads is missing; this label is what tells the
// run's own close from a person's, so every sweep counts it as merged (`issue-merged.ts`).
const MEASURED_LABEL = 'measured'
// Rides beside `measured` when the measurement fell short of the expected effect it checked
// (`josh issue:measured --unmet`); `josh effect:audit` reads it as the mechanism to retire or shrink.
const MEASURED_UNMET_LABEL = 'measured:unmet'
// Marks the Issue that tracks a repository's next release. An Issue whose
// change reaches a consumer only once published is linked to it as a `blocked_by` blocker
// (`josh issue:release`), so "merged but not yet released" is visible in the backlog. A run applies
// it; **`auto-ok` never rides on it** — `issue-auto-ok.ts` excludes it, since a release is Tier C —
// and only a person opts it into unattended execution.
const RELEASE_LABEL = 'release'
// A person's mark for work set aside for now; `issue-auto-ok.ts` reads it as an exclusion. Applied by
// hand, so it is provisioned: a person cannot apply a label the repository does not have.
const DEFERRED_LABEL = 'deferred'
// A copy of the body's start-time declaration while that time is still ahead (`issue-not-before.ts`), so a
// listing tells an issue that waits on the clock from one that can start. The body stays the source:
// `issue-not-before-label.ts` applies and removes it. Only `run:merge` reads it as a reason to wait,
// and only where the body itself could not be read (`run-merge-steps.ts`).
const NOT_BEFORE_LABEL = 'not-before'

// The labels that park an open issue: a run never starts or restarts it, and only a person lifts
// them — `needs-decision` waits for an answer, `run:stalled` for a mechanical cause to be fixed, and
// `already-done` for the close, and `needs-human-merge` for a person to merge its ready PR. Each
// leaves a clean checkout. Held once because the merge, the board, the pool, the classification and the liveness
// read all ask "is this child parked", and a copy that missed a label would answer differently.
const PARKED_LABELS: ReadonlySet<string> = new Set([
	NEEDS_DECISION_LABEL,
	RUN_STALLED_LABEL,
	ALREADY_DONE_LABEL,
	NEEDS_HUMAN_MERGE_LABEL,
])

// The labels that mean an open issue must not be handed to a run as it stands: an `epic`
// tracks a batch and is never run directly (its children are), `in-progress` is already claimed by
// a running workflow, `plan:unverified` waits on a re-plan from the target's checkout, and a parked
// issue (`PARKED_LABELS`) waits on a person. Held here rather than in either
// caller because both the next-issues display and the `auto-ok` pickup ask the same question, and
// two copies would answer it differently the first time one of them gained another label.
//
// **`needs-human-review` is deliberately not among them.** It withholds the end of a run, not its
// start: an issue carrying it is implemented and verified like any other and only stops before the
// commit. Excluded here it would never be offered, so the work it asks a person to look at would
// never be produced — the label would silently become a second `needs-decision`.
const NOT_DIRECTLY_RUNNABLE_LABELS: ReadonlySet<string> = new Set([
	EPIC_LABEL,
	IN_PROGRESS_LABEL,
	PLAN_UNVERIFIED_LABEL,
	...PARKED_LABELS,
])

// Filing-route labels, applied at filing time so the backlog's composition — a review-cap
// carry-forward vs a split child vs a Tier A in-implementation filing — is countable with
// `gh api "repos/{owner}/{repo}/issues?labels=<route>"` instead of grepping issue bodies by hand,
// which does not reproduce. Purely
// informational: unlike the three above, a route label says nothing about whether an issue may run,
// so none of them joins NOT_DIRECTLY_RUNNABLE_LABELS. The names are duplicated as literals in the
// filing procedures (prose cannot import this module); `scripts/rules/filing-route-label.test.ts` keys the
// docs to these constants so a filing command that drops the label fails rather than drifting.
//
// `route:interrupt` is a defect found in *this* repository that does not block the run that found
// it, and which the WIP cap would otherwise push into the discretionary exit, surviving only as a
// comment on another issue. It is not `route:tier-a`: that one is a filing the run is blocked by (an
// upstream defect or a prerequisite), and reading the two as one loses the interrupt.
const INTERRUPT_ROUTE_LABEL = 'route:interrupt'
const REVIEW_CAP_ROUTE_LABEL = 'route:review-cap'
const SPLIT_ROUTE_LABEL = 'route:split'
const TIER_A_ROUTE_LABEL = 'route:tier-a'

// The area an issue is about (joshuafolkken/kit#8960), one per issue: `run:board` draws the word after
// the prefix before a row's title, so a new area needs a label and no code. A theme issue carries
// `area:theme` alone, not `area:board` as well.
const AREA_LABEL_PREFIX = 'area:'
const AREA_BOARD_LABEL = `${AREA_LABEL_PREFIX}board`
const AREA_THEME_LABEL = `${AREA_LABEL_PREFIX}theme`

// The pull request release classifications `pr-classification.yml` requires exactly one of.
// The check is distributed by `josh sync`, so the labels it asks for are
// provisioned from this same list — a repository that never had them would otherwise fail the check
// on every pull request that is not an `enhancement`.
const BUGFIX_LABEL = 'bugfix'
const OTHER_CHANGE_LABEL = 'other-change'
const IGNORE_FOR_RELEASE_LABEL = 'ignore-for-release'
const RELEASE_CLASSIFICATION_NAMES = [
	BREAKING_CHANGE_LABEL,
	ENHANCEMENT_LABEL,
	BUGFIX_LABEL,
	OTHER_CHANGE_LABEL,
	IGNORE_FOR_RELEASE_LABEL,
] as const
type ReleaseClassification = (typeof RELEASE_CLASSIFICATION_NAMES)[number]

// The shape `gh issue list --json labels` returns; narrowed here so the predicate below takes any
// listing row without importing a schema.
interface LabelReference {
	name: string
}

// GitHub keeps the casing a label was created with and treats `Epic` and `epic` as one label, so a
// repository that predates these scripts can answer with either spelling — every membership test
// lowercases, which is why the comparison lives here rather than at each call site.
function has_any_label(
	labels: ReadonlyArray<LabelReference> | undefined,
	wanted: ReadonlySet<string>,
): boolean {
	return (labels ?? []).some((label) => wanted.has(label.name.toLowerCase()))
}

// **The spelling GitHub actually stored**, matched by the same case-insensitive comparison every
// membership test above uses, or `undefined` where the issue does not carry the label at all.
//
// A membership test answers whether the label is there; a *removal* has to name it, and
// `DELETE …/issues/<N>/labels/<name>` names it in the path. Lowercasing the wanted name and sending
// that would be a second comparison — GitHub's, on a spelling we did not read — so the removal reads
// the stored one and sends it back.
function label_name_of(labels: ReadonlyArray<string>, wanted: string): string | undefined {
	const target = wanted.toLowerCase()

	return labels.find((label) => label.toLowerCase() === target)
}

// The same comparison for a caller holding label *names* rather than listing rows. `EpicChild.labels`
// is an array of strings (`scripts/epic/epic-graph.ts`), which is the one shape `has_any_label` cannot
// take — so `epic-classify.ts` and `epic-validate.ts` each grew a raw case-sensitive
// `Array.includes` instead, and an `Epic`-cased label walked past both. Kept here beside the rule it
// implements rather than at either call site, for the reason the comment above gives.
//
// Expressed through `label_name_of` rather than repeating its `.toLowerCase()` loop: one comparison,
// so a membership test and a removal can never disagree about what counts as the same label.
function has_label_name(labels: ReadonlyArray<string>, wanted: string): boolean {
	return label_name_of(labels, wanted) !== undefined
}

// The park label (`PARKED_LABELS`) label names carry, compared as `has_label_name` does.
function parked_label_of(labels: ReadonlyArray<string>): string | undefined {
	return [...PARKED_LABELS].find((label) => has_label_name(labels, label))
}

// Whether label names carry any park label (`PARKED_LABELS`).
function has_parked_label(labels: ReadonlyArray<string>): boolean {
	return parked_label_of(labels) !== undefined
}

// Every workflow label this package manages. The label-reference scan
// (`scripts/document/label-reference.test.ts`) reads this to check that no
// document operates on a label name that does not exist here — a stale or mistyped `labels[]=…`
// otherwise fails silently at run time. One source, so a label added above joins the scan without a
// second edit.
const ALL_LABELS: ReadonlySet<string> = new Set([
	EPIC_LABEL,
	BUG_LABEL,
	ENHANCEMENT_LABEL,
	BREAKING_CHANGE_LABEL,
	IN_PROGRESS_LABEL,
	PLANNED_LABEL,
	PLAN_UNVERIFIED_LABEL,
	HANDOFF_IMPLEMENTING_LABEL,
	NEEDS_DECISION_LABEL,
	RUN_STALLED_LABEL,
	AUTO_OK_LABEL,
	NEEDS_HUMAN_REVIEW_LABEL,
	NEEDS_HUMAN_MERGE_LABEL,
	ALREADY_DONE_LABEL,
	MEASURED_LABEL,
	MEASURED_UNMET_LABEL,
	DEFERRED_LABEL,
	PRIORITY_CRITICAL_LABEL,
	PRIORITY_HIGH_LABEL,
	RELEASE_LABEL,
	NOT_BEFORE_LABEL,
	INTERRUPT_ROUTE_LABEL,
	REVIEW_CAP_ROUTE_LABEL,
	RUN_LANE_LABEL,
	RUN_SOLO_LABEL,
	SPLIT_ROUTE_LABEL,
	TIER_A_ROUTE_LABEL,
	BUGFIX_LABEL,
	OTHER_CHANGE_LABEL,
	IGNORE_FOR_RELEASE_LABEL,
	AREA_BOARD_LABEL,
	AREA_THEME_LABEL,
])

// The managed labels `REPOSITORY_LABELS` deliberately does not provision, each with its reason. Every
// other member of `ALL_LABELS` is provisioned — `issue-labels.test.ts` fails on one that is in
// neither list, so a label added above cannot silently become one a repository lacks. Empty today.
const EXEMPT_FROM_PROVISIONING: ReadonlyMap<string, string> = new Map<string, string>()

export type { ReleaseClassification }
export {
	ALL_LABELS,
	ALREADY_DONE_LABEL,
	AREA_BOARD_LABEL,
	AREA_LABEL_PREFIX,
	AREA_THEME_LABEL,
	AUTO_OK_LABEL,
	BUG_LABEL,
	BUGFIX_LABEL,
	BREAKING_CHANGE_LABEL,
	DEFERRED_LABEL,
	ENHANCEMENT_LABEL,
	EPIC_LABEL,
	EXEMPT_FROM_PROVISIONING,
	HANDOFF_IMPLEMENTING_LABEL,
	has_any_label,
	has_label_name,
	has_parked_label,
	IGNORE_FOR_RELEASE_LABEL,
	IN_PROGRESS_LABEL,
	INTERRUPT_ROUTE_LABEL,
	label_name_of,
	MEASURED_LABEL,
	MEASURED_UNMET_LABEL,
	NEEDS_DECISION_LABEL,
	NEEDS_HUMAN_REVIEW_LABEL,
	NEEDS_HUMAN_MERGE_LABEL,
	NOT_BEFORE_LABEL,
	NOT_DIRECTLY_RUNNABLE_LABELS,
	OTHER_CHANGE_LABEL,
	parked_label_of,
	PARKED_LABELS,
	PLAN_UNVERIFIED_LABEL,
	PLANNED_LABEL,
	PRIORITY_CRITICAL_LABEL,
	PRIORITY_HIGH_LABEL,
	RELEASE_CLASSIFICATION_NAMES,
	RELEASE_LABEL,
	REVIEW_CAP_ROUTE_LABEL,
	RUN_LANE_LABEL,
	RUN_SOLO_LABEL,
	RUN_STALLED_LABEL,
	SPLIT_ROUTE_LABEL,
	TIER_A_ROUTE_LABEL,
}
