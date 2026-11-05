// The lane child's dedicated entry and the point-of-use sections its commands print.

import { run_step_section_table } from '#scripts/run/run-step-section-table'
import type { ReadSetCost, SectionReference } from './entry-read-set'
import { read_set_trim } from './read-set-trim'

const LANE_CHILD = 'lane-child'

// **The point-of-use documents a leaf child never reaches**: child dispatch, lane opening and the
// progress watcher / hand-off are the parent's, so their single-source documents are dropped from
// the child's read. **`latest-gate.md` is the parent's too**: the dependency
// update runs once per session in the outermost run, never in a dispatched lane child (`latest:scope`
// answers `skip` in a lane via the lane guard), so the child never opens `latest-gate.md`. The gate documents
// (`chain-rule.md`, `background-commands.md`), `followup.md` and `backlogrun-park.md` stay — a child
// runs the gate, opens its PR, and may park on a decision, so it does reach every one of those.
// **`retrospective.md` is the parent's too**: the end-of-run retrospective
// runs once at the batch's own end, never in a leaf child, so `run:step` answers `stop` for a child at
// the stop position and the child never opens it.
// **`backlogrun-steps.md` is the parent's too**: it is the scheduler's step
// list — what one invocation approves, the named-issue order, the session-cut record, the loop and the
// once-per-session tail — none of which a leaf child performs. Every reference to it lives in a
// document the child never reads (`backlogrun.md`, `backlogrun-progress.md`, `retrospective.md`) or in a
// `SKILL.md` section the child trims (§0's session-cut note), so the child has no path
// that opens it. It was the child's single largest read, read whole and charged for a
// document it never reaches, so dropping it is a correction of an over-count, not a loss of any rule the
// child needs. The parent still reads it in full.
// **`progress-watcher.md` is the parent's too**: a dispatched child is refused
// a watcher by its `JOSH_LANE_CHILD` mark, so it never opens the watcher's document.
const SKIPPED_POINT_OF_USE: ReadonlySet<string> = new Set([
	'backlogrun-child.md',
	'backlogrun-lanes.md',
	'backlogrun-progress.md',
	'backlogrun-steps.md',
	'delegation.md',
	'issue-scout.md',
	'latest-gate.md',
	'progress-watcher.md',
	'retrospective.md',
])

// **A child that parks reads `backlogrun-park.md`** (`SKILL.md` §1, "A lane child that parks"), a
// document a standalone `fullrun`'s path never names — so the child's reach adds it to its base
// entry's. **`pre-gate-cut.md` is the child's alone**:
// only a lane child resumes or takes the pre-gate cut, so `fullrun.md` stopped naming it and the
// child's reach carries it instead.
const REACHED_POINT_OF_USE: ReadonlySet<string> = new Set(['backlogrun-park.md', 'pre-gate-cut.md'])

// **The child reads `pre-gate-cut.md` only as the sections `run:cut` prints** (joshuafolkken/kit#5953),
// read off the command's own rows so the two never drift.
function printed_sections(): Array<SectionReference> {
	const rows = [
		run_step_section_table.CUT,
		run_step_section_table.RESUME,
		run_step_section_table.ENTRY,
	].map((key) => run_step_section_table.GOVERNING_SECTIONS.get(key))

	return rows
		.filter((found) => found !== undefined)
		.map((found) => ({ file: found.document, heading: found.heading }))
}

function costed(root: string): ReadSetCost {
	return read_set_trim.costed(root, {
		base_entry: LANE_CHILD,
		label: LANE_CHILD,
		unused_skill_sections: [],
		skipped_point_of_use: SKIPPED_POINT_OF_USE,
		reached_point_of_use: REACHED_POINT_OF_USE,
		printed_sections: printed_sections(),
	})
}

const lane_child_read_set = {
	LANE_CHILD,
	REACHED_POINT_OF_USE,
	SKIPPED_POINT_OF_USE,
	costed,
}

export { lane_child_read_set }
