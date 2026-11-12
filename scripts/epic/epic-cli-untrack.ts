import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { epic_cli_argv } from './epic-cli-argv'

const UNTRACK_FLAG = '--untrack'

interface UntrackArguments {
	epic_number: number
	children: ReadonlyArray<number>
}

function is_untrack(argv: ReadonlyArray<string>): boolean {
	return argv.includes(UNTRACK_FLAG)
}

function is_invalid(value: string): boolean {
	return !issue_number_shape.is_issue_number(value) || !Number.isSafeInteger(Number(value))
}

function read_subject(raw: ReadonlyArray<string>): UntrackArguments | undefined {
	if (raw.some((value) => is_invalid(value))) return undefined
	const [epic_number, ...children] = raw.map(Number)

	if (epic_number === undefined || children.length === 0 || children.includes(epic_number)) {
		return undefined
	}

	return { epic_number, children: [...new Set(children)] }
}

function parse_arguments(argv: ReadonlyArray<string>): UntrackArguments | undefined {
	const parsed = epic_cli_argv.read_form(argv, { switches: [UNTRACK_FLAG] })

	return parsed === undefined ? undefined : read_subject(parsed.positionals)
}

const epic_cli_untrack = { is_untrack, parse_arguments }

export { epic_cli_untrack }
