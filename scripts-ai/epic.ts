#!/usr/bin/env tsx
/**
 * Create an epic Issue that satisfies every requirement the auto-close and the order warning read.
 *
 * Usage: tsx scripts-ai/epic.ts "<title>" <N1> <N2> ... [--ordered] [--rationale-file <path|->]
 *                                                       [--origin <owner/repo#N>]
 *        tsx scripts-ai/epic.ts --promote <N> <N1> <N2> ... [same flags]
 *        tsx scripts-ai/epic.ts --add <E> <N1> <N2> ... [--before <M> | --after <M>]
 */
import { git_epic_add } from '../scripts/git/git-epic-add'
import { git_epic_run } from '../scripts/git/git-epic-run'
import { git_gh_command } from '../scripts/git/git-gh-command'
import { epic_cli, type CrossRepoAddTarget } from './epic-cli'

const ARGV_OFFSET = 2
const FLAGS = '[--ordered] [--rationale-file <path|->] [--origin <owner/repo#N>]'
const USAGE = [
	`Usage: josh epic "<title>" <N1> <N2> ... ${FLAGS}`,
	`       josh epic --promote <N> <N1> <N2> ... ${FLAGS}`,
	'       josh epic --add <E> <N1> <N2> ... [--before <M> | --after <M>]',
].join('\n')
const FAILURE_EXIT_CODE = 1

async function run_promotion(argv: ReadonlyArray<string>): Promise<number> {
	const parsed = epic_cli.parse_promote_arguments(argv)

	if (parsed === undefined) {
		console.error(`✖ An issue number and at least one child issue number are required.\n${USAGE}`)

		return FAILURE_EXIT_CODE
	}

	return await git_epic_run.promote_epic({
		epic_number: parsed.epic_number,
		children: parsed.children,
		rationale: epic_cli.read_rationale(parsed.rationale_path),
		is_ordered: parsed.is_ordered,
		origin: parsed.origin,
	})
}

// A qualified target — `owner/repo#N`. Naming this repository it is the same insertion written
// longer, so it is performed; naming another it is refused with the command to run there, because
// this command reads and writes only the repository it runs from (joshuafolkken/kit#985).
async function run_qualified_addition(found: CrossRepoAddTarget): Promise<number> {
	const local = epic_cli.resolve_local_add(found, await git_gh_command.repo_get_name_with_owner())

	if (local !== undefined) return await git_epic_add.add_children(local)

	console.error(epic_cli.format_cross_repo_refusal(found))

	return FAILURE_EXIT_CODE
}

// Why an insertion could not be read. A qualified target is answered on its own terms; anything else
// gets the requirements and the usage line.
async function refuse_addition(argv: ReadonlyArray<string>): Promise<number> {
	const qualified = epic_cli.find_cross_repo_add_target(argv)

	if (qualified !== undefined) return await run_qualified_addition(qualified)

	console.error(
		`✖ An epic number, at least one child issue number, and at most one valid \`--before\` / \`--after\` target are required.\n${USAGE}`,
	)

	return FAILURE_EXIT_CODE
}

// Insertion into an existing epic. No rationale and no `--ordered`: the epic already declares both,
// and the insertion is positioned relative to what is there rather than restating it.
async function run_addition(argv: ReadonlyArray<string>): Promise<number> {
	const parsed = epic_cli.parse_add_arguments(argv)

	if (parsed === undefined) return await refuse_addition(argv)

	return await git_epic_add.add_children({
		epic_number: parsed.epic_number,
		children: parsed.children,
		position: parsed.position,
	})
}

async function run_creation(argv: ReadonlyArray<string>): Promise<number> {
	const parsed = epic_cli.parse_create_arguments(argv)

	if (parsed === undefined) {
		console.error(`✖ A title and at least one child issue number are required.\n${USAGE}`)

		return FAILURE_EXIT_CODE
	}

	return await git_epic_run.create_epic({
		title: parsed.title,
		children: parsed.children,
		rationale: epic_cli.read_rationale(parsed.rationale_path),
		is_ordered: parsed.is_ordered,
		origin: parsed.origin,
	})
}

// `--add` is checked before `--promote`: both name an existing issue first, and only the flag
// distinguishes "insert into this epic" from "turn this issue into one".
async function run(argv: ReadonlyArray<string>): Promise<number> {
	if (epic_cli.is_addition(argv)) return await run_addition(argv)
	if (epic_cli.is_promotion(argv)) return await run_promotion(argv)

	return await run_creation(argv)
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
	console.error(`✖ ${error instanceof Error ? error.message : String(error)}`)
	process.exit(FAILURE_EXIT_CODE)
}
