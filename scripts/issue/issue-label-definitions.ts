import {
	ALREADY_DONE_LABEL,
	AREA_BOARD_LABEL,
	AREA_THEME_LABEL,
	AUTO_OK_LABEL,
	BREAKING_CHANGE_LABEL,
	BUG_LABEL,
	BUGFIX_LABEL,
	DEFERRED_LABEL,
	ENHANCEMENT_LABEL,
	EPIC_LABEL,
	HANDOFF_IMPLEMENTING_LABEL,
	IGNORE_FOR_RELEASE_LABEL,
	IN_PROGRESS_LABEL,
	INTERRUPT_ROUTE_LABEL,
	MEASURED_LABEL,
	MEASURED_UNMET_LABEL,
	NEEDS_DECISION_LABEL,
	NEEDS_HUMAN_MERGE_LABEL,
	NEEDS_HUMAN_REVIEW_LABEL,
	NOT_BEFORE_LABEL,
	OTHER_CHANGE_LABEL,
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
	type ReleaseClassification,
} from './issue-labels'

// The color and description each label kit provisions is created with, kept apart from the names in
// `issue-labels.ts` so that module holds only the names and the comparisons on them. This module
// imports the names and `issue-labels.ts` never imports it back, so the two cannot form an import cycle.

interface LabelDefinition {
	name: string
	color: string
	description: string
}

// The route labels with the metadata `gh api ... labels` needs, in one place so a repository is
// provisioned from the single source rather than from scattered creation commands. Applying one at
// issue-creation time already auto-creates a missing label (REST, with a generated color and no
// description); creating them here first is what gives each its stable color and description.
const FILING_ROUTE_LABELS: ReadonlyArray<LabelDefinition> = [
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

// The areas `run:board` draws before a row's title (joshuafolkken/kit#8960).
const AREA_LABELS: ReadonlyArray<LabelDefinition> = [
	{ name: AREA_BOARD_LABEL, color: '006b75', description: 'Area: the run:board display' },
	{ name: AREA_THEME_LABEL, color: 'd876e3', description: 'Area: a run:board theme' },
]

// What `josh start` provisions on a new repository so the first `kickoff` finds every label a run
// applies with its intended color. The metadata is the one the workflow documents create each label
// with. **The labels only a person applies are provisioned too**: a person cannot apply a label the
// repository does not have, so leaving one out made the first `auto-ok` a manual creation step.
// `bug` is GitHub's default label, kept because `issue:file` applies it to a bug fix and a
// repository may have been created without the defaults.
const WORKFLOW_LABELS: ReadonlyArray<LabelDefinition> = [
	{
		name: EPIC_LABEL,
		color: '5319e7',
		description: 'Tracks a batch of child issues from one split',
	},
	{ name: IN_PROGRESS_LABEL, color: '0075ca', description: 'Work is actively in progress' },
	{ name: PLANNED_LABEL, color: 'c2e0c6', description: 'kickoff posted the plan' },
	{
		name: PLAN_UNVERIFIED_LABEL,
		color: 'e4e669',
		description: "Planned from another repository's checkout — re-plan in the target to run it",
	},
	{
		name: HANDOFF_IMPLEMENTING_LABEL,
		color: 'd4c5f9',
		description: 'Filed by a handed-off fullrun/halfrun/prrun new, which implements it itself',
	},
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
		name: PRIORITY_CRITICAL_LABEL,
		color: 'b60205',
		description: 'Offered before priority:high in a backlogrun; only a person removes it',
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
	{
		name: AUTO_OK_LABEL,
		color: '0e8a16',
		description: 'Opted in to unattended execution outside an epic',
	},
	{
		name: NEEDS_DECISION_LABEL,
		color: 'd93f0b',
		description: 'Parked: needs a decision before it can run',
	},
	{
		name: RUN_STALLED_LABEL,
		color: 'e99d42',
		description:
			'Parked: the driver could not finish it mechanically — no decision; fix the cause and remove',
	},
	{
		name: NEEDS_HUMAN_REVIEW_LABEL,
		color: 'd93f0b',
		description: 'Implement and verify, but stop before committing so a person can look',
	},
	{
		name: NEEDS_HUMAN_MERGE_LABEL,
		color: 'd93f0b',
		description: 'Pull request open: a person must inspect the diff and merge on GitHub',
	},
	{
		name: ALREADY_DONE_LABEL,
		color: '6f42c1',
		description: 'Verified already merged — a person closes it',
	},
	{
		name: MEASURED_LABEL,
		color: '6f42c1',
		description: 'Measurement-only — a run recorded the result and closed it',
	},
	{
		name: MEASURED_UNMET_LABEL,
		color: '6f42c1',
		description:
			'The measurement fell short of the expected effect — retire or shrink the mechanism',
	},
	{
		name: DEFERRED_LABEL,
		color: 'd4c5f9',
		description: 'Set aside for now; never opted in to unattended execution',
	},
	{
		name: NOT_BEFORE_LABEL,
		color: 'bfd4f2',
		description: "Waiting: the body's 実施可能日 has not arrived yet",
	},
	{ name: BUG_LABEL, color: 'd73a4a', description: "Something isn't working" },
	...FILING_ROUTE_LABELS,
	...AREA_LABELS,
]

// The release classifications `pr-classification.yml` requires exactly one of
// (`RELEASE_CLASSIFICATION_NAMES`), provisioned from this same list.
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

export type { LabelDefinition }
export { FILING_ROUTE_LABELS, RELEASE_CLASSIFICATION_LABELS, REPOSITORY_LABELS, WORKFLOW_LABELS }
