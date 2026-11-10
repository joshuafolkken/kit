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
// paragraph is the parent's own), which the worker drops. It drops only the documents of the
// stages its dispatched children run, and reads each stage's point-of-use sections as its own commands
// print them (joshuafolkken/kit#7139).

import { run_step_section_table } from '#scripts/run/run-step-section-table'
import type { ReadSetCost, SectionReference } from './entry-read-set'
import { read_set_trim } from './read-set-trim'

const BACKLOGRUN = 'backlogrun'

// **The `SKILL.md` sections the `backlogrun` parent never uses.** It edits no rule mid-run (§3, read
// only on an editing turn). The implementer-only rules — the `into` target, the working-tree hold,
// the Issue's comments — are single rows of §2's table, so there is no section of them to trim.
const UNUSED_SKILL_SECTIONS: ReadonlyArray<string> = [
	'3. What stays resident, and what is read from here',
]

// **The documents of a dispatched child's stages.** The parent never implements, gates or ships:
// `implement`, `ship` and `run:review` print the chain to the child (`run-step-section-table.ts`), and
// `backlogrun.md` step 1 leaves `fullrun.md` to the child's own unit. Child dispatch, lanes, the
// progress watcher and the park stay the parent's.
const SKIPPED_POINT_OF_USE: ReadonlySet<string> = new Set([
	'background-commands.md',
	'chain-rule.md',
	'fullrun.md',
])

// **The `run:step` keys of the parent's own stages** — the loop, a merge, the hand-off, the progress
// watcher and the retrospective. `UPDATE_DEPS` is absent: `backlogrun.md` reads `latest-gate.md` whole
// on `required`, beyond the section `run:step` prints. `run:pause` is absent: its `prerequisite.md` is
// no point-of-use document, so no entry's read set charges it.
const PARENT_STEP_KEYS: ReadonlyArray<string> = [
	'backlog:next',
	'run:merge',
	'run:carry',
	run_step_section_table.PROGRESS,
	run_step_section_table.RETROSPECTIVE,
]

// **The sections `run:step` prints at the parent's stages**, read off the command's own table so
// `read:set` and `run:step` never drift. A `backlog:drive` hand-off's sections are not the parent's:
// the supervisor hands them to the judgment session it launches beside the driver.
function printed_sections(): Array<SectionReference> {
	return PARENT_STEP_KEYS.map((key) => run_step_section_table.GOVERNING_SECTIONS.get(key))
		.filter((found) => found !== undefined)
		.map((found) => ({ file: found.document, heading: found.heading }))
}

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
		printed_sections: printed_sections(),
	})
}

const backlogrun_parent_read_set = {
	BACKLOGRUN,
	REACHED_POINT_OF_USE,
	UNUSED_SKILL_SECTIONS,
	costed,
	printed_sections,
}

export { backlogrun_parent_read_set }
