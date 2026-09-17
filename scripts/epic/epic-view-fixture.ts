import type { EpicSnapshot } from './epic-fetch'
import { epic_next } from './epic-next'
import type { EpicView } from './epic-next-views'

// One epic in the shape `epic_next.report` takes since joshuafolkken/kit#1493 made it take several.
// Shared rather than spelled out in each suite: the suites that predate the multi-epic entry all
// build the same one-element list, and a second spelling of it drifts the moment `EpicView` grows a
// field.
function single_view(snapshot: EpicSnapshot, epic_number: number): Array<EpicView> {
	return [{ reference: { number: epic_number }, snapshot, result: epic_next.decide(snapshot) }]
}

const epic_view_fixture = { single_view }

export { epic_view_fixture }
