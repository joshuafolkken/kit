#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { issue_priority, type PriorityLevel } from '#scripts/issue/issue-priority'
import { cli_flags } from '#scripts/lib/cli-flags'
import {
	run_event_overrun,
	type KeyedLoss,
	type SmallCause,
} from '#scripts/run/event/run-event-overrun'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { lane_ledger, type LedgerEntry } from './lane-ledger'
import type { MeasureContext } from './lane-sampler'
import { lane_stats, type StatsWindow } from './lane-stats'

// `josh overrun:mechanisms [--period <days>]` — the causes overrun investigations left unfiled as under
// the high share, summed per mechanism key across the period's lanes (joshuafolkken/kit#4886): one lane's
// few minutes are under the share, but a mechanism losing them in every lane is not. Each key's sum is
// divided by the period's merges and their median lane time, and judged by the floor an Issue's stated
// reduction per merge is (`issue_priority.percent_floor`).

const OPTIONS = { period: { type: 'string' }, since: { type: 'string' } } as const
const DEFAULT_PERIOD_DAYS = 7
const USAGE = 'usage: josh overrun:mechanisms [--period <days>] [--since <instant>]'
const ARGV_OFFSET = 2
const PERCENT = 100
const DECIMALS = 1
const MISSING = '—'
const VERDICTS: Record<PriorityLevel, string> = {
	normal: `under ${String(issue_priority.HIGH_PERCENT)}%`,
	high: 'file',
	critical: 'file (urgent)',
}

// What a per-merge share divides by: the period's merges and their median lane minutes.
interface MergeBase {
	merges: number
	median_minutes: number | undefined
}

interface Request {
	window: StatsWindow
	label: string
}

interface PeriodRecords {
	entries: ReadonlyArray<LedgerEntry>
	events: ReadonlyArray<RunEvent>
}

function causes_of(event: RunEvent): ReadonlyArray<SmallCause> {
	if (event.kind !== run_event_stream.EVENT_KIND.NOTE) return []

	const note = run_event_overrun.parse(event.text)

	return note?.kind === 'ended' ? run_event_overrun.small_causes_of(note.result) : []
}

// The period's keyed causes summed per key, the largest loss first.
function losses_of(events: ReadonlyArray<RunEvent>): Array<KeyedLoss> {
	return run_event_overrun.sum_by_key(events.flatMap((event) => causes_of(event)))
}

// The loss per merge as a share of the median lane time, else `undefined` with no merge to divide by.
function share_of(loss: KeyedLoss, base: MergeBase): number | undefined {
	if (base.merges === 0 || base.median_minutes === undefined) return undefined

	return (loss.minutes / base.merges / base.median_minutes) * PERCENT
}

function cell(value: number | undefined, unit: string): string {
	return value === undefined ? MISSING : `${value.toFixed(DECIMALS)}${unit}`
}

function line_of(loss: KeyedLoss, base: MergeBase): string {
	const share = share_of(loss, base)
	const per_merge = base.merges === 0 ? undefined : loss.minutes / base.merges
	const total = `${cell(loss.minutes, ' min')} over ${String(loss.causes)} cause(s)`
	// With no merge to divide by there is no share, so no verdict either.
	const verdict = share === undefined ? MISSING : VERDICTS[issue_priority.percent_floor(share)]

	return `${loss.key}  ${total} · ${cell(per_merge, ' min/merge')} · ${cell(share, '%')} — ${verdict}`
}

// The report over `window`, named by `label`: `entries` is the whole ledger, since a lane may start
// before the window. The head prints even with no cause, since an investigation divides by it.
function report({ entries, events }: PeriodRecords, window: StatsWindow, label: string): string {
	const merge_minutes = lane_stats.merge_minutes(entries, lane_stats.in_window(entries, window))
	const base = { merges: merge_minutes.length, median_minutes: lane_stats.median(merge_minutes) }
	const losses = losses_of(lane_stats.in_window(events, window))
	const median = cell(base.median_minutes, ' min')
	const head = `overrun mechanisms in ${label}: ${String(base.merges)} merge(s), median lane ${median}`

	if (losses.length === 0) return `${head}\nno keyed small overrun causes recorded`

	return [head, ...losses.map((loss) => line_of(loss, base))].join('\n')
}

async function read_records(context: MeasureContext): Promise<PeriodRecords> {
	const ledger_path = context.ledger_path ?? (await lane_ledger.target())
	const entries = ledger_path === undefined ? [] : lane_ledger.read_entries(ledger_path)
	const events =
		context.events_path === undefined
			? await run_event_stream_emit.all_events()
			: run_event_stream.read_events(context.events_path)

	return { entries, events }
}

// The period's window, cut to start at `since_ms` when that is later — the close of the issue that
// fixed a mechanism, whose earlier losses its fix removed.
function request_window(
	period_days: number,
	since_ms: number | undefined,
	now_ms: number,
): Request {
	const window = lane_stats.window_of(period_days, now_ms)
	const label = `the last ${String(period_days)} day(s)`

	if (since_ms === undefined || since_ms <= window.since_ms) return { window, label }

	return {
		window: { ...window, since_ms },
		label: `${label} since ${new Date(since_ms).toISOString()}`,
	}
}

function since_of(text: string | undefined): number | undefined {
	return text === undefined ? undefined : Date.parse(text)
}

// An unknown flag, a period that is not a positive whole number of days or an unreadable instant is
// refused, never defaulted.
function request_of(argv: ReadonlyArray<string>, now_ms: number): Request | undefined {
	const values = cli_flags.values_of(argv, OPTIONS)

	if (values === undefined) return undefined

	const period_days = cli_flags.to_positive(values.period ?? String(DEFAULT_PERIOD_DAYS))
	const since_ms = since_of(values.since)

	if (period_days === undefined || Number.isNaN(since_ms)) return undefined

	return request_window(period_days, since_ms, now_ms)
}

async function run(argv: ReadonlyArray<string>, context: MeasureContext = {}): Promise<number> {
	const request = request_of(argv, context.now_ms ?? Date.now())

	if (request === undefined) {
		console.error(USAGE)

		return 1
	}

	console.info(report(await read_records(context), request.window, request.label))

	return 0
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const lane_overrun_mechanisms_cli = { losses_of, report, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { lane_overrun_mechanisms_cli }
