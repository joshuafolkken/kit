#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { git_branch } from '#scripts/git/git-branch'
import { git_issue } from '#scripts/git/git-issue'
import { run_ship_preflight } from '#scripts/run/ship/run-ship-preflight'
import { acceptance_map_check } from './acceptance-map-check'

// `josh acceptance:check` — `josh ship`'s acceptance-map refusal asked before the review, of the body the
// next ship delivers (the ship body draft, else the open PR's), with a row still pending counted as a
// row: only a criterion with no row stops it (joshuafolkken/kit#7727). `run:chain` runs it before
// `run:review`. No body yet passes — ship writes every row into its draft.
// Exit 0, 1 on a refusal, 2 on a usage error.

const USAGE = 'Usage: josh acceptance:check'
const PASS = 'acceptance:check: pass'
const REFUSED_EXIT = 1
const USAGE_EXIT = 2
const FIRST_ARGUMENT = 2

async function refusal(issue: string): Promise<string | undefined> {
	const body = await run_ship_preflight.body_text(undefined)

	if (body === undefined) return undefined

	return await acceptance_map_check.body_refusal(issue, body, { pending_present: true })
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	if (argv.length > 0) {
		console.error(USAGE)

		return USAGE_EXIT
	}

	const issue = git_issue.branch_number(await git_branch.current())
	const problem = issue === undefined ? undefined : await refusal(issue)

	if (problem === undefined) {
		console.info(PASS)

		return 0
	}

	console.error(problem)

	return REFUSED_EXIT
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await run(process.argv.slice(FIRST_ARGUMENT))
}

const acceptance_check_cli = { PASS, USAGE, run }

export { acceptance_check_cli }
