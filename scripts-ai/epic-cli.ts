import { readFileSync } from 'node:fs'
import type { InsertKind, InsertPosition } from '../scripts/git/git-epic-chains'

// Parsing lives apart from the entry point so the argument rules can be asserted without spawning a
// process or reaching GitHub. The entry point is then a thin shell around these two functions.

const STDIN_PATH = '-'
const STDIN_FD = 0
const ORDERED_FLAG = '--ordered'
const RATIONALE_FLAG = '--rationale-file'
const ORIGIN_FLAG = '--origin'
const PROMOTE_FLAG = '--promote'
const ADD_FLAG = '--add'
const BEFORE_FLAG = '--before'
const AFTER_FLAG = '--after'
const FLAG_PREFIX = '--'
// Which flags consume the argument after them. Per parser rather than module-wide: `--before` takes
// a value only under `--add`, and treating it as one everywhere had `josh epic "T" 101 102 --after
// 103` silently drop #103 from the new epic instead of ignoring an unknown flag (joshuafolkken/kit#890).
const VALUE_FLAGS: ReadonlySet<string> = new Set([RATIONALE_FLAG, ORIGIN_FLAG])
const ADD_VALUE_FLAGS: ReadonlySet<string> = new Set([BEFORE_FLAG, AFTER_FLAG])
// `--add` refuses a flag it does not know, unlike creation and promotion which ignore one. A typo
// there costs a flag; here a mistyped positioning flag would leave its value positional, so the
// target becomes a child to add and the insertion silently lands at the end (joshuafolkken/kit#890).
const ADD_KNOWN_FLAGS: ReadonlySet<string> = new Set([ADD_FLAG, BEFORE_FLAG, AFTER_FLAG])
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
function is_flag_value(
	argv: ReadonlyArray<string>,
	index: number,
	value_flags: ReadonlySet<string>,
): boolean {
	return value_flags.has(argv[index - 1] ?? '')
}

function to_positional_arguments(
	argv: ReadonlyArray<string>,
	value_flags: ReadonlySet<string> = VALUE_FLAGS,
): Array<string> {
	return argv.filter(
		(argument, index) => !is_flag(argument) && !is_flag_value(argv, index, value_flags),
	)
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

// `--add <E> <N...> [--before <M> | --after <M>]`: the epic to insert into, then the children. The
// epic comes first for the same reason it does under `--promote`, so the children stay a bare list
// of numbers (joshuafolkken/kit#890).
interface AddArguments {
	epic_number: number
	children: Array<number>
	position?: InsertPosition | undefined
}

// Whether the invocation inserts into an existing epic rather than creating or promoting one.
function is_addition(argv: ReadonlyArray<string>): boolean {
	return argv.includes(ADD_FLAG)
}

// The outcome of reading `--before` / `--after`: the position, nothing, or a refusal. One shape for
// all three so the caller branches on a field rather than on a value's type.
interface PositionOutcome {
	position?: InsertPosition
	is_refused: boolean
}

const NO_POSITION: PositionOutcome = { is_refused: false }
const REFUSED_POSITION: PositionOutcome = { is_refused: true }

// The raw target of whichever positioning flag was given. Both flags at once leaves no single
// position — refused rather than resolved by precedence, which would silently pick one.
function count_flag(argv: ReadonlyArray<string>, flag: string): number {
	return argv.filter((argument) => argument === flag).length
}

// More than one positioning flag names more than one place, whether they are the same flag twice or
// one of each. `read_flag_value` would answer with the first, which is a silent choice rather than a
// refusal — the same hazard the two-different-flags case was already refused for.
function is_position_ambiguous(argv: ReadonlyArray<string>): boolean {
	return count_flag(argv, BEFORE_FLAG) + count_flag(argv, AFTER_FLAG) > 1
}

function read_position_target(
	argv: ReadonlyArray<string>,
): { kind: InsertKind; raw: string } | undefined {
	if (is_position_ambiguous(argv)) return undefined
	const before = read_flag_value(argv, BEFORE_FLAG)
	if (before !== undefined) return { kind: 'before', raw: before }
	const after = read_flag_value(argv, AFTER_FLAG)

	return after === undefined ? undefined : { kind: 'after', raw: after }
}

// A target that is not an issue number is refused for the same reason two flags are: guessing would
// insert somewhere.
function parse_position(argv: ReadonlyArray<string>): PositionOutcome {
	const has_flag = argv.includes(BEFORE_FLAG) || argv.includes(AFTER_FLAG)
	const target = read_position_target(argv)
	if (target === undefined) return has_flag ? REFUSED_POSITION : NO_POSITION
	if (!ISSUE_NUMBER_PATTERN.test(target.raw)) return REFUSED_POSITION

	return { position: { kind: target.kind, target: Number(target.raw) }, is_refused: false }
}

function has_unknown_flag(argv: ReadonlyArray<string>): boolean {
	return argv.some((argument) => is_flag(argument) && !ADD_KNOWN_FLAGS.has(argument))
}

function read_add_subject(
	argv: ReadonlyArray<string>,
): { epic_number: number; children: Array<number> } | undefined {
	const [raw_epic, ...raw_children] = to_positional_arguments(argv, ADD_VALUE_FLAGS)
	if (raw_epic === undefined || !ISSUE_NUMBER_PATTERN.test(raw_epic)) return undefined
	const epic_number = Number(raw_epic)
	const children = to_child_numbers(raw_children).filter((child) => child !== epic_number)

	return children.length === 0 ? undefined : { epic_number, children }
}

function parse_add_arguments(argv: ReadonlyArray<string>): AddArguments | undefined {
	if (has_unknown_flag(argv)) return undefined
	const subject = read_add_subject(argv)
	if (subject === undefined) return undefined
	const outcome = parse_position(argv)

	return outcome.is_refused ? undefined : { ...subject, position: outcome.position }
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
	is_addition,
	parse_add_arguments,
	parse_create_arguments,
	parse_promote_arguments,
	parse_check_argument,
	read_rationale,
}

export {
	epic_cli,
	ADD_FLAG,
	AFTER_FLAG,
	BEFORE_FLAG,
	ORDERED_FLAG,
	ORIGIN_FLAG,
	PROMOTE_FLAG,
	RATIONALE_FLAG,
}
export type { AddArguments, CreateArguments, PromoteArguments }
