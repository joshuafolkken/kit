#!/usr/bin/env tsx
/**
 * Create an epic Issue that satisfies every requirement the auto-close and the order warning read.
 *
 * Usage: tsx scripts-ai/epic.ts "<title>" <N1> <N2> ... [--ordered] [--rationale-file <path|->]
 *                                                       [--origin <owner/repo#N>]
 */
import { git_epic_run } from '../scripts/git/git-epic-run'
import { epic_cli } from './epic-cli'

const ARGV_OFFSET = 2
const USAGE =
	'Usage: josh epic "<title>" <N1> <N2> ... [--ordered] [--rationale-file <path|->] [--origin <owner/repo#N>]'
const FAILURE_EXIT_CODE = 1

async function main(): Promise<void> {
	const parsed = epic_cli.parse_create_arguments(process.argv.slice(ARGV_OFFSET))

	if (parsed === undefined) {
		console.error(`✖ A title and at least one child issue number are required.\n${USAGE}`)
		process.exit(FAILURE_EXIT_CODE)
	}

	const exit_code = await git_epic_run.create_epic({
		title: parsed.title,
		children: parsed.children,
		rationale: epic_cli.read_rationale(parsed.rationale_path),
		is_ordered: parsed.is_ordered,
		origin: parsed.origin,
	})

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
