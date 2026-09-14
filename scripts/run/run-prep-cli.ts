#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { issue_read_cli, type BlockRead } from '#scripts/issue/issue-read-cli'
import { issue_state_cli, type StateRead } from '#scripts/issue/issue-state-cli'
import { latest_scope_cli } from '#scripts/version/latest-scope-cli'
import { run_prep, type PrepParts } from './run-prep'

// `josh run:prep <N>` — one call for the reads a `fullrun` makes before its first edit
// (joshuafolkken/kit#1978): the issue body and comments (`issue:read`), the state, labels and
// `human_review` line (`issue:state`), and the dependency-update scope (`latest:scope`). Each is
// reused rather than reproduced, and the two body reads run concurrently, so three round trips become
// one.
//
// **The hold and the cost check stay their own calls.** `run:hold` writes the working-tree record and
// `cost --over` reads the session, not the issue; folding a side effect and a session read into a
// bundle of issue reads would make one command answer three unrelated questions. They are batched in
// the same turn as this one instead.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const ISSUE_NUMBER_PATTERN = /^[1-9]\d*$/u
const USAGE = 'Usage: josh run:prep <issue-number>'

interface LatestDecision {
	scope: string
	reason: string
}

interface PrepReads {
	content: BlockRead
	state: StateRead
	latest: LatestDecision
}

// Exactly one issue number, or the call is refused: `run:prep` prepares one run, and a second number
// would print a second issue's body a caller reads as this run's own.
function parse_number(argv: ReadonlyArray<string>): string | undefined {
	const [first] = argv

	if (first === undefined || argv.length !== 1 || !ISSUE_NUMBER_PATTERN.test(first)) {
		return undefined
	}

	return first
}

// One note for a read that produced nothing, naming which of the two it was — the same distinction
// `issue:read` and `issue:state` keep, so a bundled failure still tells a retry from an answer.
function failure_note(issue_number: string, kind: string): string {
	return `(issue #${issue_number} not bundled: ${kind})`
}

async function gather(issue_number: string): Promise<PrepReads> {
	const [content, state] = await Promise.all([
		issue_read_cli.read_block(issue_number),
		issue_state_cli.read_issue(issue_number),
	])

	return { content, state, latest: latest_scope_cli.decide() }
}

function content_body(issue_number: string, content: BlockRead): string {
	return content.kind === 'ok' ? content.block : failure_note(issue_number, content.kind)
}

function to_parts(issue_number: string, reads: PrepReads): PrepParts {
	const state = reads.state.kind === 'state' ? reads.state.state : undefined
	const state_failure = state === undefined ? failure_note(issue_number, reads.state.kind) : ''

	return {
		issue_number,
		content_body: content_body(issue_number, reads.content),
		state,
		state_failure,
		latest_scope: reads.latest.scope,
		latest_reason: reads.latest.reason,
	}
}

// Non-zero when either issue read failed, exactly as `issue:read` and `issue:state` each exit, so a
// bundle missing a part is never read as a complete one.
function exit_code(reads: PrepReads): number {
	const is_complete = reads.content.kind === 'ok' && reads.state.kind === 'state'

	return is_complete ? SUCCESS_EXIT_CODE : FAILURE_EXIT_CODE
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const issue_number = parse_number(argv)

	if (issue_number === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const reads = await gather(issue_number)

	console.info(run_prep.format_report(to_parts(issue_number, reads)))

	return exit_code(reads)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const run_prep_cli = { USAGE, main, parse_number, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { run_prep_cli }
