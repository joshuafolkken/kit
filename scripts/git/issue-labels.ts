// The workflow label names, defined once. The epic auto-close, the epic validator, the issue-prep
// labeler and the next-issues display all key on these exact strings, and a drifted copy would
// fail silently — an epic filtered on the wrong name is simply never closed or never excluded.
const EPIC_LABEL = 'epic'
const IN_PROGRESS_LABEL = 'in-progress'
// Parks a child that cannot advance without a person deciding something. `epic:next` is what reads
// it: a parked child is why a run reports "nothing left that time will fix" rather than waiting
// forever (joshuafolkken/kit#860).
const NEEDS_DECISION_LABEL = 'needs-decision'
// Opts one issue outside any epic into unattended execution (joshuafolkken/kit#906). **Only a
// person applies it.** `epicrun #<E>` approves the merges inside `#<E>`; this label is the only way
// a person extends that approval past the epic's edge, so a label an AI could apply to itself would
// let an unattended run widen its own authorization — which is not a guard at all.
const AUTO_OK_LABEL = 'auto-ok'
// Degrades one issue's run to a `halfrun`-shaped stop: it is implemented and taken through the
// verification gate, and then nothing is committed, pushed, opened as a pull request or merged
// (joshuafolkken/kit#1125). **Only a person applies it**, exactly as strongly as `auto-ok` — a mark a
// run could clear for itself is not a mark.
//
// It is the opposite of `auto-ok` in what it does and its twin in who may apply it: one widens
// unattended execution past an epic's edge, the other withholds the last step of it. `auto-ok`
// answers "may this run at all", this one answers "may its result ship without a person looking".
//
// **Not `needs-decision`, and the difference is what the two sets below encode.** A parked issue is
// one a run must not *start*; this one is started, and only its ending is withheld. So it stays out
// of `NOT_DIRECTLY_RUNNABLE_LABELS` — an issue nobody would ever offer cannot be implemented — and
// out of `epic-busy.ts`'s parked set, because a stopped child leaves uncommitted work in the
// checkout and must go on holding the repository. Read as parked in either place, the next child
// would start on top of that work.
const NEEDS_HUMAN_REVIEW_LABEL = 'needs-human-review'

// The three labels that mean an open issue must not be handed to a run as it stands: an `epic`
// tracks a batch and is never run directly (its children are), `in-progress` is already claimed by
// a running workflow, and `needs-decision` was parked precisely because it cannot advance without a
// person. Held here rather than in either caller because both the next-issues display and the
// `auto-ok` pickup ask the same question, and two copies would answer it differently the first time
// one of them gained a fourth label.
//
// **`needs-human-review` is deliberately not a fourth.** It withholds the end of a run, not its
// start: an issue carrying it is implemented and verified like any other and only stops before the
// commit. Excluded here it would never be offered, so the work it asks a person to look at would
// never be produced — the label would silently become a second `needs-decision`.
const NOT_DIRECTLY_RUNNABLE_LABELS: ReadonlySet<string> = new Set([
	EPIC_LABEL,
	IN_PROGRESS_LABEL,
	NEEDS_DECISION_LABEL,
])

// joshuafolkken/kit#1083: filing-route labels, applied at filing time so the backlog's composition —
// a review-cap carry-forward vs a split child vs a Tier A in-implementation filing — is countable
// with `gh api "repos/{owner}/{repo}/issues?labels=<route>"` instead of grepping issue bodies by
// hand, which is how the 2026-08-30 breakdown was produced and why it did not reproduce. Purely
// informational: unlike the three above, a route label says nothing about whether an issue may run,
// so none of them joins NOT_DIRECTLY_RUNNABLE_LABELS. The names are duplicated as literals in the
// filing procedures (prose cannot import this module); `scripts/filing-route-label.test.ts` keys the
// docs to these constants so a filing command that drops the label fails rather than drifting.
const REVIEW_CAP_ROUTE_LABEL = 'route:review-cap'
const SPLIT_ROUTE_LABEL = 'route:split'
const TIER_A_ROUTE_LABEL = 'route:tier-a'

// The three route labels with the metadata `gh api ... labels` needs, in one place so a repository is
// provisioned from the single source rather than three scattered creation commands. Applying one at
// issue-creation time already auto-creates a missing label (REST, with a generated color and no
// description); creating them here first is what gives each its stable color and description.
const FILING_ROUTE_LABELS: ReadonlyArray<{
	name: string
	color: string
	description: string
}> = [
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

export {
	AUTO_OK_LABEL,
	EPIC_LABEL,
	FILING_ROUTE_LABELS,
	has_any_label,
	IN_PROGRESS_LABEL,
	NEEDS_DECISION_LABEL,
	NEEDS_HUMAN_REVIEW_LABEL,
	NOT_DIRECTLY_RUNNABLE_LABELS,
	REVIEW_CAP_ROUTE_LABEL,
	SPLIT_ROUTE_LABEL,
	TIER_A_ROUTE_LABEL,
}
