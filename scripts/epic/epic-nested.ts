import { EPIC_LABEL, has_label_name } from '#scripts/git/issue-labels'
import type { EpicChild } from './epic-graph'

// Whether a task-list row points at another epic (joshuafolkken/kit#1476).
//
// An epic's body can hold `- [ ] #<another epic>` — nothing stops it being typed — and until this
// module nothing read it. `epic-classify.ts` sorted the row like any other child and
// `from_blockers` minted `runnable` for it, so `epicrun` handed an epic to `fullrun` as an ordinary
// issue and the run had nothing to implement.
//
// Two callers ask the question and they must not answer it differently: the classification, which
// **withholds** the row, and the audit, which **reports** it. Spelled twice they would drift, and a
// row the audit called fine would then be one the classification refused, or the reverse.

// **The test is the child's `epic` label, and nothing else.**
//
// It is deliberately not any reading of how the row is written. A row naming `owner/repo#N` is a
// **different** property, and a legitimate one: such a row disables the epic auto-close by design,
// which is why `CLAUDE.md` requires a cross-repository backlink to be written as prose rather than
// as a task-list row. Collapsing the two would refuse the very shape that document asks for.
//
// The properties are orthogonal, and all four combinations are meant to work: a cross-repository
// child that is not an epic stays runnable and unreported, and one that is an epic is withheld and
// reported exactly like a local one.
//
// The comparison is case-insensitive because GitHub keeps the casing a label was created with and
// treats `Epic` and `epic` as one label — a repository that predates these scripts can answer with
// either spelling, and a row read by eye against the lowercase string is one nothing withholds.
function is_nested_epic(child: EpicChild): boolean {
	return has_label_name(child.labels, EPIC_LABEL)
}

const epic_nested = {
	is_nested_epic,
}

export { epic_nested }
