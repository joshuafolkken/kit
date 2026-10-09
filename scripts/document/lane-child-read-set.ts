// What a dispatched lane child reads, and what that costs.
//
// **A lane child is the largest fixed cost a `backlogrun` has.** Measured on the batch of
// 2026-09-13, the lane child sessions were 72% of the run's whole input,
// and each `claude -p fullrun #N` child read the `fullrun` entry set in full — around 227KB. Most of
// that is spent on procedure a leaf child never carries out: it dispatches no child of its own, opens
// no lane, runs no progress watcher and performs no hand-off, so the point-of-use documents that
// carry those steps are read by the parent and never by the child.
//
// **This models the child as a trimmed `fullrun`, derived rather than transcribed.** The set is the
// `fullrun` entry read with two subtractions — the `SKILL.md` sections a child never uses read at the
// section level, and the point-of-use documents a leaf never reaches dropped — applied by the shared
// `read-set-trim`, which the `backlogrun` parent trim uses too.

import type { ReadSetCost } from './entry-read-set'
import { read_set_trim } from './read-set-trim'

const LANE_CHILD = 'lane-child'
const FULLRUN = 'fullrun'

// **The `SKILL.md` sections a dispatched lane child never uses**, read at the section level rather
// than in full. A child never edits these documents (§3), and its dispatch is already an explicit
// workflow invocation, so §0 cannot decide anything for it either. The other rules it never uses — the
// `into` target, delegation, the repository prefix, the scout, observation filing, the retrospective —
// are single rows of §2's table, so no section of them is left to trim.
const UNUSED_SKILL_SECTIONS: ReadonlyArray<string> = [
	'0. The rule that fires before any of them — explicit invocation',
	'3. What stays resident, and what is read from here',
]

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
// that opens it. It was the child's single largest read — ~16,000 tokens read whole — charged for a
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

function costed(root: string): ReadSetCost {
	return read_set_trim.costed(root, {
		base_entry: FULLRUN,
		label: LANE_CHILD,
		unused_skill_sections: UNUSED_SKILL_SECTIONS,
		skipped_point_of_use: SKIPPED_POINT_OF_USE,
		reached_point_of_use: REACHED_POINT_OF_USE,
	})
}

const lane_child_read_set = {
	LANE_CHILD,
	REACHED_POINT_OF_USE,
	SKIPPED_POINT_OF_USE,
	UNUSED_SKILL_SECTIONS,
	costed,
}

export { lane_child_read_set }
