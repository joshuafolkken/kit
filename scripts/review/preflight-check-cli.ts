#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import type { Unmet } from '#scripts/git/git-preflight'
import { run_ship_preflight } from '#scripts/run/ship/run-ship-preflight'

// `josh preflight:check` — `josh ship`'s preflight judgments read off the Issue, the ship body draft
// and the tree (classification, live-evidence, removed-tests, unplanned) asked before the review,
// through the ship's own calls (`run_ship_preflight.chain_problems`), so a refusal stops `run:chain`
// rather than the ship (joshuafolkken/kit#7773). Each problem is named by the ship's precondition kind.
// Exit 0, 1 on a refusal, 2 on a usage error.

const USAGE = 'Usage: josh preflight:check'
const PASS = 'preflight:check: pass'
const REFUSED_EXIT = 1
const USAGE_EXIT = 2
const FIRST_ARGUMENT = 2

function refusal_text(problems: ReadonlyArray<Unmet>): string {
	const lines = problems.map(({ kind, problem }) => `  - ${kind}: ${problem}`)

	return [`preflight:check: ${String(problems.length)} ship precondition(s) unmet:`, ...lines].join(
		'\n',
	)
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	if (argv.length > 0) {
		console.error(USAGE)

		return USAGE_EXIT
	}

	const problems = await run_ship_preflight.chain_problems()

	if (problems.length === 0) {
		console.info(PASS)

		return 0
	}

	console.error(refusal_text(problems))

	return REFUSED_EXIT
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await run(process.argv.slice(FIRST_ARGUMENT))
}

const preflight_check_cli = { PASS, USAGE, run }

export { preflight_check_cli }
