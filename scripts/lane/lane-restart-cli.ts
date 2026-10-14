#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { lane_dispatch } from './lane-dispatch'
import { lane_restart, type RestartOutcome } from './lane-restart'

// `josh lane:restart <issue>` — the contract `lane:dispatch` sets: the fresh child's pid is the one
// token on standard output, every explanation on standard error, and a restart that did not start a
// fresh child exits non-zero. A failed dispatch is warned off-screen exactly as `lane:dispatch` warns it,
// since the stopped child is then left for `run:merge` to collect.

const ARGV_OFFSET = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const USAGE = 'Usage: josh lane:restart <issue-number>'

async function report(outcome: RestartOutcome, issue: string): Promise<number> {
	console.error(lane_restart.describe(outcome, issue))

	if (outcome.kind !== 'restarted') return FAILURE_EXIT_CODE
	const { dispatch } = outcome

	if (lane_dispatch.is_worth_warning(dispatch)) await lane_dispatch.warn_of_problem(dispatch, issue)
	if (dispatch.kind !== 'dispatched') return FAILURE_EXIT_CODE

	console.info(String(dispatch.pid))

	return SUCCESS_EXIT_CODE
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const issue = argv.length === 1 ? argv[0] : undefined

	if (issue === undefined || !issue_number_shape.is_issue_number(issue)) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	return await report(await lane_restart.restart(issue), issue)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const lane_restart_cli = { run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { lane_restart_cli }
