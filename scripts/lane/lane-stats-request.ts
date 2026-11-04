import { cli_flags } from '#scripts/lib/cli-flags'
import { lane_sinks } from './lane-sinks'

// The `josh lane:stats` flags read into one request (`lane-measure-cli.ts`): the period, and which one
// table — `--sinks`, `--over` or `--pairs` — replaces the period's row and tables.

const STATS_OPTIONS = {
	period: { type: 'string' },
	limit: { type: 'string' },
	sinks: { type: 'boolean' },
	over: { type: 'string' },
	pairs: { type: 'boolean' },
} as const

interface StatsFlags {
	limit?: string | undefined
	sinks?: boolean | undefined
	over?: string | undefined
	pairs?: boolean | undefined
}

interface StatsRequest {
	period_days: number
	limit: string | undefined
	// The `--sinks` threshold in minutes, `undefined` for the period's row and tables.
	sinks: number | undefined
	// The `--over` threshold in minutes, `undefined` without the flag.
	over: number | undefined
	// `--pairs`: the scoped pair table (`lane-pairs.ts`).
	is_pairs: boolean
}

// A positive finite number, or `undefined` for anything else — a typo must not become a zero period.
function positive(text: string | undefined): number | undefined {
	const value = Number(text)

	return text !== undefined && Number.isFinite(value) && value > 0 ? value : undefined
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

// `--over` reads a positive threshold and labels no lane limit nor sink, so either beside it is refused.
function over_choice(values: StatsFlags): { minutes: number | undefined } | undefined {
	if (values.over === undefined) return { minutes: undefined }

	const minutes = positive(values.over)
	const is_alone = values.sinks !== true && values.limit === undefined

	return minutes === undefined || !is_alone ? undefined : { minutes }
}

// `--pairs` labels no lane limit and reads no threshold, so any of them beside it is refused.
function is_pairs_alone(values: StatsFlags): boolean {
	if (values.pairs !== true) return true

	return values.limit === undefined && values.sinks !== true && values.over === undefined
}

// The one table the flags choose, `undefined` for a refused combination.
function table_flags(
	values: StatsFlags,
	positionals: ReadonlyArray<string>,
): Pick<StatsRequest, 'sinks' | 'over' | 'is_pairs'> | undefined {
	const choice = sink_choice(values, positionals)
	const over = over_choice(values)

	if (choice === undefined || over === undefined || !is_pairs_alone(values)) return undefined

	return { sinks: choice.minutes, over: over.minutes, is_pairs: values.pairs === true }
}

function stats_request(rest: ReadonlyArray<string>): StatsRequest | undefined {
	const parsed = cli_flags.arguments_of(rest, STATS_OPTIONS)

	if (parsed === undefined) return undefined

	const period_days = positive(parsed.values.period)
	const table = table_flags(parsed.values, parsed.positionals)

	if (period_days === undefined || table === undefined) return undefined

	return { period_days, limit: parsed.values.limit, ...table }
}

const lane_stats_request = { positive, stats_request }

export { lane_stats_request }
export type { StatsRequest }
