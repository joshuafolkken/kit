#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { git_command } from '#scripts/git/git-command'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { session_cite } from '#scripts/issue/session-cite'
import { issue_watch, type Acknowledged } from './issue-watch'

// `josh issue:ack <N>` — record that the run has read a person's update to its issue, so the hook,
// the review attestation and `josh followup` stop raising it. It prints the update it acknowledges:
// the same read becomes the new baseline (`issue-watch.ts` → `acknowledge`), so nothing that arrived
// after the hook spoke can be acknowledged without being printed here.
//
// **The number is asked for, though the record already carries it**, so an acknowledgement typed for
// one issue cannot silently clear the watch on another.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const USAGE = 'Usage: josh issue:ack <issue-number>'
const NO_WATCH_LINE =
	'No run recorded a baseline for that issue in this checkout (`josh run:entry` writes it), or the issue could not be read — nothing was acknowledged.'
const NOTHING_NEW_LINE = 'No person has updated the issue since the run last read it.'

function parse_number(argv: ReadonlyArray<string>): string | undefined {
	const [first] = argv

	if (first === undefined || argv.length !== 1) return undefined

	return issue_number_shape.ISSUE_NUMBER_PATTERN.test(first) ? first : undefined
}

function report(acknowledged: Acknowledged): void {
	const heading = `Acknowledged issue ${session_cite.issue(acknowledged.issue)}.`

	console.info(
		acknowledged.diff === undefined
			? `${heading} ${NOTHING_NEW_LINE}`
			: `${heading}\n\n${acknowledged.diff}`,
	)
}

async function acknowledge(issue_number: string): Promise<number> {
	const root = await git_command.repository_root()

	if (issue_watch.read_record(root)?.issue !== issue_number) {
		console.error(NO_WATCH_LINE)

		return FAILURE_EXIT_CODE
	}

	const acknowledged = await issue_watch.acknowledge(root)

	if (acknowledged === undefined) {
		console.error(NO_WATCH_LINE)

		return FAILURE_EXIT_CODE
	}

	report(acknowledged)

	return SUCCESS_EXIT_CODE
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const issue_number = parse_number(argv)

	if (issue_number === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	return await acknowledge(issue_number)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const issue_ack_cli = { run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { issue_ack_cli }
