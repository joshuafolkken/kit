// The workflow label names, defined once. The epic auto-close, the epic validator, the issue-prep
// labeler and the next-issues display all key on these exact strings, and a drifted copy would
// fail silently — an epic filtered on the wrong name is simply never closed or never excluded.
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
// Parks a child that cannot advance without a person deciding something. `epic:next` is what reads
// it: a parked child is why a run reports "nothing left that time will fix" rather than waiting
// forever.
const NEEDS_DECISION_LABEL = 'needs-decision'
// Marks an issue whose defect reaches the verification path, so it runs with nothing beside it.
// A run applies it from the verification-path enumeration in `backlogrun-lanes.md`;
// `backlog:next` enforces it (`backlog-solo.ts`), so the rule no longer rests on a judgement at
// dispatch time.
const RUN_SOLO_LABEL = 'run:solo'
// The other half of the same judgement: an issue a run read and found safe to run beside others.
// Without it an issue lacking `run:solo` could mean "judged parallel" or
// "never judged", and `backlog:next` withholds the second (`epic-triage.ts`).
const RUN_LANE_LABEL = 'run:lane'
// Puts an issue at the head of the backlog's ranking. A person or a run may
// apply it — a run only where it can cite a deadline or a stated urgency, or a policy a person wrote
// (`backlogrun-steps.md`) — and **only a person removes it**: a run that could clear it could undo
// the person's ordering. Read by `issue-rank.ts`, the one place the ranking keys are decided.
const PRIORITY_HIGH_LABEL = 'priority:high'
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
// Marks the Issue that tracks a repository's next release. An Issue whose
// change reaches a consumer only once published is linked to it as a `blocked_by` blocker
// (`josh issue:release`), so "merged but not yet released" is visible in the backlog. A run applies
// it; **`auto-ok` never rides on it** — `issue-auto-ok.ts` refuses the default for it on every path,
// since a release is Tier C — and only a person opts it into unattended execution.
const RELEASE_LABEL = 'release'

// The four labels that mean an open issue must not be handed to a run as it stands: an `epic`
// tracks a batch and is never run directly (its children are), `in-progress` is already claimed by
// a running workflow, `needs-decision` was parked precisely because it cannot advance without a
// person, and `already-done` names work that is already merged. Held here rather than in either
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
	NEEDS_DECISION_LABEL,
	ALREADY_DONE_LABEL,
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

// The route labels with the metadata `gh api ... labels` needs, in one place so a repository is
// provisioned from the single source rather than from scattered creation commands. Applying one at
// issue-creation time already auto-creates a missing label (REST, with a generated color and no
// description); creating them here first is what gives each its stable color and description.
const FILING_ROUTE_LABELS: ReadonlyArray<{
	name: string
	color: string
	description: string
}> = [
	{
		name: INTERRUPT_ROUTE_LABEL,
		// Not `5319e7`, which is the `epic` label's purple: in a listing an interrupt would render as
		// an epic, and the two are read at a glance rather than by name.
		color: '1d76db',
		// Keyed to the tests rather than to severity. "A serious defect" is the self-assessment
		// `wip-cap.md` bans as a criterion, and this string is what a person reads in `gh label list`.
		description: 'Filed past the WIP cap — meets one of the three interrupt tests (wip-cap.md)',
	},
	{
		name: REVIEW_CAP_ROUTE_LABEL,
		color: 'eab308',
		description:
			"Filed by the review round cap's carry-forward (prompts/review.md → Review round cap)",
	},
	{
		name: SPLIT_ROUTE_LABEL,
		color: '0e8a16',
		description: 'A child issue created by a split (split-assessment.md)',
	},
	{
		name: TIER_A_ROUTE_LABEL,
		color: 'd93f0b',
		description: 'Filed Tier A during implementation — an upstream defect or a prerequisite',
	},
]

// The depth of an issue's subject, recorded as a label at filing time.
//
// **The definition is not here.** `.claude/skills/workflow-commands/observation-filing.md` → "The depth test",
// is the single source: depth 0 is what a consumer of this package touches, depth 1 the run
// orchestration that executes an Issue, depth 2 what measures a run. These constants are the
// recording of that table, never a second copy of it — a label whose description restated the rule
// would be the clone `CLAUDE.md` prohibits, and the descriptions below therefore name the section
// rather than paraphrase it.
//
// **Why a label at all.** The share of open issues at depth 0 is a measured target, and without a
// recorded depth it could only be obtained by reading every open issue's body by hand — hand counts
// disagree on the denominator and are not comparable, which is the failure a recorded label removes.
//
// **The depth is read off the subject, so a run applies it.** Unlike `auto-ok` and
// `needs-human-review` this is not a person's judgement about authorization; it is the same reading
// `observation-filing.md` already asks a run to make before it files, and none of the three withholds or widens anything
// a run may do.
const DEPTH_0_LABEL = 'depth:0'
const DEPTH_1_LABEL = 'depth:1'
const DEPTH_2_LABEL = 'depth:2'

// Ordered shallowest first, which is what makes `depth_label_of` deterministic: an issue carrying
// more than one depth label counts as the **lowest** depth present, the one closest to the consumer.
// Without a fixed tie-break the same listing measured twice could answer differently.
const DEPTH_LABEL_ORDER: ReadonlyArray<string> = [DEPTH_0_LABEL, DEPTH_1_LABEL, DEPTH_2_LABEL]

// The metadata `gh api ... labels` needs, in the shape `FILING_ROUTE_LABELS` above uses and for the
// same reason: applying a label at issue-creation auto-creates it with a generated color and no
// description, so provisioning from here is what gives each one a stable color a reader can scan by.
// Green, amber and pale blue, so the consumer-facing depth is the one that stands out in a listing.
//
// **`josh issue:file` provisions them** through `repository_labels.ensure_labels` before its create
// call, so no document carries a creation command to keep in step.
const DEPTH_LABELS: ReadonlyArray<{
	name: string
	color: string
	description: string
}> = [
	{
		name: DEPTH_0_LABEL,
		color: '0e8a16',
		description: 'Depth 0 — what a consumer of this package touches (observation-filing.md)',
	},
	{
		name: DEPTH_1_LABEL,
		color: 'fbc02d',
		description: 'Depth 1 — the run orchestration that executes an Issue (observation-filing.md)',
	},
	{
		name: DEPTH_2_LABEL,
		color: 'c5def5',
		description: 'Depth 2 — what measures a run (observation-filing.md)',
	},
]

interface LabelDefinition {
	name: string
	color: string
	description: string
}

// What `josh start` provisions on a new repository so the first `kickoff` finds every label a run
// applies with its intended color. The `epic` and `in-progress` metadata is
// the one the workflow documents create them with; the labels only a person applies are left out.
const WORKFLOW_LABELS: ReadonlyArray<LabelDefinition> = [
	{
		name: EPIC_LABEL,
		color: '5319e7',
		description: 'Tracks a batch of child issues from one split',
	},
	{ name: IN_PROGRESS_LABEL, color: '0075ca', description: 'Work is actively in progress' },
	{ name: PLANNED_LABEL, color: 'c2e0c6', description: 'kickoff posted the plan' },
	{
		name: RUN_SOLO_LABEL,
		color: 'b60205',
		description: 'Runs alone in a backlogrun: nothing starts beside it',
	},
	{
		name: RUN_LANE_LABEL,
		color: '0e8a16',
		description: 'Judged safe to run beside others in a backlogrun',
	},
	{
		name: PRIORITY_HIGH_LABEL,
		color: 'e99695',
		description: 'Offered first in a backlogrun; only a person removes it',
	},
	{
		name: RELEASE_LABEL,
		color: 'fef2c0',
		description: 'Tracks the next release; its blockers are the merged work it publishes',
	},
	...FILING_ROUTE_LABELS,
	...DEPTH_LABELS,
]

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

const RELEASE_CLASSIFICATION_METADATA: Readonly<
	Record<ReleaseClassification, Omit<LabelDefinition, 'name'>>
> = {
	[BREAKING_CHANGE_LABEL]: { color: 'd93f0b', description: 'Release: a breaking change (major)' },
	[ENHANCEMENT_LABEL]: { color: '84b6eb', description: 'Release: a new feature (minor)' },
	[BUGFIX_LABEL]: { color: 'd73a4a', description: 'Release: a bug fix (patch)' },
	[OTHER_CHANGE_LABEL]: { color: 'c2e0c6', description: 'Release: any other change (patch)' },
	[IGNORE_FOR_RELEASE_LABEL]: { color: 'cfd3d7', description: 'Release: left out of the notes' },
}

const RELEASE_CLASSIFICATION_LABELS: ReadonlyArray<LabelDefinition> =
	RELEASE_CLASSIFICATION_NAMES.map((name) => ({ name, ...RELEASE_CLASSIFICATION_METADATA[name] }))

// Every label kit provisions on a repository — `josh start` on a new one, `josh sync` on every run.
const REPOSITORY_LABELS: ReadonlyArray<LabelDefinition> = [
	...WORKFLOW_LABELS,
	...RELEASE_CLASSIFICATION_LABELS,
]

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

// The depth recorded on one listing row, or `undefined` where none is — the reading every share
// measurement makes. Lowercased through the same comparison as every other membership test above,
// because GitHub keeps the casing a label was created with and `Depth:0` is the same label.
function depth_label_of(labels: ReadonlyArray<LabelReference> | undefined): string | undefined {
	const names = new Set((labels ?? []).map((label) => label.name.toLowerCase()))

	return DEPTH_LABEL_ORDER.find((name) => names.has(name))
}

// Every workflow label this package manages. The label-reference scan
// (`scripts/document/label-reference.test.ts`) reads this to check that no
// document operates on a label name that does not exist here — a stale or mistyped `labels[]=…`
// otherwise fails silently at run time. One source, so a label added above joins the scan without a
// second edit.
// Applied to an Issue whose second review round was skipped, so the condition stays auditable
// (`prompts/review.md` → "When round 2 is skipped entirely, and when it is not"). Provisioned inline
// by the run that applies it rather than through `FILING_ROUTE_LABELS`, but still a managed label the
// documents operate on, so the label-reference scan has to know it.
const REVIEW_ROUND2_SKIPPED_LABEL = 'review-round2-skipped'

const ALL_LABELS: ReadonlySet<string> = new Set([
	EPIC_LABEL,
	BUG_LABEL,
	ENHANCEMENT_LABEL,
	BREAKING_CHANGE_LABEL,
	IN_PROGRESS_LABEL,
	PLANNED_LABEL,
	NEEDS_DECISION_LABEL,
	AUTO_OK_LABEL,
	NEEDS_HUMAN_REVIEW_LABEL,
	ALREADY_DONE_LABEL,
	PRIORITY_HIGH_LABEL,
	RELEASE_LABEL,
	INTERRUPT_ROUTE_LABEL,
	REVIEW_CAP_ROUTE_LABEL,
	REVIEW_ROUND2_SKIPPED_LABEL,
	RUN_LANE_LABEL,
	RUN_SOLO_LABEL,
	SPLIT_ROUTE_LABEL,
	TIER_A_ROUTE_LABEL,
	DEPTH_0_LABEL,
	DEPTH_1_LABEL,
	DEPTH_2_LABEL,
	BUGFIX_LABEL,
	OTHER_CHANGE_LABEL,
	IGNORE_FOR_RELEASE_LABEL,
])

export type { LabelDefinition, ReleaseClassification }
export {
	ALL_LABELS,
	ALREADY_DONE_LABEL,
	AUTO_OK_LABEL,
	BUG_LABEL,
	BUGFIX_LABEL,
	BREAKING_CHANGE_LABEL,
	depth_label_of,
	DEPTH_0_LABEL,
	DEPTH_1_LABEL,
	DEPTH_2_LABEL,
	DEPTH_LABEL_ORDER,
	DEPTH_LABELS,
	ENHANCEMENT_LABEL,
	EPIC_LABEL,
	FILING_ROUTE_LABELS,
	has_any_label,
	has_label_name,
	IGNORE_FOR_RELEASE_LABEL,
	IN_PROGRESS_LABEL,
	INTERRUPT_ROUTE_LABEL,
	label_name_of,
	NEEDS_DECISION_LABEL,
	NEEDS_HUMAN_REVIEW_LABEL,
	NOT_DIRECTLY_RUNNABLE_LABELS,
	OTHER_CHANGE_LABEL,
	PLANNED_LABEL,
	PRIORITY_HIGH_LABEL,
	RELEASE_CLASSIFICATION_LABELS,
	RELEASE_CLASSIFICATION_NAMES,
	RELEASE_LABEL,
	REPOSITORY_LABELS,
	REVIEW_CAP_ROUTE_LABEL,
	REVIEW_ROUND2_SKIPPED_LABEL,
	RUN_LANE_LABEL,
	RUN_SOLO_LABEL,
	SPLIT_ROUTE_LABEL,
	TIER_A_ROUTE_LABEL,
	WORKFLOW_LABELS,
}
