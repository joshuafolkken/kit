#!/usr/bin/env tsx
/**
 * Create an epic Issue that satisfies every requirement the auto-close and the order warning read.
 *
 * Usage: tsx scripts/epic/epic.ts "<title>" <N1> <N2> ... [--ordered] [--rationale-file <path|->]
 *                                                       [--origin <owner/repo#N>] [--notify]
 *        tsx scripts/epic/epic.ts --promote <N> <N1> <N2> ... [same flags] [--title <title>]
 *        tsx scripts/epic/epic.ts --add <E> <N1> <N2> ... [--before <M> | --after <M>]
 *                                                      [--decision-file <path|->]
 *        tsx scripts/epic/epic.ts --remove <E> <M> <N> ... [--decision-file <path|->]
 *        tsx scripts/epic/epic.ts --decide <E> <N1> <N2> ... --decision-file <path|->
 */
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { error_text } from '#scripts/lib/error-message'
import { epic_add, type AddChildrenInput } from './epic-add'
import { epic_cli, type AddArguments, type CrossRepoAddTarget } from './epic-cli'
import { epic_decide } from './epic-decide'
import { epic_notify } from './epic-notify'
import { epic_reconcile } from './epic-reconcile'
import { epic_remove } from './epic-remove'
import { epic_run } from './epic-run'

const ARGV_OFFSET = 2
const FLAGS = '[--ordered] [--rationale-file <path|->] [--origin <owner/repo#N>] [--notify]'
const USAGE = [
	`Usage: josh epic "<title>" <N1> <N2> ... ${FLAGS}`,
	`       josh epic --promote <N> <N1> <N2> ... ${FLAGS} [--title <title>]`,
	'       josh epic --add <E> <N1> <N2> ... [--before <M> | --after <M>] [--decision-file <path|->]',
	'       josh epic --add <E> <N1> <N2> ... [--order-before <M> | --order-after <M>] [--decision-file <path|->]',
	'       josh epic --remove <E> <M> <N> ... [--decision-file <path|->]',
	'       josh epic --reconcile <E>',
	'       josh epic --decide <E> <N1> <N2> ... --decision-file <path|->',
].join('\n')
const FAILURE_EXIT_CODE = 1
const SUCCESS_EXIT_CODE = 0

async function run_promotion(argv: ReadonlyArray<string>): Promise<number> {
	const parsed = epic_cli.parse_promote_arguments(argv)

	if (parsed === undefined) {
		console.error(`✖ An issue number and at least one child issue number are required.\n${USAGE}`)

		return FAILURE_EXIT_CODE
	}

	const exit_code = await epic_run.promote_epic({
		epic_number: parsed.epic_number,
		children: parsed.children,
		rationale: epic_cli.read_rationale(parsed.rationale_path),
		is_ordered: parsed.is_ordered,
		origin: parsed.origin,
		title: parsed.title,
	})
	const promoted = exit_code === SUCCESS_EXIT_CODE ? parsed.epic_number : undefined

	await epic_notify.announce(parsed, promoted)

	return exit_code
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
		decision: epic_cli.read_decision(parsed.decision_path),
	}
}

// A qualified target — `owner/repo#N`. Naming this repository it is the same insertion written
// longer, so it is performed; naming another it is refused with the command to run there, because
// this command reads and writes only the repository it runs from.
async function run_qualified_addition(found: CrossRepoAddTarget): Promise<number> {
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

	return await epic_add.add_children(to_add_input(parsed))
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

async function run_creation(argv: ReadonlyArray<string>): Promise<number> {
	const parsed = epic_cli.parse_create_arguments(argv)

	if (parsed === undefined) {
		console.error(`✖ A title and at least one child issue number are required.\n${USAGE}`)

		return FAILURE_EXIT_CODE
	}

	const epic_number = await epic_run.create_epic_number({
		title: parsed.title,
		children: parsed.children,
		rationale: epic_cli.read_rationale(parsed.rationale_path),
		is_ordered: parsed.is_ordered,
		origin: parsed.origin,
	})

	await epic_notify.announce(parsed, epic_number)

	return SUCCESS_EXIT_CODE
}

type EpicForm = readonly [
	(argv: ReadonlyArray<string>) => boolean,
	(argv: ReadonlyArray<string>) => Promise<number>,
]

// Checked in this order. `--add` comes before `--promote`: both name an existing issue first, and only
// the flag distinguishes "insert into this epic" from "turn this issue into one".
const FLAGGED_FORMS: ReadonlyArray<EpicForm> = [
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

async function main(): Promise<void> {
	const exit_code = await run(process.argv.slice(ARGV_OFFSET))

	if (exit_code !== 0) process.exit(exit_code)
}

// A `gh` failure carries its stderr as the message, which is the useful part; printing it alone
// keeps a routine "not authenticated" or "label not found" from arriving as a stack trace.
try {
	await main()
} catch (error) {
	console.error(`✖ ${error_text.message_of(error)}`)
	process.exit(FAILURE_EXIT_CODE)
}
