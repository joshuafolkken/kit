#!/usr/bin/env tsx
import { setInterval as every } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { cost_transcript } from '#scripts/cost-runtime/cost-transcript'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { session_cite } from '#scripts/issue/session-cite'
import { cli_flags } from '#scripts/lib/cli-flags'
import { MS_PER_SECOND } from '#scripts/lib/timeouts'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { lane_capacity } from './lane-capacity'
import { lane_check_stats } from './lane-check-stats'
import { lane_claim_stats } from './lane-claim-stats'
import { lane_core_wait_stats } from './lane-core-wait-stats'
import { lane_gap_stats } from './lane-gap-stats'
import { lane_held_stats } from './lane-held-stats'
import { lane_implement_stats } from './lane-implement-stats'
import { lane_ledger } from './lane-ledger'
import { lane_net_time } from './lane-net-time'
import { lane_process_stats } from './lane-process-stats'
import { lane_round_one_stats } from './lane-round-one-stats'
import { lane_round_two_stats } from './lane-round-two-stats'
import { lane_sampler, type MeasureContext } from './lane-sampler'
import { lane_split_stats } from './lane-split-stats'
import { lane_stage_stats } from './lane-stage-stats'
import { lane_stats, type StatsWindow } from './lane-stats'
import { lane_stop_stats } from './lane-stop-stats'
import { lane_test_related_stats } from './lane-test-related-stats'
import type { ToolCall } from './lane-transcript-calls'
import { lane_transcript_stats } from './lane-transcript-stats'
import { lane_value } from './lane-value'

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
// A value keeps two decimals: seconds, minutes and per-lane counts read at that grain.
const VALUE_DIGITS = 2
const USAGE = [
	'Usage: josh lane:sample [--every <seconds>]',
	'       josh lane:stats --period <days> [--limit <lane-limit>]',
	`       josh lane:value <${lane_value.NAMES.join('|')}> --since <instant>`,
	'       josh lane:net <issue>',
].join('\n')

const SAMPLE_OPTIONS = { every: { type: 'string' } } as const
const STATS_OPTIONS = { period: { type: 'string' }, limit: { type: 'string' } } as const
const VALUE_OPTIONS = { since: { type: 'string' } } as const

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

// The run's event stream, read for the parks that end a stop's wait.
async function read_events(context: MeasureContext): Promise<ReadonlyArray<RunEvent>> {
	if (context.events_path !== undefined) return run_event_stream.read_events(context.events_path)

	return await run_event_stream_emit.all_events()
}

// Every lane's transcript directory under this checkout's lane root, read from a lane or the main checkout.
function transcript_directories(context: MeasureContext): ReadonlyArray<string> {
	if (context.transcript_directories !== undefined) return context.transcript_directories

	const main_cwd = cost_transcript.session_cwd(process.cwd())

	return cost_transcript.lane_transcript_directories(main_cwd, cost_transcript.home_directory())
}

interface PeriodRecords {
	entries: ReturnType<typeof lane_ledger.read_entries>
	events: ReadonlyArray<RunEvent>
	calls: ReadonlyArray<ToolCall>
}

// The tables under the period's row, in the order `lane:stats` prints them.
function tables_of({ entries, events, calls }: PeriodRecords, window: StatsWindow): Array<string> {
	return [
		lane_stage_stats.table(entries, window),
		lane_implement_stats.table(calls, window),
		lane_stop_stats.table(entries, window, events),
		lane_gap_stats.table(entries, window, events),
		lane_round_one_stats.table(entries, window),
		lane_round_two_stats.table(entries, window),
		lane_split_stats.table(entries, window),
		lane_held_stats.table(entries, window),
		lane_core_wait_stats.table(entries, window),
		lane_process_stats.table(entries, window),
		lane_check_stats.table(entries, window),
		lane_claim_stats.table(entries, window),
		lane_test_related_stats.table(entries, window),
		lane_test_related_stats.trigger_table(entries, window),
		lane_transcript_stats.table(calls, window),
	]
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
	const records = {
		entries,
		events: await read_events(context),
		calls: lane_transcript_stats.read_calls(transcript_directories(context), window),
	}

	console.info([`${lane_stats.header()}\n${row}`, ...tables_of(records, window)].join('\n\n'))

	return 0
}

interface ValueRequest {
	metric: string
	since_ms: number
}

function since_of(text = ''): number | undefined {
	const since_ms = Date.parse(text)

	return Number.isNaN(since_ms) ? undefined : since_ms
}

function metric_of(positionals: ReadonlyArray<string>): string | undefined {
	const [name] = positionals

	return name !== undefined && positionals.length === 1 && lane_value.is_metric(name)
		? name
		: undefined
}

function request_of(
	metric: string | undefined,
	since_ms: number | undefined,
): ValueRequest | undefined {
	return metric === undefined || since_ms === undefined ? undefined : { metric, since_ms }
}

// One known metric and a readable `--since` instant, or `undefined` for a refusal.
function value_request(rest: ReadonlyArray<string>): ValueRequest | undefined {
	const parsed = cli_flags.arguments_of(rest, VALUE_OPTIONS)

	if (parsed === undefined) return undefined

	return request_of(metric_of(parsed.positionals), since_of(parsed.values.since))
}

// The value alone on its line, so a measurement declaration reads it as the output's last line; a
// period with no sample prints nothing there and fails, which the drive reads as unreadable.
function print_value(request: ValueRequest, measured: number | undefined): number {
	if (measured === undefined) {
		const since = new Date(request.since_ms).toISOString()

		console.error(`josh lane:value ${request.metric}: no sample since ${since}`)

		return FAILURE_EXIT_CODE
	}

	console.info(measured.toFixed(VALUE_DIGITS))

	return 0
}

async function value_command(
	rest: ReadonlyArray<string>,
	context: MeasureContext,
): Promise<number> {
	const request = value_request(rest)

	if (request === undefined) return refuse()

	const window = { since_ms: request.since_ms, until_ms: context.now_ms ?? Date.now() }
	const records = {
		entries: await read_ledger(context),
		calls: lane_transcript_stats.read_calls(transcript_directories(context), window),
	}

	return print_value(request, lane_value.value(request.metric, records, window))
}

// The lane's net minutes, whole, alone on the line a causing-lane declaration copies
// (`lane-net-time.ts`); a lane the ledger holds no dispatch and merge of fails.
async function net_command(rest: ReadonlyArray<string>, context: MeasureContext): Promise<number> {
	const [issue = ''] = rest

	if (rest.length !== 1 || !issue_number_shape.is_issue_number(issue)) return refuse()

	const events = await read_events(context)
	const net = lane_net_time.net_minutes(await read_ledger(context), events, Number(issue))

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
