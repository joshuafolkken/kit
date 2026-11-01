import { run_step_section } from '#scripts/run/run-step-section'

// **`josh followup` prints the section that governs it, once per session** (joshuafolkken/kit#5645),
// so the reader spends no `doc:section` turn on `followup.md` before issuing it. A followup a ship
// runs — in the foreground, detached or in a lane child — carries `SHIPPED_ENVIRONMENT` and prints
// nothing: the ship's own section governs it, and its report is not the session's to mark
// (joshuafolkken/kit#5696).

const SUCCESS_EXIT_CODE = 0
const FOLLOWUP = 'followup'
const SHIP_FOLLOWUP_KEY = 'JOSH_SHIP_FOLLOWUP'
const SHIP_FOLLOWUP_ON = '1'
const SHIPPED_ENVIRONMENT: Readonly<Record<string, string>> = {
	[SHIP_FOLLOWUP_KEY]: SHIP_FOLLOWUP_ON,
}
const UNRESOLVED_MESSAGE = 'The section that governs `josh followup` could not be printed.'

function is_ship_run(source: NodeJS.ProcessEnv): boolean {
	return source[SHIP_FOLLOWUP_KEY] === SHIP_FOLLOWUP_ON
}

// An unresolved heading fails the command, exactly as `run:review` and `ship` refuse it, so a renamed
// section is never acted on unread.
function print_section(
	root: string = process.cwd(),
	source: NodeJS.ProcessEnv = process.env,
): void {
	if (is_ship_run(source)) return

	if (run_step_section.print_once(FOLLOWUP, root) !== SUCCESS_EXIT_CODE) {
		throw new Error(UNRESOLVED_MESSAGE)
	}
}

const followup_section = { SHIPPED_ENVIRONMENT, UNRESOLVED_MESSAGE, print_section }

export { followup_section }
