// What a `backlogrun` parent reads, and what that trims from a full read.
//
// **The parent is the scheduler, and it never implements.** It reads `backlog:next`, dispatches each
// child in its own delegated `fullrun` unit, opens lanes, runs the progress watcher and the hand-off,
// and parks a child that cannot finish (`backlogrun.md` step 1: "Claim nothing at the entry — this
// parent orchestrates and never implements"). So the `SKILL.md` sections only an *implementing* entry
// uses are read at the section level rather than whole, exactly as the worker trims its own read
// (`lane-child-read-set.ts`) — through the shared `read-set-trim`.
//
// **This is a different set from the worker's.** The parent keeps §0 (its session-cut / resume
// paragraph is the parent's own), which the worker drops. **The parent owns every point-of-use
// document**, so unlike the worker it drops none of them: the trim is the `SKILL.md` sections alone.

import type { ReadSetCost } from './entry-read-set'
import { read_set_trim } from './read-set-trim'

const BACKLOGRUN = 'backlogrun'

// **The `SKILL.md` sections the `backlogrun` parent never uses.** It edits no rule mid-run (§3, read
// only on an editing turn). The implementer-only rules — the `into` target, the working-tree hold,
// the Issue's comments — are single rows of §2's table, so there is no section of them to trim.
const UNUSED_SKILL_SECTIONS: ReadonlyArray<string> = [
	'3. What stays resident, and what is read from here',
]

// The parent runs every point-of-use document itself — child dispatch, lanes, the progress watcher,
// the park — so it drops none. Named empty so the shared trim reads the same shape as the worker's.
const SKIPPED_POINT_OF_USE: ReadonlySet<string> = new Set<string>()

// **The parent runs the end-of-run retrospective** (`retrospective.md`) when `run:step` prints it, but its
// manifest names `retrospective.md` only through `backlogrun-steps.md` — one hop further than the
// derivation follows — so the parent's reach names it. **It polls a
// delegated unit that went silent** through `backlogrun-recovery.md`, named only from
// `backlogrun-child.md`, so the reach names that too.
const REACHED_POINT_OF_USE: ReadonlySet<string> = new Set([
	'retrospective.md',
	'backlogrun-recovery.md',
])

function costed(root: string): ReadSetCost {
	return read_set_trim.costed(root, {
		base_entry: BACKLOGRUN,
		label: BACKLOGRUN,
		unused_skill_sections: UNUSED_SKILL_SECTIONS,
		skipped_point_of_use: SKIPPED_POINT_OF_USE,
		reached_point_of_use: REACHED_POINT_OF_USE,
	})
}

const backlogrun_parent_read_set = {
	BACKLOGRUN,
	REACHED_POINT_OF_USE,
	UNUSED_SKILL_SECTIONS,
	costed,
}

export { backlogrun_parent_read_set }
