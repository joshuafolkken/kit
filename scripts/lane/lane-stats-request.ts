import { cli_flags } from '#scripts/lib/cli-flags'
import { lane_sinks } from './lane-sinks'

// The `josh lane:stats` flags read into one request (`lane-measure-cli.ts`): the period, and which one
// table — `--sinks`, `--over` or `--pairs` — replaces the period's row and tables.

const STATS_OPTIONS = {
	period: { type: 'string' },
	since: { type: 'string' },
	limit: { type: 'string' },
	sinks: { type: 'boolean' },
	over: { type: 'string' },
	why: { type: 'string' },
	pairs: { type: 'boolean' },
} as const

interface StatsFlags {
	limit?: string | undefined
	sinks?: boolean | undefined
	over?: string | undefined
	why?: string | undefined
	pairs?: boolean | undefined
}

// Where the window opens: `--period <days>` before now, or the `--since <instant>` itself
// (joshuafolkken/kit#7007).
type StatsStart = { period_days: number } | { since_ms: number }

interface StartFlags {
	period?: string | undefined
	since?: string | undefined
}

interface StatsRequest {
	start: StatsStart
	limit: string | undefined
	// The `--sinks` threshold in minutes, `undefined` for the period's row and tables.
	sinks: number | undefined
	// The `--over` threshold in minutes, `undefined` without the flag.
	over: number | undefined
	why: number | undefined
	// `--pairs`: the scoped pair table (`lane-pairs.ts`).
	is_pairs: boolean
}

// A positive finite number, or `undefined` for anything else — a typo must not become a zero period.
function positive(text: string | undefined): number | undefined {
	const value = Number(text)

	return text !== undefined && Number.isFinite(value) && value > 0 ? value : undefined
}

// An ISO 8601 instant in epoch milliseconds, `undefined` for one `Date.parse` cannot read.
function since_of(text = ''): number | undefined {
	const since_ms = Date.parse(text)

	return Number.isNaN(since_ms) ? undefined : since_ms
}

function since_start(text: string): StatsStart | undefined {
	const since_ms = since_of(text)

	return since_ms === undefined ? undefined : { since_ms }
}

// Exactly one of `--period` and `--since`; both, neither or an unreadable value refuses the request.
function start_of(values: StartFlags): StatsStart | undefined {
	if (values.since !== undefined) {
		return values.period === undefined ? since_start(values.since) : undefined
	}

	const period_days = positive(values.period)

	return period_days === undefined ? undefined : { period_days }
}

// The sinks table labels no lane limit, so `--limit` beside `--sinks` is refused.
function sink_threshold(
	limit: string | undefined,
	positionals: ReadonlyArray<string>,
): number | undefined {
	const [given, ...more] = positionals

	if (limit !== undefined) return undefined

	if (given === undefined) return lane_sinks.DEFAULT_MINUTES

	return more.length === 0 ? positive(given) : undefined
}

// `--sinks` reads one optional threshold after it; without the flag a positional is refused.
function sink_choice(
	values: StatsFlags,
	positionals: ReadonlyArray<string>,
): { minutes: number | undefined } | undefined {
	if (values.sinks === true) {
		const minutes = sink_threshold(values.limit, positionals)

		return minutes === undefined ? undefined : { minutes }
	}

	return positionals.length === 0 ? { minutes: undefined } : undefined
}

// A missing threshold selects no table; an invalid one refuses the request.
function threshold_choice(text: string | undefined): { minutes: number | undefined } | undefined {
	if (text === undefined) return { minutes: undefined }

	const minutes = positive(text)

	return minutes === undefined ? undefined : { minutes }
}

// Each alternate table is exclusive and carries no lane-limit label.
function is_one_table(values: StatsFlags): boolean {
	const selected = [
		values.sinks === true,
		values.over !== undefined,
		values.why !== undefined,
		values.pairs === true,
	].filter(Boolean).length

	return selected <= 1 && (selected === 0 || values.limit === undefined)
}

// The one table the flags choose, `undefined` for a refused combination.
function table_flags(
	values: StatsFlags,
	positionals: ReadonlyArray<string>,
): Pick<StatsRequest, 'sinks' | 'over' | 'why' | 'is_pairs'> | undefined {
	const choice = sink_choice(values, positionals)
	const over = threshold_choice(values.over)
	const why = threshold_choice(values.why)

	if (choice === undefined || over === undefined || why === undefined || !is_one_table(values)) {
		return undefined
	}

	return {
		sinks: choice.minutes,
		over: over.minutes,
		why: why.minutes,
		is_pairs: values.pairs === true,
	}
}

function stats_request(rest: ReadonlyArray<string>): StatsRequest | undefined {
	const parsed = cli_flags.arguments_of(rest, STATS_OPTIONS)

	if (parsed === undefined) return undefined

	const start = start_of(parsed.values)
	const table = table_flags(parsed.values, parsed.positionals)

	if (start === undefined || table === undefined) return undefined

	return { start, limit: parsed.values.limit, ...table }
}

const lane_stats_request = { positive, since_of, stats_request }

export { lane_stats_request }
export type { StatsRequest, StatsStart }
