#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { session_cite } from '#scripts/issue/session-cite'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { lane_breakdown } from './lane-breakdown'
import { lane_breakdown_estimate } from './lane-breakdown-estimate'
import { lane_breakdown_implement } from './lane-breakdown-implement'
import { lane_breakdown_text } from './lane-breakdown-text'
import { lane_cut_stats } from './lane-cut-stats'
import { lane_ledger_archive } from './lane-ledger-archive'
import { lane_net_time } from './lane-net-time'
import { lane_sinks, type SinkRecords } from './lane-sinks'

// `josh lane:breakdown <issue>` — a merged lane's net time by stage (joshuafolkken/kit#4995), the same
// breakdown its overrun investigation comments on its Issue.

const ARGV_OFFSET = 2
const FAILURE_EXIT_CODE = 1
const USAGE = 'Usage: josh lane:breakdown <issue>'
const TOP_SINKS = 3

function sinks_line(records: SinkRecords, issue: number): string {
	const sinks = lane_sinks.sinks_of(records, [issue]).slice(0, TOP_SINKS)
	const parts = sinks.map(
		(sink) => `${sink.name} ${lane_breakdown.minutes_text(lane_sinks.total_ms(sink))}`,
	)

	return `- Largest time sinks (stages and laps overlap): ${parts.join('; ')}`
}

function cut_lines(events: ReadonlyArray<RunEvent>, issue: number): ReadonlyArray<string> {
	const cuts = lane_cut_stats.line(events, issue)

	return cuts === undefined ? [] : [`- ${cuts}`]
}

function missing(issue: string): number {
	const lane = session_cite.issue(issue)

	console.error(`josh lane:breakdown ${issue}: the ledger holds no dispatch and merge of ${lane}`)

	return FAILURE_EXIT_CODE
}

async function print(issue: string): Promise<number> {
	const timeline = await lane_breakdown_estimate.read(
		await lane_ledger_archive.read_history({}),
		await run_event_stream_emit.all_events(),
		Number(issue),
	)
	if (timeline === undefined) return missing(issue)
	const { entries, events, notice } = timeline
	const minutes = lane_net_time.net_minutes(entries, events, Number(issue))
	const breakdown = lane_breakdown_implement.breakdown_of(entries, events, Number(issue))

	if (minutes === undefined || breakdown === undefined) return missing(issue)

	const report = lane_breakdown_text.report_of(Number(issue), breakdown, entries)

	console.info(
		[
			notice,
			lane_breakdown_text.comment(Number(issue), minutes, report),
			sinks_line({ entries, events }, Number(issue)),
			...cut_lines(events, Number(issue)),
		]
			.filter((line) => line !== '')
			.join('\n'),
	)

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
