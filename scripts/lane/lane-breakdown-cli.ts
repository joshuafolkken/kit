#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { session_cite } from '#scripts/issue/session-cite'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { lane_breakdown } from './lane-breakdown'
import { lane_breakdown_text } from './lane-breakdown-text'
import { lane_ledger } from './lane-ledger'
import { lane_net_time } from './lane-net-time'

// `josh lane:breakdown <issue>` — a merged lane's net time by stage (joshuafolkken/kit#4995), the same
// breakdown its overrun investigation comments on its Issue.

const ARGV_OFFSET = 2
const FAILURE_EXIT_CODE = 1
const USAGE = 'Usage: josh lane:breakdown <issue>'

async function read_ledger(): Promise<ReturnType<typeof lane_ledger.read_entries>> {
	const path = await lane_ledger.target()

	return path === undefined ? [] : lane_ledger.read_entries(path)
}

function missing(issue: string): number {
	const lane = session_cite.issue(issue)

	console.error(`josh lane:breakdown ${issue}: the ledger holds no dispatch and merge of ${lane}`)

	return FAILURE_EXIT_CODE
}

async function print(issue: string): Promise<number> {
	const [entries, events] = [await read_ledger(), await run_event_stream_emit.all_events()]
	const minutes = lane_net_time.net_minutes(entries, events, Number(issue))
	const breakdown = lane_breakdown.of(entries, events, Number(issue))

	if (minutes === undefined || breakdown === undefined) return missing(issue)

	const report = lane_breakdown_text.report_of(Number(issue), breakdown)

	console.info(lane_breakdown_text.comment(Number(issue), minutes, report))

	return 0
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const [issue = ''] = argv

	if (argv.length === 1 && issue_number_shape.is_issue_number(issue)) return await print(issue)

	console.error(USAGE)

	return FAILURE_EXIT_CODE
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const lane_breakdown_cli = { USAGE, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { lane_breakdown_cli }
