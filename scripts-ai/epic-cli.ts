import { readFileSync } from 'node:fs'

// Parsing lives apart from the entry point so the argument rules can be asserted without spawning a
// process or reaching GitHub. The entry point is then a thin shell around these two functions.

const STDIN_PATH = '-'
const STDIN_FD = 0
const ORDERED_FLAG = '--ordered'
const RATIONALE_FLAG = '--rationale-file'
const ORIGIN_FLAG = '--origin'
const PROMOTE_FLAG = '--promote'
const FLAG_PREFIX = '--'
const VALUE_FLAGS: ReadonlySet<string> = new Set([RATIONALE_FLAG, ORIGIN_FLAG])
const ISSUE_NUMBER_PATTERN = /^[1-9]\d*$/u

interface CreateArguments {
	title: string
	children: Array<number>
	is_ordered: boolean
	rationale_path?: string | undefined
	origin?: string | undefined
}

// `--promote <N> <N1> <N2> …`: the issue to promote, then its children. No title — the issue already
// has one, and the discussion in it is usually the split rationale (joshuafolkken/kit#865).
interface PromoteArguments {
	epic_number: number
	children: Array<number>
	is_ordered: boolean
	rationale_path?: string | undefined
	origin?: string | undefined
}

function read_flag_value(argv: ReadonlyArray<string>, flag: string): string | undefined {
	const index = argv.indexOf(flag)
	if (index === -1) return undefined

	return argv[index + 1]
}

function is_flag(argument: string): boolean {
	return argument.startsWith(FLAG_PREFIX)
}

// A value-taking flag's argument must not be mistaken for a child issue number, so the argument
// directly after one is dropped along with the flag itself.
function is_flag_value(argv: ReadonlyArray<string>, index: number): boolean {
	return VALUE_FLAGS.has(argv[index - 1] ?? '')
}

function to_positional_arguments(argv: ReadonlyArray<string>): Array<string> {
	return argv.filter((argument, index) => !is_flag(argument) && !is_flag_value(argv, index))
}

// Deduplicated because a repeated number would render a duplicate task-list row, and with
// `--ordered` would ask GitHub to make an issue block itself.
function to_child_numbers(raw_children: ReadonlyArray<string>): Array<number> {
	const numbers = raw_children
		.filter((raw) => ISSUE_NUMBER_PATTERN.test(raw))
		.map(Number)
		.filter((value) => Number.isSafeInteger(value))

	return [...new Set(numbers)]
}

// The title comes first so the children can stay a bare list of numbers, which is how they are
// written down when the split is made.
function parse_create_arguments(argv: ReadonlyArray<string>): CreateArguments | undefined {
	const [title, ...raw_children] = to_positional_arguments(argv)
	if (title === undefined || title.length === 0) return undefined

	const children = to_child_numbers(raw_children)
	if (children.length === 0) return undefined

	return {
		title,
		children,
		is_ordered: argv.includes(ORDERED_FLAG),
		rationale_path: read_flag_value(argv, RATIONALE_FLAG),
		origin: read_flag_value(argv, ORIGIN_FLAG),
	}
}

// Whether the invocation is a promotion rather than a creation.
function is_promotion(argv: ReadonlyArray<string>): boolean {
	return argv.includes(PROMOTE_FLAG)
}

// The promoted issue and its children. The number after `--promote` is the epic; everything else
// positional is a child. Refused when the epic would also be listed as its own child, which would
// have it block itself under `--ordered`.
function parse_promote_arguments(argv: ReadonlyArray<string>): PromoteArguments | undefined {
	const [raw_epic, ...raw_children] = to_positional_arguments(argv)
	if (raw_epic === undefined || !ISSUE_NUMBER_PATTERN.test(raw_epic)) return undefined
	const epic_number = Number(raw_epic)
	const children = to_child_numbers(raw_children).filter((child) => child !== epic_number)
	if (children.length === 0) return undefined

	return {
		epic_number,
		children,
		is_ordered: argv.includes(ORDERED_FLAG),
		rationale_path: read_flag_value(argv, RATIONALE_FLAG),
		origin: read_flag_value(argv, ORIGIN_FLAG),
	}
}

function parse_check_argument(argv: ReadonlyArray<string>): number | undefined {
	const [raw] = to_positional_arguments(argv)
	if (raw === undefined || !ISSUE_NUMBER_PATTERN.test(raw)) return undefined

	return Number(raw)
}

// `-` reads stdin, matching `gh issue create --body-file -`. An omitted path yields an empty
// rationale, which the body builder replaces with a visible placeholder rather than a blank section.
function read_rationale(rationale_path: string | undefined): string {
	if (rationale_path === undefined) return ''

	return readFileSync(rationale_path === STDIN_PATH ? STDIN_FD : rationale_path, 'utf8')
}

const epic_cli = {
	is_promotion,
	parse_create_arguments,
	parse_promote_arguments,
	parse_check_argument,
	read_rationale,
}

export { epic_cli, ORDERED_FLAG, ORIGIN_FLAG, PROMOTE_FLAG, RATIONALE_FLAG }
export type { CreateArguments, PromoteArguments }
