#!/usr/bin/env tsx
import { setInterval as every } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { cost_transcript } from '#scripts/cost-runtime/cost-transcript'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { session_cite } from '#scripts/issue/session-cite'
import { cli_flags } from '#scripts/lib/cli-flags'
import { MS_PER_SECOND } from '#scripts/lib/timeouts'
import { lane_capacity } from './lane-capacity'
import { lane_net_read } from './lane-net-read'
import { lane_sampler, type MeasureContext } from './lane-sampler'
import { lane_sinks } from './lane-sinks'
import { lane_stats, type StatsWindow } from './lane-stats'
import { lane_stats_tables, type PeriodRecords } from './lane-stats-tables'
import { lane_transcript_stats } from './lane-transcript-stats'
import { lane_value } from './lane-value'
import { lane_value_cell, type CellAddress } from './lane-value-cell'

// `josh lane:sample` / `josh lane:stats` — the lane-limit measurement; `josh lane:value` and
// `josh lane:net` print one measurement each.
//
// `lane:sample` appends one machine-load sample to the ledger, or one every `--every <seconds>` until it
// is stopped; `lane:stats` reduces a period of the ledger to the one table row #3347 records per lane
// limit, under it the per-stage durations of the period's lanes, and under those how long a stopped
// ship waited for each stop reason. Every entry writes itself during
// a `backlogrun` — the merges, the gates, the stages, and the load `backlog:drive` samples while it
// runs — so a person only closes the period with `lane:stats`; `lane:sample` is for a load reading
// outside one. The procedure is `docs/maintainers/lane-limit-measurement.md`.

const ARGV_OFFSET = 2
const FAILURE_EXIT_CODE = 1
const SAMPLE_VERB = 'sample'
const STATS_VERB = 'stats'
const VALUE_VERB = 'value'
const NET_VERB = 'net'
// `lane:value cell` reads one `lane:stats` table cell rather than a named metric (joshuafolkken/kit#5144).
const CELL_METRIC = 'cell'
// A value keeps two decimals: seconds, minutes and per-lane counts read at that grain.
const VALUE_DIGITS = 2
const USAGE = [
	'Usage: josh lane:sample [--every <seconds>]',
	'       josh lane:stats --period <days> [--limit <lane-limit>]',
	'       josh lane:stats --period <days> --sinks [<minutes>]',
	`       josh lane:value <${lane_value.NAMES.join('|')}> --since <instant>`,
	`       josh lane:value ${CELL_METRIC} --table <title> --row <label> --column <header> --since <instant>`,
	'       josh lane:net <issue>',
].join('\n')

const SAMPLE_OPTIONS = { every: { type: 'string' } } as const
const STATS_OPTIONS = {
	period: { type: 'string' },
	limit: { type: 'string' },
	sinks: { type: 'boolean' },
} as const
const VALUE_OPTIONS = {
	since: { type: 'string' },
	table: { type: 'string' },
	row: { type: 'string' },
	column: { type: 'string' },
} as const

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

// Every lane's transcript directory under this checkout's lane root, read from a lane or the main checkout.
function transcript_directories(context: MeasureContext): ReadonlyArray<string> {
	if (context.transcript_directories !== undefined) return context.transcript_directories

	const main_cwd = cost_transcript.session_cwd(process.cwd())

	return cost_transcript.lane_transcript_directories(main_cwd, cost_transcript.home_directory())
}

// The whole ledger, every run event and the window's lane calls — what the `lane:stats` tables read.
async function period_records(
	context: MeasureContext,
	window: StatsWindow,
): Promise<PeriodRecords> {
	return {
		entries: await lane_net_read.read_ledger(context),
		events: await lane_net_read.read_events(context),
		calls: lane_transcript_stats.read_calls(transcript_directories(context), window),
	}
}

interface StatsRequest {
	period_days: number
	limit: string | undefined
	// The `--sinks` threshold in minutes, `undefined` for the period's row and tables.
	sinks: number | undefined
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
	values: { sinks?: boolean | undefined; limit?: string | undefined },
	positionals: ReadonlyArray<string>,
): { minutes: number | undefined } | undefined {
	if (values.sinks === true) {
		const minutes = sink_threshold(values.limit, positionals)

		return minutes === undefined ? undefined : { minutes }
	}

	return positionals.length === 0 ? { minutes: undefined } : undefined
}

function stats_request(rest: ReadonlyArray<string>): StatsRequest | undefined {
	const parsed = cli_flags.arguments_of(rest, STATS_OPTIONS)

	if (parsed === undefined) return undefined

	const period_days = positive(parsed.values.period)
	const choice = sink_choice(parsed.values, parsed.positionals)

	if (period_days === undefined || choice === undefined) return undefined

	return { period_days, limit: parsed.values.limit, sinks: choice.minutes }
}

// The sinks table reads the ledger and the event stream alone — no lane's transcript (`lane-sinks.ts`).
async function stats_text(
	request: StatsRequest,
	context: MeasureContext,
	window: StatsWindow,
): Promise<string> {
	if (request.sinks !== undefined) {
		const sources = {
			entries: await lane_net_read.read_ledger(context),
			events: await lane_net_read.read_events(context),
		}

		return lane_sinks.table(sources, window, request.sinks)
	}

	const records = await period_records(context, window)
	const label = { limit: await limit_label(request.limit), period_days: request.period_days }
	const row = lane_stats.row(records.entries, window, label)
	const tables = lane_stats_tables.tables_of(records, window)

	return [`${lane_stats.header()}\n${row}`, ...tables].join('\n\n')
}

async function stats_command(
	rest: ReadonlyArray<string>,
	context: MeasureContext,
): Promise<number> {
	const request = stats_request(rest)

	if (request === undefined) return refuse()

	const window = lane_stats.window_of(request.period_days, context.now_ms ?? Date.now())

	console.info(await stats_text(request, context, window))

	return 0
}

interface ValueRequest {
	metric: string
	since_ms: number
	address?: CellAddress
}

interface AddressFlags {
	table?: string | undefined
	row?: string | undefined
	column?: string | undefined
}

function since_of(text = ''): number | undefined {
	const since_ms = Date.parse(text)

	return Number.isNaN(since_ms) ? undefined : since_ms
}

function is_known(name: string): boolean {
	return name === CELL_METRIC || lane_value.is_metric(name)
}

function metric_of(positionals: ReadonlyArray<string>): string | undefined {
	const [name] = positionals

	return name !== undefined && positionals.length === 1 && is_known(name) ? name : undefined
}

function address_of({ table, row, column }: AddressFlags): CellAddress | undefined {
	return table === undefined || row === undefined || column === undefined
		? undefined
		: { table, row, column }
}

function request_of(
	metric: string | undefined,
	since_ms: number | undefined,
): ValueRequest | undefined {
	return metric === undefined || since_ms === undefined ? undefined : { metric, since_ms }
}

// One known metric and a readable `--since` instant — `cell` with its whole address — or `undefined`
// for a refusal.
function value_request(rest: ReadonlyArray<string>): ValueRequest | undefined {
	const parsed = cli_flags.arguments_of(rest, VALUE_OPTIONS)

	if (parsed === undefined) return undefined

	const request = request_of(metric_of(parsed.positionals), since_of(parsed.values.since))

	if (request?.metric !== CELL_METRIC) return request

	const address = address_of(parsed.values)

	return address === undefined ? undefined : { ...request, address }
}

// The value alone on its line, so a measurement declaration reads it as the output's last line; a
// period with no sample prints nothing there and fails, which the drive reads as unreadable.
function print_value(request: ValueRequest, measured: number | undefined): number {
	if (measured === undefined) {
		const since = new Date(request.since_ms).toISOString()

		const missing = request.address === undefined ? 'no sample' : 'no single numeric cell'

		console.error(`josh lane:value ${request.metric}: ${missing} since ${since}`)

		return FAILURE_EXIT_CODE
	}

	console.info(measured.toFixed(VALUE_DIGITS))

	return 0
}

// The addressed cell of the tables `lane:stats` would print for `window`.
async function cell_value(
	address: CellAddress,
	window: StatsWindow,
	context: MeasureContext,
): Promise<number | undefined> {
	const tables = lane_stats_tables.tables_of(await period_records(context, window), window)

	return lane_value_cell.value(tables, address)
}

async function value_command(
	rest: ReadonlyArray<string>,
	context: MeasureContext,
): Promise<number> {
	const request = value_request(rest)

	if (request === undefined) return refuse()

	const window = { since_ms: request.since_ms, until_ms: context.now_ms ?? Date.now() }

	if (request.address !== undefined) {
		return print_value(request, await cell_value(request.address, window, context))
	}

	const records = {
		entries: await lane_net_read.read_ledger(context),
		calls: lane_transcript_stats.read_calls(transcript_directories(context), window),
	}

	return print_value(request, lane_value.value(request.metric, records, window))
}

// The lane's net minutes, whole, alone on the line a causing-lane declaration copies
// (`lane-net-time.ts`); a lane the ledger holds no dispatch and merge of fails.
async function net_command(rest: ReadonlyArray<string>, context: MeasureContext): Promise<number> {
	const [issue = ''] = rest

	if (rest.length !== 1 || !issue_number_shape.is_issue_number(issue)) return refuse()

	const net = await lane_net_read.net_minutes_of(Number(issue), context)

	if (net === undefined) {
		console.error(
			`josh lane:net ${issue}: the ledger holds no dispatch and merge of ${session_cite.issue(issue)}`,
		)

		return FAILURE_EXIT_CODE
	}

	console.info(String(net))

	return 0
}

type VerbCommand = (rest: ReadonlyArray<string>, context: MeasureContext) => Promise<number>

const VERBS: Readonly<Record<string, VerbCommand>> = {
	[SAMPLE_VERB]: sample_command,
	[STATS_VERB]: stats_command,
	[VALUE_VERB]: value_command,
	[NET_VERB]: net_command,
}

async function run(argv: ReadonlyArray<string>, context: MeasureContext = {}): Promise<number> {
	const [verb = '', ...rest] = argv
	const command = Object.hasOwn(VERBS, verb) ? VERBS[verb] : undefined

	return command === undefined ? refuse() : await command(rest, context)
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
