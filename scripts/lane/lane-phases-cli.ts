#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { lane_ledger, type LedgerEntry } from './lane-ledger'
import { lane_ledger_tail } from './lane-ledger-tail'
import { lane_phases, type Span } from './lane-phases'
import { lane_stats_request } from './lane-stats-request'

// `josh lane:phases <issue>... | --since <date> [--until <date>]` — the lanes' median minutes by phase
// (joshuafolkken/kit#8287). A period reads the ledger's window backward (`read_since`), so the ledger
// older than it never lands in memory; named Issues keep only their own entries (`tail_store`).

const ARGV_OFFSET = 2
const FAILURE_EXIT_CODE = 1
const SINCE_FLAG = '--since'
const UNTIL_FLAG = '--until'
const USAGE = `Usage: josh lane:phases <issue>... | ${SINCE_FLAG} <date> [${UNTIL_FLAG} <date>]`
const ISSUE_LEAD = /^#/u
const SINCE_ONLY_ARGS = 2
const SINCE_UNTIL_ARGS = 4
// A lane merged just after `--since` was dispatched before it: the window reads back this far further.
const LEAD_MINUTES = 1440
const LEAD_MS = LEAD_MINUTES * MS_PER_MINUTE

type Request = { readonly issues: ReadonlyArray<number> } | { readonly span: Span }

interface Source {
	readonly ledger_path: () => Promise<string | undefined>
	readonly events: () => Promise<ReadonlyArray<RunEvent>>
	readonly now_ms: () => number
}

const DEFAULT_SOURCE: Source = {
	ledger_path: lane_ledger.target,
	events: async () => await run_event_stream_emit.all_events(),
	now_ms: Date.now,
}

function issues_of(argv: ReadonlyArray<string>): Request | undefined {
	const numbers = argv.map((argument) => argument.replace(ISSUE_LEAD, ''))
	const is_valid = numbers.every((number) => issue_number_shape.is_issue_number(number))

	return is_valid && numbers.length > 0 ? { issues: numbers.map(Number) } : undefined
}

function until_of(argv: ReadonlyArray<string>, now_ms: number): number | undefined {
	if (argv.length === SINCE_ONLY_ARGS) return now_ms
	const [flag, until] = argv.slice(SINCE_ONLY_ARGS)
	const is_until = flag === UNTIL_FLAG

	return is_until && argv.length === SINCE_UNTIL_ARGS
		? lane_stats_request.since_of(until)
		: undefined
}

function period_of(argv: ReadonlyArray<string>, now_ms: number): Request | undefined {
	const [flag, since] = argv
	const from_ms = lane_stats_request.since_of(since)
	const to_ms = until_of(argv, now_ms)

	if (flag !== SINCE_FLAG || from_ms === undefined || to_ms === undefined) return undefined

	return { span: { from_ms, to_ms } }
}

function request_of(argv: ReadonlyArray<string>, now_ms: number): Request | undefined {
	return argv[0] === SINCE_FLAG ? period_of(argv, now_ms) : issues_of(argv)
}

function has_issue(wanted: ReadonlySet<number>, entry: LedgerEntry): boolean {
	return 'issue' in entry && typeof entry.issue === 'number' && wanted.has(entry.issue)
}

function entries_of(request: Request, path: string): ReadonlyArray<LedgerEntry> {
	if ('span' in request) {
		return lane_ledger_tail.read_since(path, request.span.from_ms - LEAD_MS).entries
	}

	const wanted = new Set(request.issues)

	return lane_ledger.tail_store((entry) => has_issue(wanted, entry)).read(path)
}

function failed(message: string): number {
	console.error(message)

	return FAILURE_EXIT_CODE
}

async function report(request: Request, source: Source): Promise<number> {
	const path = await source.ledger_path()
	if (path === undefined) return failed('josh lane:phases: no lane ledger for this repository')
	const entries = entries_of(request, path)
	const issues = 'span' in request ? lane_phases.merged_in(entries, request.span) : request.issues
	const events = await source.events()
	const samples = issues.flatMap((issue) => lane_phases.phases_of(entries, events, issue))

	console.info(lane_phases.text(lane_phases.rows_of(samples), issues.length))

	return 0
}

async function run(argv: ReadonlyArray<string>, source: Source = DEFAULT_SOURCE): Promise<number> {
	const request = request_of(argv, source.now_ms())

	return request === undefined ? failed(USAGE) : await report(request, source)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const lane_phases_cli = { USAGE, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { lane_phases_cli }
export type { Source }
