#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { run_next } from './run-next'
import { run_prep_cli } from './run-prep-cli'

// `josh run:next <N>` — print the next step a `fullrun` takes, from the run's state
// (joshuafolkken/kit#2188). It reads exactly what `run:prep` reads — the issue state, the
// `human_review` line and the dependency scope — by calling `run:prep`'s own gather, so the two never
// answer from different facts, and hands the assembled parts to the state → step mapping in
// `run-next.ts`.
//
// **It is the consumer `run:prep` was built to have.** joshuafolkken/kit#1978 bundled the reads;
// joshuafolkken/kit#2165 added the read-only glance; this one prints the decision those reads support,
// which is the trim epic #2166 is after — prose a reader interprets replaced by a computed answer.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const USAGE = 'Usage: josh run:next <issue-number>'

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const issue_number = run_prep_cli.parse_number(argv)

	if (issue_number === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const reads = await run_prep_cli.gather(issue_number)
	const parts = run_prep_cli.to_parts(issue_number, reads)

	console.info(run_next.format_report(parts))

	// A state that could not be read is a non-zero exit, exactly as `run:prep` exits on the same
	// failure, so a bundle missing its state is never read as a confident "implement".
	return parts.state === undefined ? FAILURE_EXIT_CODE : SUCCESS_EXIT_CODE
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const run_next_cli = { USAGE, main, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { run_next_cli }
