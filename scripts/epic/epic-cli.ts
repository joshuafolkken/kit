import { session_cite } from '#scripts/issue/session-cite'
import { cli_body } from '#scripts/josh/cli-body'
import type { InsertKind, InsertPosition } from './epic-chains'
import { epic_cli_argv, ISSUE_NUMBER_PATTERN, type EpicArgv, type FormFlags } from './epic-cli-argv'
import { epic_cli_remove } from './epic-cli-remove'
import { epic_parse, type ExternalChild } from './epic-parse'

// Parsing lives apart from the entry point so the argument rules can be asserted without spawning a
// process or reaching GitHub. The entry point is then a thin shell around these two functions.

const ORDERED_FLAG = '--ordered'
const RATIONALE_FLAG = '--rationale-file'
const ORIGIN_FLAG = '--origin'
const PROMOTE_FLAG = '--promote'
const ADD_FLAG = '--add'
// `--reconcile <E>`: bring the epic's declaration and its recorded relations back into agreement.
// It takes no value flags — the epic number is the whole subject.
const RECONCILE_FLAG = '--reconcile'
const BEFORE_FLAG = '--before'
const AFTER_FLAG = '--after'
// The same two places with the declaration withheld: move the task-list row and write neither the
// dependency declaration nor the `blocked-by` relation. They exist because
// `epic:next` offers children in task-list order, so "no dependency, but run this one first" had no
// spelling at all — only a false dependency, or a row nobody would reach.
const ORDER_BEFORE_FLAG = '--order-before'
const ORDER_AFTER_FLAG = '--order-after'
// The decision record for an insertion, read the same way `--rationale-file` is read for a creation:
// from a file, or from stdin as `-`. The text is a judgement, so the caller writes it; what the command
// contributes is placing it in the epic's `## Decisions` and on each child.
const DECISION_FLAG = '--decision-file'
// Which flags each form knows, and which of them consume the argument after them — per form, for the
// reason `epic-cli-argv.ts` gives.
const CREATE_FORM: FormFlags = {
	switches: [ORDERED_FLAG],
	value_flags: [RATIONALE_FLAG, ORIGIN_FLAG],
}
const PROMOTE_FORM: FormFlags = { ...CREATE_FORM, switches: [PROMOTE_FLAG, ORDERED_FLAG] }
const RECONCILE_FORM: FormFlags = { switches: [RECONCILE_FLAG] }
const CHECK_FORM: FormFlags = { switches: [] }
const ADD_FORM: FormFlags = {
	switches: [ADD_FLAG],
	value_flags: [BEFORE_FLAG, AFTER_FLAG, ORDER_BEFORE_FLAG, ORDER_AFTER_FLAG, DECISION_FLAG],
}

const { count_flag, is_switch_set, is_value_unusable, positionals_of, read_flag_value, read_form } =
	epic_cli_argv

interface CreateArguments {
	title: string
	children: Array<number>
	is_ordered: boolean
	rationale_path?: string | undefined
	origin?: string | undefined
}

// `--promote <N> <N1> <N2> …`: the issue to promote, then its children. No title — the issue already
// has one, and the discussion in it is usually the split rationale.
interface PromoteArguments {
	epic_number: number
	children: Array<number>
	is_ordered: boolean
	rationale_path?: string | undefined
	origin?: string | undefined
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

// The flags a creation and a promotion share, read the same way for both.
function read_batch_flags(
	parsed: EpicArgv,
): Pick<CreateArguments, 'is_ordered' | 'rationale_path' | 'origin'> {
	return {
		is_ordered: is_switch_set(parsed, ORDERED_FLAG),
		rationale_path: read_flag_value(parsed, RATIONALE_FLAG),
		origin: read_flag_value(parsed, ORIGIN_FLAG),
	}
}

function to_create_arguments(parsed: EpicArgv): CreateArguments | undefined {
	const [title, ...raw_children] = parsed.positionals
	if (title === undefined || title.length === 0) return undefined

	const children = to_child_numbers(raw_children)
	if (children.length === 0) return undefined

	return { title, children, ...read_batch_flags(parsed) }
}

// The title comes first so the children can stay a bare list of numbers, which is how they are
// written down when the split is made.
function parse_create_arguments(argv: ReadonlyArray<string>): CreateArguments | undefined {
	const parsed = read_form(argv, CREATE_FORM)

	return parsed === undefined ? undefined : to_create_arguments(parsed)
}

// Whether the invocation is a promotion rather than a creation.
function is_promotion(argv: ReadonlyArray<string>): boolean {
	return argv.includes(PROMOTE_FLAG)
}

// Whether the invocation reconciles an epic rather than creating, promoting or editing one.
function is_reconciliation(argv: ReadonlyArray<string>): boolean {
	return argv.includes(RECONCILE_FLAG)
}

interface ReconcileArguments {
	epic_number: number
}

// The epic to reconcile. The number after `--reconcile` is the only subject; there are no children
// and no position — the repair reads what the epic already records rather than being told an order.
function parse_reconcile_arguments(argv: ReadonlyArray<string>): ReconcileArguments | undefined {
	const [raw_epic] = positionals_of(argv, RECONCILE_FORM)
	if (raw_epic === undefined || !ISSUE_NUMBER_PATTERN.test(raw_epic)) return undefined

	return { epic_number: Number(raw_epic) }
}

// The promoted issue and its children. The number after `--promote` is the epic; everything else
// positional is a child. Refused when the epic would also be listed as its own child, which would
// have it block itself under `--ordered`.
function to_promote_arguments(parsed: EpicArgv): PromoteArguments | undefined {
	const [raw_epic, ...raw_children] = parsed.positionals
	if (raw_epic === undefined || !ISSUE_NUMBER_PATTERN.test(raw_epic)) return undefined
	const epic_number = Number(raw_epic)
	const children = to_child_numbers(raw_children).filter((child) => child !== epic_number)
	if (children.length === 0) return undefined

	return { epic_number, children, ...read_batch_flags(parsed) }
}

function parse_promote_arguments(argv: ReadonlyArray<string>): PromoteArguments | undefined {
	const parsed = read_form(argv, PROMOTE_FORM)

	return parsed === undefined ? undefined : to_promote_arguments(parsed)
}

// `--add <E> <N...> [--before <M> | --after <M> | --order-before <M> | --order-after <M>]`: the epic
// to insert into, then the children. The epic comes first for the same reason it does under
// `--promote`, so the children stay a bare list of numbers.
interface AddArguments {
	epic_number: number
	children: Array<number>
	position?: InsertPosition | undefined
	// `--order-before` / `--order-after` rather than `--before` / `--after`: the row moves and nothing
	// else is written.
	is_order_only?: boolean | undefined
	decision_path?: string | undefined
}

// Whether the invocation inserts into an existing epic rather than creating or promoting one.
function is_addition(argv: ReadonlyArray<string>): boolean {
	return argv.includes(ADD_FLAG)
}

// The outcome of reading a positioning flag: the position, nothing, or a refusal. One shape for all
// three so the caller branches on a field rather than on a value's type. `is_order_only` rides on the
// same value because one flag decides both halves — where the row goes, and whether a dependency is
// written behind it.
interface PositionOutcome {
	position?: InsertPosition
	is_order_only?: boolean
	is_refused: boolean
}

const NO_POSITION: PositionOutcome = { is_refused: false }
const REFUSED_POSITION: PositionOutcome = { is_refused: true }

// The four positioning flags as one table: the place each one names, and whether a dependency is
// written behind the row it moves. **One table rather than two branches** —
// `--order-before` asks the same placement question `--before` does, so a second parsing path could
// come to disagree with this one about what a repeated flag or a non-numeric target means.
interface PositionFlag {
	flag: string
	kind: InsertKind
	is_order_only: boolean
}

const POSITION_FLAGS: ReadonlyArray<PositionFlag> = [
	{ flag: BEFORE_FLAG, kind: 'before', is_order_only: false },
	{ flag: AFTER_FLAG, kind: 'after', is_order_only: false },
	{ flag: ORDER_BEFORE_FLAG, kind: 'before', is_order_only: true },
	{ flag: ORDER_AFTER_FLAG, kind: 'after', is_order_only: true },
]

// More than one positioning flag names more than one place, whether they are the same flag twice, one
// of each direction, or a dependency-writing flag beside an order-only one. `read_flag_value` would
// answer with the first, which is a silent choice rather than a refusal — and here the silent choice
// would decide whether a `blocked-by` is written at all.
function count_position_flags(parsed: EpicArgv): number {
	return POSITION_FLAGS.reduce((total, entry) => total + count_flag(parsed, entry.flag), 0)
}

interface PositionTarget extends PositionFlag {
	raw: string
}

function to_position_target(parsed: EpicArgv, entry: PositionFlag): PositionTarget | undefined {
	const raw = read_flag_value(parsed, entry.flag)

	return raw === undefined ? undefined : { ...entry, raw }
}

function read_position_target(parsed: EpicArgv): PositionTarget | undefined {
	if (count_position_flags(parsed) > 1) return undefined

	return POSITION_FLAGS.map((entry) => to_position_target(parsed, entry)).find(
		(found) => found !== undefined,
	)
}

// A target that is not an issue number is refused for the same reason two flags are: guessing would
// insert somewhere.
function parse_position(parsed: EpicArgv): PositionOutcome {
	const has_flag = count_position_flags(parsed) > 0
	const target = read_position_target(parsed)
	if (target === undefined) return has_flag ? REFUSED_POSITION : NO_POSITION
	if (!ISSUE_NUMBER_PATTERN.test(target.raw)) return REFUSED_POSITION

	return {
		position: { kind: target.kind, target: Number(target.raw) },
		is_order_only: target.is_order_only,
		is_refused: false,
	}
}

// Whether *this* is why the insertion could not be read, so the refusal can say so. Without it the
// caller prints the generic requirements line, and a shell that expanded `--decision-file $REC` to
// nothing is answered with "an epic number and at least one child issue number are required" — advice
// about the part the person got right.
function is_decision_path_unusable(argv: ReadonlyArray<string>): boolean {
	return is_value_unusable(argv, DECISION_FLAG)
}

function read_add_subject(
	parsed: EpicArgv,
): { epic_number: number; children: Array<number> } | undefined {
	const [raw_epic, ...raw_children] = parsed.positionals
	if (raw_epic === undefined || !ISSUE_NUMBER_PATTERN.test(raw_epic)) return undefined
	const epic_number = Number(raw_epic)
	const children = to_child_numbers(raw_children).filter((child) => child !== epic_number)

	return children.length === 0 ? undefined : { epic_number, children }
}

function to_add_arguments(parsed: EpicArgv): AddArguments | undefined {
	const subject = read_add_subject(parsed)
	if (subject === undefined) return undefined
	const outcome = parse_position(parsed)
	if (outcome.is_refused) return undefined

	return {
		...subject,
		position: outcome.position,
		is_order_only: outcome.is_order_only,
		decision_path: read_flag_value(parsed, DECISION_FLAG),
	}
}

// An unknown flag is refused by the strict read: a mistyped positioning flag would otherwise leave its
// value positional, so it becomes a child and the edit lands somewhere else.
function parse_add_arguments(argv: ReadonlyArray<string>): AddArguments | undefined {
	const parsed = is_decision_path_unusable(argv) ? undefined : read_form(argv, ADD_FORM)

	return parsed === undefined ? undefined : to_add_arguments(parsed)
}

// The one refusal `--add` has to explain rather than merely report. `into owner/repo#N` is a legal
// thing for a person to type, and this command cannot serve it: it reads and edits issues in the
// repository it is run from. Falling through to the usage line would read as "that form does not
// exist" when what it means is "run it in the other checkout".
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
	const [raw_epic] = positionals_of(argv, ADD_FORM)
	if (raw_epic === undefined) return undefined
	const epic = epic_parse.parse_external_reference(raw_epic)
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
	// The order-only prefix rides along, since it is what decides whether the other checkout writes a
	// dependency — a suggestion that dropped it would be a different instruction.
	const prefix = local.is_order_only === true ? '--order-' : '--'
	const suffix =
		position === undefined ? '' : ` ${prefix}${position.kind} ${String(position.target)}`

	return `${[local.epic_number, ...local.children].map(String).join(' ')}${suffix}`
}

// **`--decision-file` is named rather than relayed**. The suggestion is a
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
// inside that repository would otherwise be refused and told to go to the checkout it is already in.
// An unreadable current repository resolves to a refusal rather than to a
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
	const reference = session_cite.issue(found.epic.number, undefined, found.epic.repo)

	return [
		`✖ ${reference} is an epic in another repository; this command reads and writes issues in the repository it runs from.`,
		`  Run \`pnpm josh epic --add ${format_add_arguments(found.local)}\` in that repository's checkout (\`pnpm josh doctor\` prints where each one is).`,
		...format_decision_note(found.local),
	].join('\n')
}

function parse_check_argument(argv: ReadonlyArray<string>): number | undefined {
	const [raw] = positionals_of(argv, CHECK_FORM)
	if (raw === undefined || !ISSUE_NUMBER_PATTERN.test(raw)) return undefined

	return Number(raw)
}

// `-` reads stdin, matching `gh issue create --body-file -`. The reader is `cli_body`'s, shared with
// `josh notify --body-file` and `josh followup --notify-message-file` rather than copied per entry
// point, so the stdin form cannot come to mean one thing here and something
// else there.
const { read_file_or_stdin } = cli_body

// An omitted path yields an empty rationale, which the body builder replaces with a visible
// placeholder rather than a blank section.
function read_rationale(rationale_path: string | undefined): string {
	return rationale_path === undefined ? '' : read_file_or_stdin(rationale_path)
}

// `undefined` rather than `''` for an omitted path: an insertion that records no decision is the
// ordinary case, and an empty string is a record that says nothing — which `epic --add` refuses.
function read_decision(decision_path: string | undefined): string | undefined {
	return decision_path === undefined ? undefined : read_file_or_stdin(decision_path)
}

const epic_cli = {
	is_promotion,
	is_addition,
	is_reconciliation,
	...epic_cli_remove,
	find_cross_repo_add_target,
	is_decision_path_unusable,
	resolve_local_add,
	format_cross_repo_refusal,
	parse_add_arguments,
	parse_create_arguments,
	parse_promote_arguments,
	parse_reconcile_arguments,
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
	ORDER_AFTER_FLAG,
	ORDER_BEFORE_FLAG,
	ORDERED_FLAG,
	ORIGIN_FLAG,
	PROMOTE_FLAG,
	RATIONALE_FLAG,
	RECONCILE_FLAG,
}
export { REMOVE_FLAG } from './epic-cli-remove'
export type { AddArguments, CreateArguments, CrossRepoAddTarget, PromoteArguments }
export type { RemoveArguments } from './epic-cli-remove'
