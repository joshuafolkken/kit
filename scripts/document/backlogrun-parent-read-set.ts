// What a `backlogrun` parent reads, and what that trims from a full read (joshuafolkken/kit#2256).
//
// **The parent is the scheduler, and it never implements.** It reads `backlog:next`, dispatches each
// child in its own delegated `fullrun` unit, opens lanes, runs the progress watcher and the hand-off,
// and parks a child that cannot finish (`backlogrun.md` step 1: "Claim nothing at the entry — this
// parent orchestrates and never implements"). So the `SKILL.md` sections only an *implementing* entry
// uses are read at the section level rather than whole, exactly as the worker trims its own read
// (`lane-child-read-set.ts`) — through the shared `read-set-trim`.
//
// **This is a different set from the worker's.** The parent keeps §0 (its session-cut / resume
// paragraph is the parent's own), §2b (the parent's whole job is the epic-child delegation §2b
// defines), §2c (the parent is the entry that receives an `owner/repo#` prefix), §2e and §2i (the
// parent files prerequisites and observations for the batch) — all of which the worker drops. What the
// parent drops is the implementer-only set below. **The parent owns every point-of-use document**, so
// unlike the worker it drops none of them: the trim is the `SKILL.md` sections alone.

import type { ReadSetCost } from './entry-read-set'
import { read_set_trim } from './read-set-trim'

const BACKLOGRUN = 'backlogrun'

// **The `SKILL.md` sections the `backlogrun` parent never uses.** The parent has no `new` entry, so it
// names no `into` target (§2a); it claims no working tree, a dispatched child does that in its own
// unit (§2f, `backlogrun.md:47-49`); it implements nothing, so it reads no Issue's comments before
// implementing (§2g); and it edits no rule mid-run (§3, read only on an editing turn).
const UNUSED_SKILL_SECTIONS: ReadonlyArray<string> = [
	'2a. The `into <target>` suffix — where the new Issue lands',
	'2f. The working-tree hold — one run per tree',
	"2g. An Issue's comments are part of the Issue",
	'3. What stays resident, and what is read from here',
]

// The parent runs every point-of-use document itself — child dispatch, lanes, the progress watcher,
// the park — so it drops none. Named empty so the shared trim reads the same shape as the worker's.
const SKIPPED_POINT_OF_USE: ReadonlySet<string> = new Set<string>()

function costed(root: string): ReadSetCost {
	return read_set_trim.costed(root, {
		base_entry: BACKLOGRUN,
		label: BACKLOGRUN,
		unused_skill_sections: UNUSED_SKILL_SECTIONS,
		skipped_point_of_use: SKIPPED_POINT_OF_USE,
	})
}

const backlogrun_parent_read_set = { BACKLOGRUN, UNUSED_SKILL_SECTIONS, costed }

export { backlogrun_parent_read_set }
