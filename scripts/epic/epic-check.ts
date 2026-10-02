#!/usr/bin/env tsx
/**
 * Check an existing epic Issue against the four requirements, reporting each as pass or fail.
 *
 * Usage: tsx scripts/epic/epic-check.ts <issue-number>
 */
import { error_text } from '#scripts/lib/error-message'
import { epic_cli } from './epic-cli'
import { epic_run } from './epic-run'

const ARGV_OFFSET = 2
const USAGE = 'Usage: josh epic:check <issue-number>'
const FAILURE_EXIT_CODE = 1

async function main(): Promise<void> {
	const epic_number = epic_cli.parse_check_argument(process.argv.slice(ARGV_OFFSET))

	if (epic_number === undefined) {
		console.error(`✖ An epic issue number is required.\n${USAGE}`)
		process.exit(FAILURE_EXIT_CODE)
	}

	const exit_code = await epic_run.check_epic(epic_number)

	if (exit_code !== 0) process.exit(exit_code)
}

// A `gh` failure carries its stderr as the message, which is the useful part; printing it alone
// keeps a routine "not authenticated" from arriving as a stack trace.
try {
	await main()
} catch (error) {
	console.error(`✖ ${error_text.message_of(error)}`)
	process.exit(FAILURE_EXIT_CODE)
}
