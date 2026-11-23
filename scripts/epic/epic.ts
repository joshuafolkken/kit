/**
 * Create an epic Issue that satisfies every requirement the auto-close and the order warning read.
 * `USAGE` below lists the `josh epic` forms; the entry is `epic-main.ts`, so `run:split` can import
 * this module in the same process.
 */
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { epic_add, type AddChildrenInput } from './epic-add'
import { epic_body } from './epic-body'
import { epic_cli, epic_cli_untrack, type AddArguments, type CrossRepoAddTarget } from './epic-cli'
import { epic_cli_chain, type ChainRead } from './epic-cli-chain'
import { epic_decide } from './epic-decide'
import { epic_notify } from './epic-notify'
import { epic_reconcile } from './epic-reconcile'
import { epic_remove } from './epic-remove'
import { epic_run } from './epic-run'
import { epic_split_reach } from './epic-split-reach'
import { epic_untrack } from './epic-untrack'

const FLAGS =
	'--rationale-file <path|-> [--ordered | --chain "#A -> #B" ...] [--order-reason "#A -> #B: <kind> — <reason>" ...] [--origin <owner/repo#N>] [--notify]'
const USAGE = [
	`Usage: josh epic "<title>" <N1> <N2> ... ${FLAGS}`,
	`       josh epic --promote <N> <N1> <N2> ... ${FLAGS} [--title <title>]`,
	'       josh epic --add <E> <N1> <N2> ... --before <M> | --after <M> --order-reason "<chain>: <reason>" [--decision-file <path|->]',
	'       josh epic --add <E> <N1> <N2> ... [--chain "#A -> #B" ...] [--order-reason "#A -> #B: <reason>" ...] [--decision-file <path|->]',
	'       josh epic --add <E> <N1> <N2> ... [--order-before <M> | --order-after <M>] [--decision-file <path|->]',
	'       josh epic --remove <E> <M> <N> ... [--decision-file <path|->]',
	'       josh epic --untrack <E> <N1> <N2> ...',
	'       josh epic --reconcile <E>',
	'       josh epic --decide <E> <N1> <N2> ... --decision-file <path|->',
].join('\n')
const FAILURE_EXIT_CODE = 1
const SUCCESS_EXIT_CODE = 0

// Whether a split's child could not merge alone, its refusal printed — read before creation and
// promotion write anything, the two forms a split files its epic through. `--add` places an issue
// filed on its own and `epic:bundle` groups related ones, so neither is a split.
async function is_split_stranded(children: ReadonlyArray<number>): Promise<boolean> {
	const refusal = await epic_split_reach.refusal_of(children)

	if (refusal !== undefined) console.error(refusal)

	return refusal !== undefined
}

// Whether the `--chain` declarations were refused, the reason printed — before anything is written.
function is_chain_refused(parsed: ChainRead): boolean {
	if (parsed.chain_refusal !== undefined) console.error(`✖ ${parsed.chain_refusal}`)

	return parsed.chain_refusal !== undefined
}

// Whether the rationale read is blank, the refusal printed — an epic whose `## Split rationale` is the
// template placeholder records no reason for the split (joshuafolkken/kit#8798).
function is_rationale_missing(rationale: string): boolean {
	if (rationale.trim() !== '') return false

	console.error(
		`✖ A split rationale is required: write it under .josh/tmp/ and pass \`--rationale-file .josh/tmp/<dir>/rationale.md\` (\`-\` reads stdin); nothing was written.\n${USAGE}`,
	)

	return true
}

interface GuardedSplit extends ChainRead {
	children: ReadonlyArray<number>
	rationale_path?: string | undefined
}

// The rationale, read once (`-` is stdin, which cannot be read twice), or `undefined` when a guard
// refused, its reason printed — all before anything is written. `run:split` creates through
// `create` without a rationale, so only the `josh epic` command requires one.
async function rationale_past_guards(
	parsed: GuardedSplit,
	is_rationale_required: boolean,
): Promise<string | undefined> {
	if (is_chain_refused(parsed) || (await is_split_stranded(parsed.children))) return undefined

	const rationale = epic_cli.read_rationale(parsed.rationale_path)

	if (is_rationale_required && is_rationale_missing(rationale)) return undefined

	return rationale
}

async function run_promotion(argv: ReadonlyArray<string>): Promise<number> {
	const parsed = epic_cli.parse_promote_arguments(argv)

	if (parsed === undefined) {
		console.error(`✖ An issue number and at least one child issue number are required.\n${USAGE}`)

		return FAILURE_EXIT_CODE
	}

	const rationale = await rationale_past_guards(parsed, true)

	if (rationale === undefined) return FAILURE_EXIT_CODE

	const exit_code = await epic_run.promote_epic({
		epic_number: parsed.epic_number,
		children: parsed.children,
		rationale,
		is_ordered: parsed.is_ordered,
		chains: parsed.chains,
		order_reasons: parsed.order_reasons,
		origin: parsed.origin,
		title: parsed.title,
	})

	await epic_notify.announce(parsed, epic_notify.promoted_number(exit_code, parsed.epic_number))

	return exit_code
}

// The decision file's text, then the `--chain` / `--before` / `--after` orders with their
// `--order-reason`s — the one record an insertion writes, so an added order's reason lands in
// `## Decisions` and on its children.
function to_add_decision(parsed: AddArguments): string | undefined {
	const parts = [
		epic_cli.read_decision(parsed.decision_path),
		epic_body.format_added_order(epic_cli_chain.declared_of(parsed), parsed.order_reasons ?? []),
	].filter((part) => part !== undefined)

	return parts.length === 0 ? undefined : parts.join('\n\n')
}

// The parsed insertion as the writer's input: the decision file becomes the decision itself, read here
// rather than inside the writer so nothing reaches GitHub before the file has been found. **Both
// insertion paths go through it** — the bare form and the `owner/repo#N` one that resolves to this
// repository — because passing the parsed arguments straight through drops `decision_path` in silence,
// the field having a different name on either side.
function to_add_input(parsed: AddArguments): AddChildrenInput {
	return {
		epic_number: parsed.epic_number,
		children: parsed.children,
		position: parsed.position,
		is_order_only: parsed.is_order_only,
		chains: parsed.chains,
		decision: to_add_decision(parsed),
	}
}

// The insertion itself, on either path, once its `--chain` declarations have been read.
async function add_parsed(parsed: AddArguments): Promise<number> {
	if (is_chain_refused(parsed)) return FAILURE_EXIT_CODE

	return await epic_add.add_children(to_add_input(parsed))
}

// A qualified target — `owner/repo#N`. Naming this repository it is the same insertion written
// longer, so it is performed; naming another it is refused with the command to run there, because
// this command reads and writes only the repository it runs from.
async function run_qualified_addition(found: CrossRepoAddTarget): Promise<number> {
	// A refused `--chain` is reported here, before either answer: a suggestion built without it would be
	// a different instruction from the one typed.
	if (is_chain_refused(found.local)) return FAILURE_EXIT_CODE

	const local = epic_cli.resolve_local_add(found, await git_gh_command.repo_get_name_with_owner())

	if (local !== undefined) return await epic_add.add_children(to_add_input(local))

	console.error(epic_cli.format_cross_repo_refusal(found))

	return FAILURE_EXIT_CODE
}

// Why an insertion could not be read. A qualified target is answered on its own terms; an unusable
// `--decision-file` path is named, because the generic line below would send the person after the epic
// number and the positioning flag when what went missing is the record path a shell expanded to
// nothing; anything else gets the requirements and the usage line.
async function refuse_addition(argv: ReadonlyArray<string>): Promise<number> {
	const qualified = epic_cli.find_cross_repo_add_target(argv)

	if (qualified !== undefined) return await run_qualified_addition(qualified)

	if (epic_cli.is_decision_path_unusable(argv)) {
		console.error(
			`✖ \`--decision-file\` needs exactly one readable path (\`-\` reads stdin); nothing was written.\n${USAGE}`,
		)

		return FAILURE_EXIT_CODE
	}

	console.error(
		`✖ An epic number, at least one child issue number, and at most one valid \`--before\` / \`--after\` target are required.\n${USAGE}`,
	)

	return FAILURE_EXIT_CODE
}

// Insertion into an existing epic. No rationale and no `--ordered`: the epic already declares both,
// and the insertion is positioned relative to what is there rather than restating it.
//
// `--decision-file` is the one text an insertion does carry, and it is a *decision* rather than the
// epic's rationale: it says why this child was placed here, and it goes to the epic's `## Decisions`
// and to each child.
async function run_addition(argv: ReadonlyArray<string>): Promise<number> {
	const parsed = epic_cli.parse_add_arguments(argv)

	if (parsed === undefined) return await refuse_addition(argv)

	return await add_parsed(parsed)
}

// Deleting a declared order. No position and no `--ordered`: the path itself says which orders go,
// and what is deleted is only ever what it names — the ends are never reconnected, since a removal
// that wrote an order would be declaring one nobody stated.
async function run_removal(argv: ReadonlyArray<string>): Promise<number> {
	const parsed = epic_cli.parse_remove_arguments(argv)

	if (parsed === undefined) {
		console.error(
			`✖ An epic number and at least two child issue numbers are required, and \`--decision-file\` needs exactly one readable path (\`-\` reads stdin).\n${USAGE}`,
		)

		return FAILURE_EXIT_CODE
	}

	return await epic_remove.remove_order({
		epic_number: parsed.epic_number,
		path: parsed.path,
		decision: epic_cli.read_decision(parsed.decision_path),
	})
}

// A decision about children the epic already tracks — the half `--add --decision-file` cannot write,
// since an insertion with nothing to add is refused.
async function run_decision(argv: ReadonlyArray<string>): Promise<number> {
	const parsed = epic_cli.parse_decide_arguments(argv)

	if (parsed === undefined) {
		console.error(
			`✖ An epic number, at least one child issue number, and exactly one readable \`--decision-file\` path (\`-\` reads stdin) are required.\n${USAGE}`,
		)

		return FAILURE_EXIT_CODE
	}

	return await epic_decide.decide({
		epic_number: parsed.epic_number,
		children: parsed.children,
		decision: epic_cli.read_decision(parsed.decision_path) ?? '',
	})
}

// Reconcile an epic's declaration with its recorded relations. No decision file and no children: the
// repair reads what the epic already records rather than being told an order.
async function run_reconciliation(argv: ReadonlyArray<string>): Promise<number> {
	const parsed = epic_cli.parse_reconcile_arguments(argv)

	if (parsed === undefined) {
		console.error(`✖ An epic number is required.\n${USAGE}`)

		return FAILURE_EXIT_CODE
	}

	return await epic_reconcile.reconcile_epic(parsed.epic_number)
}

// `epic: undefined` is a created epic whose URL could not be read — still a success here.
type Creation = { kind: 'refused' } | { kind: 'created'; epic: number | undefined }

async function create(
	argv: ReadonlyArray<string>,
	is_rationale_required = false,
): Promise<Creation> {
	const parsed = epic_cli.parse_create_arguments(argv)

	if (parsed === undefined) {
		console.error(`✖ A title and at least one child issue number are required.\n${USAGE}`)

		return { kind: 'refused' }
	}

	const rationale = await rationale_past_guards(parsed, is_rationale_required)

	if (rationale === undefined) return { kind: 'refused' }

	const epic_number = await epic_run.create_epic_number({
		title: parsed.title,
		children: parsed.children,
		rationale,
		is_ordered: parsed.is_ordered,
		chains: parsed.chains,
		order_reasons: parsed.order_reasons,
		origin: parsed.origin,
	})

	await epic_notify.announce(parsed, epic_number)

	return { kind: 'created', epic: epic_number }
}

async function run_creation(argv: ReadonlyArray<string>): Promise<number> {
	const creation = await create(argv, true)

	return creation.kind === 'refused' ? FAILURE_EXIT_CODE : SUCCESS_EXIT_CODE
}

async function run_untrack(argv: ReadonlyArray<string>): Promise<number> {
	const parsed = epic_cli_untrack.parse_arguments(argv)

	if (parsed === undefined) {
		console.error(
			`✖ An epic number and at least one distinct child issue number are required.\n${USAGE}`,
		)

		return FAILURE_EXIT_CODE
	}

	return await epic_untrack.untrack(parsed.epic_number, parsed.children)
}

type EpicForm = readonly [
	(argv: ReadonlyArray<string>) => boolean,
	(argv: ReadonlyArray<string>) => Promise<number>,
]

// Checked in this order. `--add` comes before `--promote`: both name an existing issue first, and only
// the flag distinguishes "insert into this epic" from "turn this issue into one".
const FLAGGED_FORMS: ReadonlyArray<EpicForm> = [
	[epic_cli_untrack.is_untrack, run_untrack],
	[epic_cli.is_reconciliation, run_reconciliation],
	[epic_cli.is_removal, run_removal],
	[epic_cli.is_decision_entry, run_decision],
	[epic_cli.is_addition, run_addition],
	[epic_cli.is_promotion, run_promotion],
]

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const form = FLAGGED_FORMS.find(([is_form]) => is_form(argv))
	const run_form = form === undefined ? run_creation : form[1]

	return await run_form(argv)
}

const epic_command = { run, create }

export type { Creation }
export { epic_command }
