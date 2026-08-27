#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { git_command } from '#scripts/git/git-command'
import { review_level, type ReviewLevel } from './review-level'

// `josh review:level` — print the `/code-review` level this change is reviewed at
// (joshuafolkken/kit#966).
//
// A command rather than a paragraph, because the point of the rule is that it takes no judgement.
// A rule an agent applies from memory is a rule an agent can talk itself out of; one it has to run
// answers the same way every time.

const ARGV_OFFSET = 2
const FAILURE_EXIT_CODE = 1
const USAGE = 'Usage: josh review:level [--staged] [--json]'
const MAX_LISTED_PATHS = 5

interface Options {
	is_staged: boolean
	is_json: boolean
}

function parse_options(argv: ReadonlyArray<string>): Options | undefined {
	const known = new Set(['--staged', '--json'])

	if (argv.some((argument) => !known.has(argument))) return undefined

	return { is_staged: argv.includes('--staged'), is_json: argv.includes('--json') }
}

function to_paths(raw: string): Array<string> {
	return raw
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line !== '')
}

// The branch diff **plus** the untracked files. `git diff` lists neither, so a change that adds a
// new module and edits one inert file looked like an inert-only change and was handed `low`. The
// staged form needs no such addition: a file staged for addition is already in the cached diff.
async function changed_paths(is_staged: boolean): Promise<Array<string>> {
	if (is_staged) return to_paths(await git_command.diff_cached_names())

	const tracked = to_paths(await git_command.diff_main_names())
	const untracked = to_paths(await git_command.untracked_names())

	return [...tracked, ...untracked]
}

function format_reason(paths: ReadonlyArray<string>, level: ReviewLevel): string {
	if (level === review_level.REDUCED_LEVEL) {
		return 'every changed path is inert — it neither executes nor instructs'
	}

	const deciding = review_level.deciding_paths(paths)

	if (deciding.length === 0) return 'no changed paths; the default level stands'

	const listed = deciding.slice(0, MAX_LISTED_PATHS).join(', ')
	const rest =
		deciding.length > MAX_LISTED_PATHS
			? `, +${String(deciding.length - MAX_LISTED_PATHS)} more`
			: ''

	return `changed paths that execute or instruct: ${listed}${rest}`
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const options = parse_options(argv)

	if (options === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const paths = await changed_paths(options.is_staged)
	const level = review_level.level_for(paths)

	// The level alone on stdout, so `$(josh review:level)` reads it; the reason on stderr, so a
	// person sees why without a shell having to parse around it.
	if (options.is_json) console.info(JSON.stringify({ level, reason: format_reason(paths, level) }))
	else console.info(level)

	if (!options.is_json) console.error(format_reason(paths, level))

	return 0
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const review_level_cli = { USAGE, parse_options, changed_paths, format_reason, run, main }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { review_level_cli }
