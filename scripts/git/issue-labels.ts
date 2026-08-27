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

// The three labels that mean an open issue must not be handed to a run as it stands: an `epic`
// tracks a batch and is never run directly (its children are), `in-progress` is already claimed by
// a running workflow, and `needs-decision` was parked precisely because it cannot advance without a
// person. Held here rather than in either caller because both the next-issues display and the
// `auto-ok` pickup ask the same question, and two copies would answer it differently the first time
// one of them gained a fourth label.
const NOT_DIRECTLY_RUNNABLE_LABELS: ReadonlySet<string> = new Set([
	EPIC_LABEL,
	IN_PROGRESS_LABEL,
	NEEDS_DECISION_LABEL,
])

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
	has_any_label,
	IN_PROGRESS_LABEL,
	NEEDS_DECISION_LABEL,
	NOT_DIRECTLY_RUNNABLE_LABELS,
}
