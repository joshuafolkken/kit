import type { EpicChild } from '#scripts/epic/epic-graph'
import { issue_auto_ok } from '#scripts/issue/issue-auto-ok'

// The offer order `backlog_overlap.separate` walks, with every candidate that stops for a person
// before its merge (its body declares the judgement as needed, `issue_auto_ok`) moved behind the
// last later candidate that completes on its own and declares an overlapping path. The overlap goes
// to whichever candidate comes first, so a candidate held at a human check otherwise kept a
// self-completing one waiting until that check was done (joshuafolkken/kit#8574). The `auto-ok`
// label cannot tell them apart — a person may grant it to an Issue that still declares the check —
// so the body does. Candidates that do not overlap, or sit on the same side, keep their order.

// Whether `left` declares a path `right` also declares.
type Overlapping = (left: EpicChild, right: EpicChild) => boolean

function stops_for_person(child: EpicChild): boolean {
	return issue_auto_ok.declares_judgement_needed(child.body ?? '')
}

// The candidate `child` is placed behind — itself unless it stops for a person and a later
// self-completing candidate overlaps it.
function anchor_of(
	child: EpicChild,
	later: ReadonlyArray<EpicChild>,
	is_overlapping: Overlapping,
): EpicChild {
	if (!stops_for_person(child)) return child

	const anchor = later.findLast((other) => !stops_for_person(other) && is_overlapping(child, other))

	return anchor ?? child
}

function ordered(offered: ReadonlyArray<EpicChild>, is_overlapping: Overlapping): Array<EpicChild> {
	const placed = offered.map((child, index) => ({
		child,
		anchor: anchor_of(child, offered.slice(index + 1), is_overlapping),
	}))

	return placed.flatMap(({ child, anchor }) => {
		if (anchor !== child) return []
		const behind = placed.filter((entry) => entry.anchor === child && entry.child !== child)

		return [child, ...behind.map((entry) => entry.child)]
	})
}

const backlog_human_stop_order = { ordered }

export type { Overlapping }
export { backlog_human_stop_order }
