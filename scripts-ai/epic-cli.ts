import { readFileSync } from 'node:fs'
import type { InsertKind, InsertPosition } from '../scripts/git/git-epic-chains'
import { git_epic_parse, type ExternalChild } from '../scripts/git/git-epic-parse'

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
// The decision record for an insertion, read the same way `--rationale-file` is read for a creation:
// from a file, or from stdin as `-`. The text is a judgement, so the caller writes it; what the command
// contributes is placing it in the epic's `## Decisions` and on each child (joshuafolkken/kit#1350).
const DECISION_FLAG = '--decision-file'
const FLAG_PREFIX = '--'
// Which flags consume the argument after them. Per parser rather than module-wide: `--before` takes
// a value only under `--add`, and treating it as one everywhere had `josh epic "T" 101 102 --after
// 103` silently drop #103 from the new epic instead of ignoring an unknown flag (joshuafolkken/kit#890).
const VALUE_FLAGS: ReadonlySet<string> = new Set([RATIONALE_FLAG, ORIGIN_FLAG])
const ADD_VALUE_FLAGS: ReadonlySet<string> = new Set([BEFORE_FLAG, AFTER_FLAG, DECISION_FLAG])
// `--add` refuses a flag it does not know, unlike creation and promotion which ignore one. A typo
// there costs a flag; here a mistyped positioning flag would leave its value positional, so the
// target becomes a child to add and the insertion silently lands at the end (joshuafolkken/kit#890).
const ADD_KNOWN_FLAGS: ReadonlySet<string> = new Set([
	ADD_FLAG,
	BEFORE_FLAG,
	AFTER_FLAG,
	DECISION_FLAG,
])
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
	decision_path?: string | undefined
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

// A value-taking flag given without a usable value: last on the line, or followed by another flag.
// **Refused rather than read as "none was asked for"** — `--decision-file` is passed precisely because
// the record has to exist, so a shell that ate the path would otherwise land the insertion, write no
// record, post no comment and exit 0: success reported for half the job. Repeated, it names two
// records, which is refused for the reason two positioning flags are (joshuafolkken/kit#1350).
function is_value_unusable(argv: ReadonlyArray<string>, flag: string): boolean {
	if (!argv.includes(flag)) return false
	if (count_flag(argv, flag) > 1) return true
	const value = read_flag_value(argv, flag)

	return value === undefined || is_flag(value)
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
	if (has_unknown_flag(argv) || is_value_unusable(argv, DECISION_FLAG)) return undefined
	const subject = read_add_subject(argv)
	if (subject === undefined) return undefined
	const outcome = parse_position(argv)
	if (outcome.is_refused) return undefined

	return {
		...subject,
		position: outcome.position,
		decision_path: read_flag_value(argv, DECISION_FLAG),
	}
}

// The one refusal `--add` has to explain rather than merely report. `into owner/repo#N` is a legal
// thing for a person to type, and this command cannot serve it: it reads and edits issues in the
// repository it is run from. Falling through to the usage line would read as "that form does not
// exist" when what it means is "run it in the other checkout" (joshuafolkken/kit#985).
interface CrossRepoAddTarget {
	epic: ExternalChild
	local: AddArguments
}

// The same invocation with the cross-repository target replaced by its bare number. Answering only
// when *that* parses is what keeps the suggestion honest: an invocation wrong in some other way — a
// mistyped positioning flag, no children, a `--before` naming two places — is not a repository
// problem, and
// a suggestion built from it would drop or mangle what the person typed.
function find_cross_repo_add_target(argv: ReadonlyArray<string>): CrossRepoAddTarget | undefined {
	const [raw_epic] = to_positional_arguments(argv, ADD_VALUE_FLAGS)
	if (raw_epic === undefined) return undefined
	const epic = git_epic_parse.parse_external_reference(raw_epic)
	if (epic === undefined) return undefined

	const local = parse_add_arguments(
		argv.map((argument) => (argument === raw_epic ? String(epic.number) : argument)),
	)

	return local === undefined ? undefined : { epic, local }
}

// Rebuilt from the parsed values rather than echoed from `argv`, so the suggested command is exactly
// what the other checkout would read — and carries the position, which is the one part of the
// instruction the epic itself does not record.
function format_add_arguments(local: AddArguments): string {
	const { position } = local
	const suffix = position === undefined ? '' : ` --${position.kind} ${String(position.target)}`

	return `${[local.epic_number, ...local.children].map(String).join(' ')}${suffix}`
}

// **`--decision-file` is named rather than relayed** (joshuafolkken/kit#1350). The suggestion is a
// command to run in a *different* checkout, and the path was resolved against this one: a relative path
// does not exist there, `-` cannot be re-read from a consumed stdin, and an unquoted path with a space
// would break the line the person copies. So the flag is asked for again instead of pasted in wrong.
function format_decision_note(local: AddArguments): Array<string> {
	if (local.decision_path === undefined) return []

	return [
		`  The decision record is not carried over — pass \`${DECISION_FLAG}\` there with a path that checkout can read.`,
	]
}

// A fully-qualified reference to *this* repository is the same instruction spelled longer, not a
// cross-repository one — and `into owner/repo#N` is exactly how the suffix is documented, so a run
// inside that repository would otherwise be refused and told to go to the checkout it is already in
// (joshuafolkken/kit#985). An unreadable current repository resolves to a refusal rather than to a
// write: refusing costs one command, and guessing wrong writes into the wrong epic.
function resolve_local_add(
	found: CrossRepoAddTarget,
	current_repo: string | undefined,
): AddArguments | undefined {
	return current_repo === found.epic.repo ? found.local : undefined
}

// What to type instead. `josh doctor` prints the checkout for each repository, which is the part a
// run cannot guess.
function format_cross_repo_refusal(found: CrossRepoAddTarget): string {
	const reference = `${found.epic.repo}#${String(found.epic.number)}`

	return [
		`✖ ${reference} is an epic in another repository; this command reads and writes issues in the repository it runs from.`,
		`  Run \`pnpm josh epic --add ${format_add_arguments(found.local)}\` in that repository's checkout (\`pnpm josh doctor\` prints where each one is).`,
		...format_decision_note(found.local),
	].join('\n')
}

function parse_check_argument(argv: ReadonlyArray<string>): number | undefined {
	const [raw] = to_positional_arguments(argv)
	if (raw === undefined || !ISSUE_NUMBER_PATTERN.test(raw)) return undefined

	return Number(raw)
}

// `-` reads stdin, matching `gh issue create --body-file -`. Shared by the two `*-file` flags rather
// than spelled out per flag, so the stdin form cannot come to mean one thing under `--rationale-file`
// and another under `--decision-file`.
function read_file_or_stdin(path: string): string {
	return readFileSync(path === STDIN_PATH ? STDIN_FD : path, 'utf8')
}

// An omitted path yields an empty rationale, which the body builder replaces with a visible
// placeholder rather than a blank section.
function read_rationale(rationale_path: string | undefined): string {
	return rationale_path === undefined ? '' : read_file_or_stdin(rationale_path)
}

// `undefined` rather than `''` for an omitted path: an insertion that records no decision is the
// ordinary case, and an empty string is a record that says nothing — which `epic --add` refuses
// (joshuafolkken/kit#1350).
function read_decision(decision_path: string | undefined): string | undefined {
	return decision_path === undefined ? undefined : read_file_or_stdin(decision_path)
}

const epic_cli = {
	is_promotion,
	is_addition,
	find_cross_repo_add_target,
	resolve_local_add,
	format_cross_repo_refusal,
	parse_add_arguments,
	parse_create_arguments,
	parse_promote_arguments,
	parse_check_argument,
	read_decision,
	read_rationale,
}

export {
	epic_cli,
	ADD_FLAG,
	AFTER_FLAG,
	BEFORE_FLAG,
	DECISION_FLAG,
	ORDERED_FLAG,
	ORIGIN_FLAG,
	PROMOTE_FLAG,
	RATIONALE_FLAG,
}
export type { AddArguments, CreateArguments, CrossRepoAddTarget, PromoteArguments }
