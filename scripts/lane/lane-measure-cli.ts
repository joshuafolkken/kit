#!/usr/bin/env tsx
import { setInterval as every } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { cli_flags } from '#scripts/lib/cli-flags'
import { lane_capacity } from './lane-capacity'
import { lane_ledger } from './lane-ledger'
import { lane_sampler, type MeasureContext } from './lane-sampler'
import { lane_stage_stats } from './lane-stage-stats'
import { lane_stats } from './lane-stats'

// `josh lane:sample` / `josh lane:stats` — the lane-limit measurement.
//
// `lane:sample` appends one machine-load sample to the ledger, or one every `--every <seconds>` until it
// is stopped; `lane:stats` reduces a period of the ledger to the one table row #3347 records per lane
// limit, and under it the per-stage durations of the period's lanes. Every entry writes itself during
// a `backlogrun` — the merges, the gates, the stages, and the load `backlog:drive` samples while it
// runs — so a person only closes the period with `lane:stats`; `lane:sample` is for a load reading
// outside one. The procedure is `docs/maintainers/lane-limit-measurement.md`.

const ARGV_OFFSET = 2
const FAILURE_EXIT_CODE = 1
const MS_PER_SECOND = 1000
const SAMPLE_VERB = 'sample'
const STATS_VERB = 'stats'
const USAGE = [
	'Usage: josh lane:sample [--every <seconds>]',
	'       josh lane:stats --period <days> [--limit <lane-limit>]',
].join('\n')

const SAMPLE_OPTIONS = { every: { type: 'string' } } as const
const STATS_OPTIONS = { period: { type: 'string' }, limit: { type: 'string' } } as const

function refuse(): number {
	console.error(USAGE)

	return FAILURE_EXIT_CODE
}

// A positive finite number, or `undefined` for anything else — a typo must not become a zero period.
function positive(text: string | undefined): number | undefined {
	const value = Number(text)

	return text !== undefined && Number.isFinite(value) && value > 0 ? value : undefined
}

// The `--every` interval: `{ seconds: undefined }` for a single sample, `undefined` for a refusal.
function sample_interval(rest: ReadonlyArray<string>): { seconds: number | undefined } | undefined {
	const values = cli_flags.values_of(rest, SAMPLE_OPTIONS)

	if (values === undefined) return undefined

	if (values.every === undefined) return { seconds: undefined }

	const seconds = positive(values.every)

	return seconds === undefined ? undefined : { seconds }
}

// A sample every `seconds` until a person stops the process, which is how a measurement period is held
// open; it never returns.
async function keep_sampling(context: MeasureContext, seconds: number): Promise<void> {
	const ticks = every(seconds * MS_PER_SECOND, context)

	for await (const tick_context of ticks) await lane_sampler.take(tick_context)
}

// One sample now, then — with `--every` — one per interval.
async function sample_command(
	rest: ReadonlyArray<string>,
	context: MeasureContext,
): Promise<number> {
	const interval = sample_interval(rest)

	if (interval === undefined) return refuse()

	await lane_sampler.take(context)

	if (interval.seconds !== undefined) await keep_sampling(context, interval.seconds)

	return 0
}

// The label defaults to the limit this process reads, which is the period's limit only when nobody
// changed it since — `--limit` names it outright.
async function limit_label(given: string | undefined): Promise<string> {
	if (given !== undefined) return given

	const choice = await lane_capacity.lane_limit()

	return choice.kind === 'limit' ? String(choice.limit) : lane_stats.MISSING
}

async function read_ledger(
	context: MeasureContext,
): Promise<ReturnType<typeof lane_ledger.read_entries>> {
	const path = context.ledger_path ?? (await lane_ledger.target())

	return path === undefined ? [] : lane_ledger.read_entries(path)
}

async function stats_command(
	rest: ReadonlyArray<string>,
	context: MeasureContext,
): Promise<number> {
	const values = cli_flags.values_of(rest, STATS_OPTIONS)
	const period_days = positive(values?.period)

	if (values === undefined || period_days === undefined) return refuse()

	const window = lane_stats.window_of(period_days, context.now_ms ?? Date.now())
	const label = { limit: await limit_label(values.limit), period_days }
	const entries = await read_ledger(context)
	const row = lane_stats.row(entries, window, label)

	console.info(`${lane_stats.header()}\n${row}\n\n${lane_stage_stats.table(entries, window)}`)

	return 0
}

async function run(argv: ReadonlyArray<string>, context: MeasureContext = {}): Promise<number> {
	const [verb, ...rest] = argv

	if (verb === SAMPLE_VERB) return await sample_command(rest, context)

	return verb === STATS_VERB ? await stats_command(rest, context) : refuse()
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const lane_measure_cli = {
	USAGE,
	run,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { lane_measure_cli }
