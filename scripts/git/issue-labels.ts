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
// Marks an issue whose work a run verified is **already merged** (joshuafolkken/kit#1679). Closing
// an Issue is Tier C, so a run that reaches that conclusion may not act on it — and before this
// label there was no exit that was not Tier C: `fullrun #1656` verified the work was already in
// `main` from joshuafolkken/kit#1623 and closed the Issue itself.
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

// joshuafolkken/kit#1083: filing-route labels, applied at filing time so the backlog's composition —
// a review-cap carry-forward vs a split child vs a Tier A in-implementation filing — is countable
// with `gh api "repos/{owner}/{repo}/issues?labels=<route>"` instead of grepping issue bodies by
// hand, which is how the 2026-08-30 breakdown was produced and why it did not reproduce. Purely
// informational: unlike the three above, a route label says nothing about whether an issue may run,
// so none of them joins NOT_DIRECTLY_RUNNABLE_LABELS. The names are duplicated as literals in the
// filing procedures (prose cannot import this module); `scripts/filing-route-label.test.ts` keys the
// docs to these constants so a filing command that drops the label fails rather than drifting.
//
// joshuafolkken/kit#1518 added a fourth: an interrupt is a defect found in *this* repository that
// does not block the run that found it, and which the WIP cap would otherwise push into the
// discretionary exit — the route joshuafolkken/kit#1517 took, surviving only as a comment on another
// issue. It is not `route:tier-a`: that one is a filing the run is blocked by (an upstream defect or
// a prerequisite), and reading the two as one is what lost #1517.
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

// joshuafolkken/kit#1729: the depth of an issue's subject, recorded as a label at filing time.
//
// **The definition is not here.** `.claude/skills/workflow-commands/SKILL.md` → §2i, "The depth test",
// is the single source: depth 0 is what a consumer of this package touches, depth 1 the run
// orchestration that executes an Issue, depth 2 what measures a run. These constants are the
// recording of that table, never a second copy of it — a label whose description restated the rule
// would be the clone `CLAUDE.md` prohibits, and the descriptions below therefore name the section
// rather than paraphrase it.
//
// **Why a label at all.** joshuafolkken/kit#1698 set a measurable target — the share of open issues
// at depth 0 — and left nothing that records a depth, so the share could only be obtained by reading
// every open issue's body by hand. Two hand counts a day apart disagreed on the denominator and were
// therefore not comparable, which is the failure a recorded label removes.
//
// **The depth is read off the subject, so a run applies it.** Unlike `auto-ok` and
// `needs-human-review` this is not a person's judgement about authorization; it is the same reading
// §2i already asks a run to make before it files, and none of the three withholds or widens anything
// a run may do.
const DEPTH_0_LABEL = 'depth:0'
const DEPTH_1_LABEL = 'depth:1'
const DEPTH_2_LABEL = 'depth:2'

// Ordered shallowest first, which is what makes `depth_label_of` deterministic: an issue carrying
// more than one depth label counts as the **lowest** depth present, the one closest to the consumer.
// Without a fixed tie-break the same listing measured twice could answer differently, which is the
// whole defect joshuafolkken/kit#1729 was filed for.
const DEPTH_LABEL_ORDER: ReadonlyArray<string> = [DEPTH_0_LABEL, DEPTH_1_LABEL, DEPTH_2_LABEL]

// The metadata `gh api ... labels` needs, in the shape `FILING_ROUTE_LABELS` above uses and for the
// same reason: applying a label at issue-creation auto-creates it with a generated color and no
// description, so provisioning from here is what gives each one a stable color a reader can scan by.
// Green, amber and pale blue, so the consumer-facing depth is the one that stands out in a listing.
//
// **The provisioning command lives in `SKILL.md` → §2i**, because prose cannot import this module —
// the same split `FILING_ROUTE_LABELS` above lives with. `scripts/issue-depth-label.test.ts` keys
// those three command lines to this array, so a color changed here without the document fails.
const DEPTH_LABELS: ReadonlyArray<{
	name: string
	color: string
	description: string
}> = [
	{
		name: DEPTH_0_LABEL,
		color: '0e8a16',
		description: 'Depth 0 — what a consumer of this package touches (SKILL.md §2i)',
	},
	{
		name: DEPTH_1_LABEL,
		color: 'fbc02d',
		description: 'Depth 1 — the run orchestration that executes an Issue (SKILL.md §2i)',
	},
	{
		name: DEPTH_2_LABEL,
		color: 'c5def5',
		description: 'Depth 2 — what measures a run (SKILL.md §2i)',
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

// The same comparison for a caller holding label *names* rather than listing rows. `EpicChild.labels`
// is an array of strings (`scripts/epic/epic-graph.ts`), which is the one shape `has_any_label` cannot
// take — so `epic-classify.ts` and `git-epic-validate.ts` each grew a raw case-sensitive
// `Array.includes` instead, and an `Epic`-cased label walked past both. Kept here beside the rule it
// implements rather than at either call site, for the reason the comment above gives.
function has_label_name(labels: ReadonlyArray<string>, wanted: string): boolean {
	const target = wanted.toLowerCase()

	return labels.some((label) => label.toLowerCase() === target)
}

// The depth recorded on one listing row, or `undefined` where none is — the reading every share
// measurement makes. Lowercased through the same comparison as every other membership test above,
// because GitHub keeps the casing a label was created with and `Depth:0` is the same label.
function depth_label_of(labels: ReadonlyArray<LabelReference> | undefined): string | undefined {
	const names = new Set((labels ?? []).map((label) => label.name.toLowerCase()))

	return DEPTH_LABEL_ORDER.find((name) => names.has(name))
}

export {
	ALREADY_DONE_LABEL,
	AUTO_OK_LABEL,
	depth_label_of,
	DEPTH_0_LABEL,
	DEPTH_1_LABEL,
	DEPTH_2_LABEL,
	DEPTH_LABEL_ORDER,
	DEPTH_LABELS,
	EPIC_LABEL,
	FILING_ROUTE_LABELS,
	has_any_label,
	has_label_name,
	IN_PROGRESS_LABEL,
	INTERRUPT_ROUTE_LABEL,
	NEEDS_DECISION_LABEL,
	NEEDS_HUMAN_REVIEW_LABEL,
	NOT_DIRECTLY_RUNNABLE_LABELS,
	REVIEW_CAP_ROUTE_LABEL,
	SPLIT_ROUTE_LABEL,
	TIER_A_ROUTE_LABEL,
}
