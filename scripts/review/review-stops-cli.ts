#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { session_cite } from '#scripts/issue/session-cite'
import { lane_stats } from '#scripts/lane/lane-stats'
import { cli_flags } from '#scripts/lib/cli-flags'
import { review_stop_log, type StopLine } from './review-stop-log'

// `josh review:stops [--period <days>]` — every review finding that stopped a `josh ship` in the last
// `<days>` (7 by default), one line each, ordered by kind and then file so the findings of one kind and
// one place sit together for classification (joshuafolkken/kit#4519). The write half is
// `review-stop-log.ts`, called on every ship stop.

const OPTIONS = { period: { type: 'string' } } as const
const DEFAULT_PERIOD_DAYS = 7
const USAGE = 'usage: josh review:stops [--period <days>]'
const NO_SENTENCE = '(no sentence)'
const DATE_LENGTH = 10
// `process.argv` holds the runtime and the script before the command's own arguments.
const FIRST_ARGUMENT = 2

interface StopsContext {
	log_path?: string | undefined
	now_ms?: number
}

// An unknown flag or a period that is not a positive whole number of days is refused, never defaulted.
function period_of(argv: ReadonlyArray<string>): number | undefined {
	const values = cli_flags.values_of(argv, OPTIONS)

	if (values === undefined) return undefined

	return cli_flags.to_positive(values.period ?? String(DEFAULT_PERIOD_DAYS))
}

function compare(left: StopLine, right: StopLine): number {
	const by_kind = left.kind.localeCompare(right.kind)

	if (by_kind !== 0) return by_kind

	return left.location.localeCompare(right.location) || left.at.localeCompare(right.at)
}

function line_of(stop: StopLine): string {
	const sentence = stop.sentence === '' ? NO_SENTENCE : stop.sentence
	const where = `${session_cite.issue(stop.issue)} ${stop.stage} ${stop.at.slice(0, DATE_LENGTH)}`

	return `${stop.kind}  ${stop.location}  ${where} — ${sentence}`
}

function format_report(stops: ReadonlyArray<StopLine>, period_days: number): string {
	const period = `the last ${String(period_days)} day(s)`

	if (stops.length === 0) return `no review stop findings recorded in ${period}`

	const body = stops.toSorted(compare).map((stop) => line_of(stop))

	return [`review stop findings in ${period} (${String(stops.length)}):`, ...body].join('\n')
}

function run(argv: ReadonlyArray<string>, context: StopsContext = {}): number {
	const period_days = period_of(argv)

	if (period_days === undefined) {
		console.error(USAGE)

		return 1
	}

	const window = lane_stats.window_of(period_days, context.now_ms ?? Date.now())
	const stopped = review_stop_log.read(context.log_path).filter((line) => line.fixed !== true)
	const stops = lane_stats.in_window(stopped, window)

	console.info(format_report(stops, period_days))

	return 0
}

function main(): void {
	process.exitCode = run(process.argv.slice(FIRST_ARGUMENT))
}

const review_stops_cli = { format_report, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) main()

export { review_stops_cli }
