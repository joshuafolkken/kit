import { epic_cli_argv, ISSUE_NUMBER_PATTERN } from './epic-cli-argv'

// `josh epic --remove <E> <M> <N> …`'s argument rules (joshuafolkken/kit#1712).
//
// Its own module rather than a fourth parser inside `epic-cli.ts`, which sits at its line ceiling —
// and because the rules read as one thing: the arguments after the epic are a **path**, which is the
// one place this command departs from every other form's bare set of child numbers.

const REMOVE_FLAG = '--remove'
const DECISION_FLAG = '--decision-file'
// `--remove` takes no positioning flag: there is nothing for a removal to be relative to, and the
// path itself says which orders go.
const REMOVE_VALUE_FLAGS: ReadonlySet<string> = new Set([DECISION_FLAG])
const REMOVE_KNOWN_FLAGS: ReadonlySet<string> = new Set([REMOVE_FLAG, DECISION_FLAG])
// The shortest path that names an order at all: `<M> <N>`.
const MINIMUM_PATH_LENGTH = 2

interface RemoveArguments {
	epic_number: number
	path: Array<number>
	decision_path?: string | undefined
}

// Whether the invocation deletes a declared order rather than creating, promoting or inserting.
function is_removal(argv: ReadonlyArray<string>): boolean {
	return argv.includes(REMOVE_FLAG)
}

// **Not deduplicated, and a non-number refuses the whole path** — unlike a child list, which is a
// set. The path is a sequence, so its order and its repeats are what the caller said: dropping a
// repeat would silently delete a different set of orders than the one typed, and skipping an
// unparsable argument would shift every pair after it.
function to_path_numbers(raw_path: ReadonlyArray<string>): Array<number> | undefined {
	if (raw_path.some((raw) => !ISSUE_NUMBER_PATTERN.test(raw))) return undefined

	return raw_path.length < MINIMUM_PATH_LENGTH ? undefined : raw_path.map(Number)
}

// A flag that makes the whole invocation unreadable, whatever the positional arguments say.
function has_flag_refusal(argv: ReadonlyArray<string>): boolean {
	return (
		epic_cli_argv.has_unknown_flag(argv, REMOVE_KNOWN_FLAGS) ||
		epic_cli_argv.is_value_unusable(argv, DECISION_FLAG)
	)
}

function read_subject(
	argv: ReadonlyArray<string>,
): { epic_number: number; path: Array<number> } | undefined {
	const [raw_epic, ...raw_path] = epic_cli_argv.to_positional_arguments(argv, REMOVE_VALUE_FLAGS)
	if (raw_epic === undefined || !ISSUE_NUMBER_PATTERN.test(raw_epic)) return undefined
	const path = to_path_numbers(raw_path)

	return path === undefined ? undefined : { epic_number: Number(raw_epic), path }
}

function parse_remove_arguments(argv: ReadonlyArray<string>): RemoveArguments | undefined {
	if (has_flag_refusal(argv)) return undefined
	const subject = read_subject(argv)
	if (subject === undefined) return undefined

	return { ...subject, decision_path: epic_cli_argv.read_flag_value(argv, DECISION_FLAG) }
}

const epic_cli_remove = {
	is_removal,
	parse_remove_arguments,
}

export { epic_cli_remove, REMOVE_FLAG }
export type { RemoveArguments }
