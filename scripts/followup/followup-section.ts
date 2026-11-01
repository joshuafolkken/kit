import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { run_step_section } from '#scripts/run/run-step-section'
import { run_ship_detach } from '#scripts/run/ship/run-ship-detach'

// **`josh followup` prints the section that governs it, once per session** (joshuafolkken/kit#5645),
// so the reader spends no `doc:section` turn on `followup.md` before issuing it. A followup a ship
// runs — detached under its supervisor, or in a lane child — prints nothing: the ship's own section
// governs it, and a supervisor's log has no reader to hand it to.

const SUCCESS_EXIT_CODE = 0
const FOLLOWUP = 'followup'
const UNRESOLVED_MESSAGE = 'The section that governs `josh followup` could not be printed.'

function is_ship_run(root: string): boolean {
	return run_ship_detach.is_supervised() || lane_child_marker.is_child_of(root)
}

// An unresolved heading fails the command, exactly as `run:review` and `ship` refuse it, so a renamed
// section is never acted on unread.
function print_section(root: string = process.cwd()): void {
	if (is_ship_run(root)) return

	if (run_step_section.print_once(FOLLOWUP, root) !== SUCCESS_EXIT_CODE) {
		throw new Error(UNRESOLVED_MESSAGE)
	}
}

const followup_section = { UNRESOLVED_MESSAGE, print_section }

export { followup_section }
