#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { josh_command } from '#scripts/josh/josh-run'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { run_tail, type TailSection } from './run-tail'

// `josh run:tail [<N> ...]` — one call for the fixed post-merge sequence a run closes on.
// It runs `observations:flush`, `issue:cite` and `release:scope` internally, so no round trip per step
// re-bills a lane's full context, and prints one composite report, the same way
// `backlog:offer` chains its two calls and `run:prep` bundles three reads. Each
// step's stderr is forwarded, so the reader still sees every explanation the three would have
// printed on their own.
//
// The issue numbers are the completion's citations — the closed issue and any follow-ups filed this run
// — and go to `issue:cite`; the other two take none. A `run:tail` with no numbers still closes the run,
// because `issue:cite` with no target exits zero.
//
// **A dispatched lane child skips the ledger step**. A flush opens a
// ledger-only pull request and waits out its whole CI before it merges — minutes per issue, spent on a
// file only the retrospective and the measurements read — and a lane has nothing for it: its lines
// merged with its own pull request. A single run outside a lane keeps the
// step for a line written on the default branch outside any issue's run.

const ARGV_OFFSET = 2
const FAILURE_EXIT_CODE = 1
const USAGE = 'Usage: josh run:tail [<issue-number> ...]'
const should_forward_stderr = true

interface Step {
	header: string
	argv: (issues: ReadonlyArray<string>) => ReadonlyArray<string>
}

// The steps in the order a run closes on: the checkout returns to the default branch, any ledger line
// the run's own commit did not carry is committed so the recurrence count is on
// main — on most runs the flush answers `clean` — the citations are read for the completion report, and
// the release scope is decided last.
//
// **The return comes first because the flush refuses anywhere else**. A run closes right
// after its merge, still on the feature branch it shipped from, and `josh ship` reaches this report
// with nothing in between. `main:sync` fast-forwards the local default branch before the
// checkout, so a ledger line appended after the merge is carried along rather than refused.
const LEDGER_STEPS: ReadonlyArray<Step> = [
	{ header: run_tail.SYNC_HEADER, argv: () => ['main:sync'] },
	{ header: run_tail.OBSERVATIONS_HEADER, argv: () => ['observations:flush'] },
]
const REPORT_STEPS: ReadonlyArray<Step> = [
	{ header: run_tail.CITATIONS_HEADER, argv: (issues) => ['issue:cite', ...issues] },
	{ header: run_tail.RELEASE_HEADER, argv: () => ['release:scope'] },
]

function steps_for(is_lane_child: boolean): ReadonlyArray<Step> {
	return is_lane_child ? REPORT_STEPS : [...LEDGER_STEPS, ...REPORT_STEPS]
}

// Numbers only — a target `issue:cite` reads as an issue, so a stray flag is refused rather than
// forwarded to the wrong step.
function parse_issues(argv: ReadonlyArray<string>): ReadonlyArray<string> | undefined {
	if (argv.every((token) => issue_number_shape.is_issue_number(token))) return argv

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

// Run the steps in order, not concurrently: the ledger commit must land on main before the release scope
// reads main's pending count.
async function close_run(issues: ReadonlyArray<string>): Promise<ReadonlyArray<TailSection>> {
	const sections: Array<TailSection> = []

	const is_lane_child = lane_child_marker.is_child_of(process.cwd())

	// eslint-disable-next-line no-await-in-loop -- the tail steps run in their declared order
	for (const step of steps_for(is_lane_child)) sections.push(await run_step(step, issues))

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

const run_tail_cli = { run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { run_tail_cli }
