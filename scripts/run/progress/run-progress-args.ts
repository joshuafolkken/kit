import { cli_flags } from '#scripts/lib/cli-flags'
import { run_progress_config } from './run-progress-config'

// The argument half of `josh run:progress`, kept apart from the watcher so the CLI stays inside the file
// limit. Everything here is pure: argv in, values out.

// A watcher outlives the turn that started it, so something has to end it. One hour is three of the
// default twenty-minute intervals: long enough that the bound never truncates a report, short enough
// that a watcher left waiting on a run that has already merged is gone within the hour. It is
// deliberately **not** `run:hold`'s eight-hour expiry — that holds an uncommitted working tree across
// a person's latency and is trampled by being short, while a watcher holds
// only a heartbeat the caller restarts on the next interval, so the two guard different things and
// only one has anything to lose by being short.
const DEFAULT_MAX_HOURS = 1
// **`--wait` is bounded by a run, not by three intervals.** It does not exit at
// its first report — the reports go to the event stream — so its one-hour bound would be the last
// wake that asks the parent for no judgement, a restart an hour. Eight hours is `run:hold`'s expiry;
// what ends a finished run's watcher sooner is `josh followup` removing its life record, and a stop
// tearing it down in the same turn.
const DEFAULT_WAIT_MAX_HOURS = 8
const MS_PER_HOUR = 3_600_000

const OPTIONS = {
	hours: { type: 'string' },
	interval: { type: 'string' },
	mark: { type: 'boolean' },
	once: { type: 'boolean' },
	output: { type: 'string', multiple: true },
	path: { type: 'boolean' },
	repo: { type: 'string' },
	wait: { type: 'boolean' },
} as const

interface ParsedValues {
	hours?: string
	interval?: string
	mark?: boolean
	once?: boolean
	output?: Array<string>
	path?: boolean
	repo?: string
	wait?: boolean
}

function read_arguments(argv: ReadonlyArray<string>): ParsedValues | undefined {
	return cli_flags.values_of(argv, OPTIONS)
}

// A hand-typed `--interval` outranks the environment, the environment outranks the interval the
// repository commits, and that outranks the twenty-minute default. Every step goes through the same
// reader, so an unusable value falls back rather than ending an unattended run over an optional
// setting — `run-progress-config.ts` → `resolve_interval_ms` is where that order is written down.
function to_interval_ms(raw: string | undefined): number {
	return run_progress_config.resolve_interval_ms(raw)
}

function default_hours(is_wait: boolean): number {
	return is_wait ? DEFAULT_WAIT_MAX_HOURS : DEFAULT_MAX_HOURS
}

function to_max_ms(raw: string | undefined, is_wait = false): number {
	const hours = Number(raw)
	const is_usable = raw !== undefined && Number.isFinite(hours) && hours > 0

	return (is_usable ? hours : default_hours(is_wait)) * MS_PER_HOUR
}

const run_progress_args = {
	DEFAULT_MAX_HOURS,
	DEFAULT_WAIT_MAX_HOURS,
	read_arguments,
	to_interval_ms,
	to_max_ms,
}

export type { ParsedValues }
export { run_progress_args }
