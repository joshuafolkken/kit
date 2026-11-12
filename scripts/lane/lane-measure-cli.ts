#!/usr/bin/env tsx
import { setInterval as every } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { cost_transcript } from '#scripts/cost-runtime/cost-transcript'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { session_cite } from '#scripts/issue/session-cite'
import { cli_flags } from '#scripts/lib/cli-flags'
import { MS_PER_SECOND } from '#scripts/lib/timeouts'
import { lane_ledger_archive } from './lane-ledger-archive'
import { lane_limit_history } from './lane-limit-history'
import { lane_net_read } from './lane-net-read'
import { lane_over_causes } from './lane-over-causes'
import { lane_pairs } from './lane-pairs'
import { lane_sampler, type MeasureContext } from './lane-sampler'
import { lane_sinks } from './lane-sinks'
import { lane_sinks_issues } from './lane-sinks-issues'
import { lane_stats, type StatsWindow } from './lane-stats'
import { lane_stats_request, type StatsRequest, type StatsStart } from './lane-stats-request'
import { lane_stats_tables, type PeriodRecords } from './lane-stats-tables'
import { lane_transcript_stats } from './lane-transcript-stats'
import { lane_value } from './lane-value'
import { lane_value_cell, type CellAddress, type CellFilter } from './lane-value-cell'
import { lane_value_missing } from './lane-value-missing'
import { lane_why_period } from './lane-why-period'

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
	'       josh lane:stats --period <days> --over <minutes>',
	'       josh lane:stats --period <days> --why <minutes>',
	'       josh lane:stats --period <days> --pairs',
	'       josh lane:stats --since <instant> … — any form above, the window opened at the instant',
	`       josh lane:value <${lane_value.NAMES.join('|')}> --since <instant>`,
	`       josh lane:value ${CELL_METRIC} --table <title> [--row <label>] [--where <header>=<text>] --column <header> [--item <label>] [--zero] --since <instant>`,
	'       josh lane:net <issue>',
].join('\n')

const SAMPLE_OPTIONS = { every: { type: 'string' } } as const
const VALUE_OPTIONS = {
	since: { type: 'string' },
	table: { type: 'string' },
	row: { type: 'string' },
	column: { type: 'string' },
	where: { type: 'string' },
	item: { type: 'string' },
	zero: { type: 'boolean' },
} as const
// `--where <header>=<text>`: the header ends at the first `=`, so the text may hold one.
const WHERE_SEPARATOR = '='

function refuse(): number {
	console.error(USAGE)

	return FAILURE_EXIT_CODE
}

// The `--every` interval: `{ seconds: undefined }` for a single sample, `undefined` for a refusal.
function sample_interval(rest: ReadonlyArray<string>): { seconds: number | undefined } | undefined {
	const values = cli_flags.values_of(rest, SAMPLE_OPTIONS)

	if (values === undefined) return undefined

	if (values.every === undefined) return { seconds: undefined }

	const seconds = lane_stats_request.positive(values.every)

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

// Every lane's transcript directory under this checkout's lane root, read from a lane or the main checkout.
function transcript_directories(context: MeasureContext): ReadonlyArray<string> {
	if (context.transcript_directories !== undefined) return context.transcript_directories

	const main_cwd = cost_transcript.session_cwd(process.cwd())

	return cost_transcript.lane_transcript_directories(main_cwd, cost_transcript.home_directory())
}

// The whole ledger with its archive, every run event and the window's lane calls — what the
// `lane:stats` tables read.
async function period_records(
	context: MeasureContext,
	window: StatsWindow,
): Promise<PeriodRecords> {
	return {
		entries: await lane_ledger_archive.read_history(context),
		events: await lane_net_read.read_events(context),
		calls: lane_transcript_stats.read_calls(transcript_directories(context), window),
	}
}

type LedgerTable = typeof lane_sinks.table

// The `--over` or `--sinks` table with its threshold, `undefined` for the period's row and tables.
function table_choice(request: StatsRequest): { table: LedgerTable; minutes: number } | undefined {
	if (request.why !== undefined) return { table: lane_why_period.table, minutes: request.why }
	if (request.over !== undefined) return { table: lane_over_causes.view, minutes: request.over }

	return request.sinks === undefined
		? undefined
		: { table: lane_sinks.table, minutes: request.sinks }
}

// The ledger and the event stream alone — no lane's transcript (`lane-sinks.ts`, `lane-over.ts`).
async function threshold_text(
	choice: { table: LedgerTable; minutes: number },
	context: MeasureContext,
	window: StatsWindow,
): Promise<string> {
	const sources = {
		entries: await lane_ledger_archive.read_history(context),
		events: await lane_net_read.read_events(context),
	}
	const issues = await lane_sinks_issues.read()

	return session_cite.text(choice.table(sources, window, choice.minutes, issues))
}

async function stats_text(
	request: StatsRequest,
	context: MeasureContext,
	window: StatsWindow,
): Promise<string> {
	const choice = table_choice(request)

	if (choice !== undefined) return await threshold_text(choice, context, window)

	if (request.is_pairs) {
		return lane_pairs.table(await lane_ledger_archive.read_history(context), window)
	}

	const records = await period_records(context, window)
	const limit = await lane_limit_history.label(request.limit, records.entries, window)
	const row = lane_stats.row(records.entries, window, { limit })
	const tables = lane_stats_tables.tables_of(records, window)

	return [`${lane_stats.header()}\n${row}`, ...tables].join('\n\n')
}

// `--since` opens the window at its instant; `--period` opens it that many days before now.
function window_of(start: StatsStart, now_ms: number): StatsWindow {
	if ('since_ms' in start) return { since_ms: start.since_ms, until_ms: now_ms }

	return lane_stats.window_of(start.period_days, now_ms)
}

async function stats_command(
	rest: ReadonlyArray<string>,
	context: MeasureContext,
): Promise<number> {
	const request = lane_stats_request.stats_request(rest)

	if (request === undefined) return refuse()

	const window = window_of(request.start, context.now_ms ?? Date.now())

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
	where?: string | undefined
	item?: string | undefined
	zero?: boolean | undefined
}

function is_known(name: string): boolean {
	return name === CELL_METRIC || lane_value.is_metric(name)
}

function metric_of(positionals: ReadonlyArray<string>): string | undefined {
	const [name] = positionals

	return name !== undefined && positionals.length === 1 && is_known(name) ? name : undefined
}

// `{ filter: undefined }` with no `--where`, `undefined` for one without a header or an `=`.
function where_of(text: string | undefined): { filter: CellFilter | undefined } | undefined {
	if (text === undefined) return { filter: undefined }

	const at = text.indexOf(WHERE_SEPARATOR)

	if (at < 1) return undefined

	return { filter: { column: text.slice(0, at), text: text.slice(at + WHERE_SEPARATOR.length) } }
}

function address_of(flags: AddressFlags): CellAddress | undefined {
	const { table, column } = flags
	const where = where_of(flags.where)

	if (table === undefined || column === undefined || where === undefined) return undefined

	return { table, column, row: flags.row, where: where.filter, item: flags.item, zero: flags.zero }
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

	const request = request_of(
		metric_of(parsed.positionals),
		lane_stats_request.since_of(parsed.values.since),
	)

	if (request?.metric !== CELL_METRIC) return request

	const address = address_of(parsed.values)

	return address === undefined ? undefined : { ...request, address }
}

// A value read, or the words `lane:value` fails with when there is none.
interface Measured {
	value: number | undefined
	missing: string
}

// The value alone on its line, so a measurement declaration reads it as the output's last line; a
// period with no sample prints nothing there and fails, which the drive reads as a wait
// (`lane-value-missing.ts`).
function print_value(request: ValueRequest, measured: Measured): number {
	const { value, missing } = measured

	if (value === undefined) {
		const since = new Date(request.since_ms).toISOString()

		console.error(`josh lane:value ${request.metric}: ${missing} since ${since}`)

		return FAILURE_EXIT_CODE
	}

	console.info(value.toFixed(VALUE_DIGITS))

	return 0
}

// The addressed cell of the tables `lane:stats` would print for `window`, and why there is none.
async function cell_value(
	address: CellAddress,
	window: StatsWindow,
	context: MeasureContext,
): Promise<Measured> {
	const tables = lane_stats_tables.tables_of(await period_records(context, window), window)
	const { MISSING } = lane_value_missing
	const is_several = lane_value_cell.is_several(tables, address)

	return {
		value: lane_value_cell.value(tables, address),
		missing: is_several ? MISSING.SEVERAL : MISSING.CELL,
	}
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
		entries: await lane_ledger_archive.read_history(context),
		calls: lane_transcript_stats.read_calls(transcript_directories(context), window),
	}

	const value = lane_value.value(request.metric, records, window)

	return print_value(request, { value, missing: lane_value_missing.MISSING.SAMPLE })
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
