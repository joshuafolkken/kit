#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { josh_command } from '#scripts/josh/josh-run'
import { run_tail, type TailSection } from './run-tail'

// `josh run:tail [<N> ...]` — one call for the fixed post-merge sequence a run closes on
// (joshuafolkken/kit#2372). The loop used to spend a round trip on `observations:flush`, one on
// `issue:cite` and one on `release:scope`, re-billing a lane's full context each time; this runs the
// three internally and prints one composite report, the same way `backlog:offer` chains its two calls
// and `run:prep` bundles three reads. Each step's stderr is forwarded, so the reader still sees every
// explanation the three would have printed on their own.
//
// The issue numbers are the completion's citations — the closed issue and any follow-ups filed this run
// — and go to `issue:cite`; the other two take none. A `run:tail` with no numbers still closes the run,
// because `issue:cite` with no target exits zero.

const ARGV_OFFSET = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ISSUE_NUMBER_PATTERN = /^[1-9]\d*$/u
const USAGE = 'Usage: josh run:tail [<issue-number> ...]'
const should_forward_stderr = true

interface Step {
	header: string
	argv: (issues: ReadonlyArray<string>) => ReadonlyArray<string>
}

// The three steps in the order a run closes on: the ledger is committed first so the recurrence count is
// on main, the citations are read for the completion report, and the release scope is decided last.
const STEPS: ReadonlyArray<Step> = [
	{ header: run_tail.OBSERVATIONS_HEADER, argv: () => ['observations:flush'] },
	{ header: run_tail.CITATIONS_HEADER, argv: (issues) => ['issue:cite', ...issues] },
	{ header: run_tail.RELEASE_HEADER, argv: () => ['release:scope'] },
]

// Numbers only — a target `issue:cite` reads as an issue, so a stray flag is refused rather than
// forwarded to the wrong step.
function parse_issues(argv: ReadonlyArray<string>): ReadonlyArray<string> | undefined {
	if (argv.every((token) => ISSUE_NUMBER_PATTERN.test(token))) return argv

	return undefined
}

async function run_step(step: Step, issues: ReadonlyArray<string>): Promise<TailSection> {
	const result = await josh_command.josh_run(step.argv(issues), should_forward_stderr)

	return {
		header: step.header,
		body: run_tail.section_body(result.out, result.err, result.code),
		code: result.code,
	}
}

// Run the three in order, not concurrently: the ledger commit must land on main before the release scope
// reads main's pending count, and the order is what a lane spent three turns on.
async function close_run(issues: ReadonlyArray<string>): Promise<ReadonlyArray<TailSection>> {
	const sections: Array<TailSection> = []

	for (const step of STEPS) sections.push(await run_step(step, issues))

	return sections
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const issues = parse_issues(argv)

	if (issues === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const sections = await close_run(issues)

	console.info(run_tail.format_report(sections))

	return run_tail.exit_code(sections)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const run_tail_cli = { SUCCESS_EXIT_CODE, USAGE, close_run, main, parse_issues, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { run_tail_cli }
