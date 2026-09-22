// What a dispatched lane child reads, and what that costs (joshuafolkken/kit#2021).
//
// **A lane child is the largest fixed cost a `backlogrun` has.** Measured on the batch of
// 2026-09-13, the lane child sessions were 72% of the run's whole input (joshuafolkken/kit#1936),
// and each `claude -p fullrun #N` child read the `fullrun` entry set in full — around 227KB. Most of
// that is spent on procedure a leaf child never carries out: it dispatches no child of its own, opens
// no lane, runs no progress watcher and performs no hand-off, so the point-of-use documents that
// carry those steps are read by the parent and never by the child.
//
// **This models the child as a trimmed `fullrun`, derived rather than transcribed.** The set is the
// `fullrun` entry read with two subtractions — the `SKILL.md` sections a child never uses read at the
// section level, and the point-of-use documents a leaf never reaches dropped — applied by the shared
// `read-set-trim`, which the `backlogrun` parent trim uses too (joshuafolkken/kit#2256).

import type { Cost, ReadSetCost } from './entry-read-set'
import { read_set_trim } from './read-set-trim'

const LANE_CHILD = 'lane-child'
const FULLRUN = 'fullrun'

// **The `SKILL.md` sections a dispatched lane child never uses**, read at the section level rather
// than in full. A child is handed one issue to run, so it never files a new one with an `into`
// target (§2a), never delegates its own pre-implementation reading (§2b), never names a repository or
// scouts for a duplicate at its entry (§2c, §2e), returns an observation to the parent rather than
// filing it (§2i), and never edits these documents (§3). Its dispatch is already an explicit workflow
// invocation, so §0 cannot decide anything for it either. Review delegation remains in chain-rule.md.
const UNUSED_SKILL_SECTIONS: ReadonlyArray<string> = [
	'0. The rule that fires before any of them — explicit invocation',
	'2a. The `into <target>` suffix — where the new Issue lands',
	'2b. Delegating a step to a cheaper tier',
	'2c. The `owner/repo#` prefix — which repository the run acts on',
	'2e. Before filing a new Issue — `pnpm josh issue:scout`',
	'2i. An observation worth filing is filed without asking',
	'2j. The end-of-run retrospective — read when `run:step` prints it',
	'3. What stays resident, and what is read from here',
]

// **The point-of-use documents a leaf child never reaches**: child dispatch, lane opening and the
// progress watcher / hand-off are the parent's, so their single-source documents are dropped from
// the child's read. **`latest-gate.md` is the parent's too** (joshuafolkken/kit#2189): the dependency
// update runs once per session in the outermost run, never in a dispatched lane child (`latest:scope`
// answers `skip` in a lane via the lane guard), so the child never opens `latest-gate.md`. The gate documents
// (`chain-rule.md`, `background-commands.md`), `followup.md` and `backlogrun-park.md` stay — a child
// runs the gate, opens its PR, and may park on a decision, so it does reach every one of those.
// **`retrospective.md` is the parent's too** (joshuafolkken/kit#2328): the end-of-run retrospective
// runs once at the batch's own end, never in a leaf child, so `run:step` answers `stop` for a child at
// the stop position and the child never opens it.
// **`backlogrun-steps.md` is the parent's too** (joshuafolkken/kit#2357): it is the scheduler's step
// list — what one invocation approves, the named-issue order, the session-cut record, the loop and the
// once-per-session tail — none of which a leaf child performs. Every reference to it lives in a
// document the child never reads (`backlogrun.md`, `backlogrun-progress.md`, `retrospective.md`) or in a
// `SKILL.md` section the child trims (§0's session-cut note, §2b, §2i, §2j), so the child has no path
// that opens it. It was the child's single largest read — ~16,000 tokens read whole — charged for a
// document it never reaches, so dropping it is a correction of an over-count, not a loss of any rule the
// child needs. The parent still reads it in full.
const SKIPPED_POINT_OF_USE: ReadonlySet<string> = new Set([
	'backlogrun-child.md',
	'backlogrun-lanes.md',
	'backlogrun-progress.md',
	'backlogrun-steps.md',
	'latest-gate.md',
	'retrospective.md',
])

function costed(root: string): ReadSetCost {
	return read_set_trim.costed(root, {
		base_entry: FULLRUN,
		label: LANE_CHILD,
		unused_skill_sections: UNUSED_SKILL_SECTIONS,
		skipped_point_of_use: SKIPPED_POINT_OF_USE,
	})
}

function unused_skill_cost(root: string): Cost {
	return read_set_trim.unused_skill_cost(root, UNUSED_SKILL_SECTIONS)
}

const lane_child_read_set = {
	LANE_CHILD,
	SKIPPED_POINT_OF_USE,
	UNUSED_SKILL_SECTIONS,
	costed,
	unused_skill_cost,
}

export { lane_child_read_set }
