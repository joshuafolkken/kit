import { epic_graph, type EpicChild } from '#scripts/epic/epic-graph'
import { issue_auto_ok } from '#scripts/issue/issue-auto-ok'

// The offer order `backlog_overlap.separate` walks: for each candidate that stops for a person
// before its merge (its body declares the judgement as needed, `issue_auto_ok`), the first later
// candidate that completes on its own and declares an overlapping path moves up into its slot, just
// ahead of it. The overlap goes to whichever candidate comes first, so a candidate held at a human
// check otherwise kept a self-completing one waiting until that check was done
// (joshuafolkken/kit#8574). The self-completing one takes the slot rather than the other dropping
// back, so the cap after the separation still keeps one of the two, and when a running lane
// withholds the self-completing one the other keeps its rank. The `auto-ok` label cannot tell them
// apart — a person may grant it to an Issue that still declares the check — so the body does.
// Candidates that do not overlap, or sit on the same side, keep their order.

// Whether `left` declares a path `right` also declares.
type Overlapping = (left: EpicChild, right: EpicChild) => boolean

function stops_for_person(child: EpicChild): boolean {
	return issue_auto_ok.declares_judgement_needed(child.body ?? '')
}

// Whether `child` gives its slot up — it stops for a person and did not give its lane back
// already: a yielded issue keeps the first free lane `yielded_first` promises it
// (joshuafolkken/kit#5107).
function gives_slot_up(child: EpicChild, yielded: ReadonlySet<string>): boolean {
	return stops_for_person(child) && !yielded.has(epic_graph.key_of(child))
}

// The candidate placed into `child`'s slot — itself unless it gives the slot up and a later
// self-completing candidate overlaps it.
function promoted_of(
	child: EpicChild,
	later: ReadonlyArray<EpicChild>,
	is_overlapping: Overlapping,
	yielded: ReadonlySet<string>,
): EpicChild {
	if (!gives_slot_up(child, yielded)) return child

	const promoted = later.find((other) => !stops_for_person(other) && is_overlapping(child, other))

	return promoted ?? child
}

// `yielded`: the keys of the issues that gave their lane back (`lane-yield.ts`).
function ordered(
	offered: ReadonlyArray<EpicChild>,
	is_overlapping: Overlapping,
	yielded: ReadonlySet<string> = new Set(),
): Array<EpicChild> {
	const slots = offered.flatMap((child, index) => [
		promoted_of(child, offered.slice(index + 1), is_overlapping, yielded),
		child,
	])

	return [...new Set(slots)]
}

const backlog_human_stop_order = { ordered }

export type { Overlapping }
export { backlog_human_stop_order }
