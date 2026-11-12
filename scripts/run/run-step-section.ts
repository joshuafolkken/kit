import { document_section_cli } from '#scripts/document/document-section-cli'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import type { StepAction } from './run-step'
import { run_step_section_once } from './run-step-section-once'
import { run_step_section_table, type SectionReference } from './run-step-section-table'

// The section that governs each action `run:step` and `run:entry` print — the one table the action →
// rule mapping lives in (`run-step-section-table.ts`), so the manifests no longer carry a route table
// the reader walks to find it. The command prints the section after its action line, which saves the
// `doc:section` turn the reader would otherwise spend fetching a section the action already determined.
//
// **A heading that does not resolve fails the command**, exactly as `doc:section` refuses it: a pointer
// renamed away would otherwise print the action without its rule, and the reader would act unread.

const JOSH_PREFIX = 'pnpm josh '
const COMMAND_SEPARATOR = ' '
const SUCCESS_EXIT_CODE = 0
const { GOVERNING_SECTIONS, LANE_CHILD_SECTIONS } = run_step_section_table

function key_of(action: StepAction): string {
	if (action.kind !== 'command') return action.line

	const [subcommand = ''] = action.line.slice(JOSH_PREFIX.length).split(COMMAND_SEPARATOR)

	return subcommand
}

function section_for(key: string, is_lane_child: boolean): SectionReference | undefined {
	const lane_child_section = is_lane_child ? LANE_CHILD_SECTIONS.get(key) : undefined

	return lane_child_section ?? GOVERNING_SECTIONS.get(key)
}

// Printed through `doc:section` itself, so the extent, the Bash-cap split and the refusal of an
// unresolved heading are that command's, never a second copy of them. Each print is recorded for the
// session, so a command printing its own row after it prints one line (`print_once`).
function print_section(key: string, root: string = process.cwd(), is_lane_child = false): number {
	const found = section_for(key, is_lane_child)

	if (found === undefined) return SUCCESS_EXIT_CODE
	const exit_code = document_section_cli.run([found.document, found.heading], root)

	if (exit_code === SUCCESS_EXIT_CODE) run_step_section_once.record(found)

	return exit_code
}

// **A command's own row prints once per session** (joshuafolkken/kit#5626): `run:review` and `ship`
// print the section that governs them, so the reader spends no `doc:section` turn on it, and a
// section this session already printed — by `run:step`, or by the other command — is one line.
function print_once(key: string, root: string = process.cwd()): number {
	const is_lane_child = lane_child_marker.is_child_of(root)
	const found = section_for(key, is_lane_child)

	if (found === undefined || !run_step_section_once.is_recorded(found)) {
		return print_section(key, root, is_lane_child)
	}

	console.info(run_step_section_once.repeat_line(found))

	return SUCCESS_EXIT_CODE
}

function print_for(
	action: StepAction,
	is_lane_child = false,
	root: string = process.cwd(),
): number {
	return print_section(key_of(action), root, is_lane_child)
}

const { CUT, ENTRY, PARK, PAUSE, PROGRESS, RESUME, RETROSPECTIVE } = run_step_section_table

const run_step_section = {
	CUT,
	ENTRY,
	GOVERNING_SECTIONS,
	PARK,
	PAUSE,
	PROGRESS,
	RESUME,
	RETROSPECTIVE,
	LANE_CHILD_SECTIONS,
	key_of,
	print_for,
	print_once,
	print_section,
}

export { run_step_section }
