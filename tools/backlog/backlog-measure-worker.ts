import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PassResult } from '#scripts/backlog/backlog-drive'
import { backlog_drive_state } from '#scripts/backlog/backlog-drive-state'
import { backlog_next_shared } from '#scripts/backlog/backlog-next-shared'
import { backlog_offer, type OfferAnswer } from '#scripts/backlog/backlog-offer'
import { backlog_offer_exclude } from '#scripts/backlog/backlog-offer-exclude'
import type { JoshResult } from '#scripts/josh/josh-run'
import { lane_ledger } from '#scripts/lane/lane-ledger'
import { run_startup } from '#scripts/run/startup/run-startup'
import { run_startup_schema, type StartupScope } from '#scripts/run/startup/run-startup-schema'
import { run_startup_store } from '#scripts/run/startup/run-startup-store'
import { backlog_measure_completeness, type Completeness } from './backlog-measure-completeness'
import { backlog_measure_guard } from './backlog-measure-guard'
import { backlog_measure_observe } from './backlog-measure-observe'
import { backlog_measure_ports } from './backlog-measure-ports'
import {
	backlog_measure_schema,
	type MeasureBoundary,
	type MeasureScenario,
} from './backlog-measure-schema'

const NAME_PARTS = 2
const POSITIONALS_START = 2
const NEXT_COMMAND = 'backlog:next'
const STARTUP_FILE = 'startup.jsonl'
const MEASUREMENT_SCOPE =
	'Selection and driver only; budget, lane preparation and real workers are replaced'

interface Execution {
	read: JoshResult
	answer: OfferAnswer
	pass: PassResult
}

interface AttemptContext {
	directory: string
	index: number
	boundaries: Array<MeasureBoundary>
	warmup?: { attempt: string; completeness: Completeness }
}

function decoded(read: MeasureScenario['reads'][number]): unknown {
	if (read.encoding === 'set') return new Set(backlog_measure_schema.string_set.parse(read.value))
	if (read.encoding === 'listing') return { json: JSON.stringify(read.value), is_capped: false }

	return structuredClone(read.value)
}

function install_read(
	owner: object,
	read: MeasureScenario['reads'][number],
	records: Array<MeasureBoundary>,
): void {
	const [, method = ''] = read.method.split('.', NAME_PARTS)
	const original: unknown = Reflect.get(owner, method)
	if (typeof original !== 'function') throw new TypeError(`Unknown read: ${read.method}`)

	Reflect.set(owner, method, async function replay(...args: Array<unknown>): Promise<unknown> {
		if (read.args !== undefined && JSON.stringify(args) !== JSON.stringify(read.args)) {
			const value: unknown = await Reflect.apply(original, owner, args)

			return value
		}

		records.push({ attempt: '', source: 'replay', operation: read.method })

		return decoded(read)
	})
}

function replay_target(targets: Map<string, object>, name: string): object {
	const owner = targets.get(name.split('.', NAME_PARTS)[0] ?? '')
	if (owner === undefined) throw new Error(`Unknown source: ${name}`)

	return owner
}

async function replay_reads(
	scenario: MeasureScenario,
	records: Array<MeasureBoundary>,
): Promise<() => void> {
	const { git_gh_command } = await import('#scripts/gh/git-gh-command')
	const { defect_rate_cli } = await import('#scripts/issue/defect-rate-cli')
	const { lane_net_read } = await import('#scripts/lane/lane-net-read')
	const { backlog_resume_reads } = await import('#scripts/backlog/backlog-resume-reads')
	const targets = new Map<string, object>([
		['gh', git_gh_command],
		['defect', defect_rate_cli],
		['net', lane_net_read],
		['resume', backlog_resume_reads],
	])

	for (const read of scenario.reads) {
		install_read(replay_target(targets, read.method), read, records)
	}

	return backlog_measure_observe.install_reads(targets, records)
}

async function select(
	argv: ReadonlyArray<string>,
): Promise<{ code: number; out: string; err: string }> {
	const { backlog_next } = await import('#scripts/backlog/backlog-next')
	const out: Array<string> = []
	const errors: Array<string> = []
	const original = { info: console.info, error: console.error }

	console.info = function info(...args: Array<unknown>): void {
		out.push(args.join(' '))
	}

	console.error = function error(...args: Array<unknown>): void {
		errors.push(args.join(' '))
	}

	try {
		return { code: await backlog_next.run(argv), out: out.join('\n'), err: errors.join('\n') }
	} finally {
		Object.assign(console, original)
	}
}

async function cached_select(in_flight: ReadonlyArray<string>): Promise<JoshResult> {
	const { josh_command } = await import('#scripts/josh/josh-run')
	const original = josh_command.josh_run
	const arguments_of = backlog_offer_exclude.exclude_argv(in_flight)

	josh_command.josh_run = async function next(argv: ReadonlyArray<string>): Promise<JoshResult> {
		if (argv[0] !== NEXT_COMMAND) {
			throw new Error('Measurement refused a command')
		}

		return await select(argv.slice(1))
	}

	try {
		return await backlog_next_shared.read([NEXT_COMMAND, ...arguments_of])
	} finally {
		josh_command.josh_run = original
	}
}

async function execute(
	scenario: MeasureScenario,
	directory: string,
	records: Array<MeasureBoundary>,
): Promise<Execution> {
	const { backlog_drive } = await import('#scripts/backlog/backlog-drive')
	const read = await cached_select(scenario.in_flight)
	const answer = backlog_offer.answer_of(
		{ ...read, tokens: read.out.split('\n') },
		scenario.in_flight.length,
		0,
	)
	const ports = backlog_measure_ports.ports_of(scenario, path.join(directory, 'workers'), records)

	ports.offer = async function offer() {
		return { ...answer, verdict: answer.answer === 'candidates' ? 'run' : 'watch' }
	}

	const state = backlog_drive_state.initial_state(scenario.in_flight, new Date().toISOString())
	const pass = await backlog_drive.run_pass(state, true, ports)

	if (records.some((row) => row.source === 'denied')) {
		throw new Error('Measurement isolation refused an operation')
	}

	return { read, answer, pass }
}

function execution_edge(value: Execution): 'done' | 'failed' | 'waiting' {
	if (backlog_next_shared.edge_of(value.read) === 'failed') return 'failed'
	if (value.pass.kind === 'end' && value.pass.end.reason === 'launch') return 'failed'

	return value.answer.issues.some((issue) => value.pass.state.in_flight.includes(issue))
		? 'done'
		: 'waiting'
}

function summaries(
	destination: string,
	attempt: string,
): ReturnType<typeof run_startup_store.summarize> {
	const entries = lane_ledger.read_entries(destination).flatMap((row) => {
		const parsed = run_startup_schema.entry_schema.safeParse(row)

		return parsed.success ? [parsed.data] : []
	})

	return run_startup_store.summarize(entries.filter((row) => row.attempt === attempt))
}

function write_result(directory: string, index: number, payload: unknown): void {
	writeFileSync(path.join(directory, `result-${String(index)}.json`), JSON.stringify(payload))
}

function save_result(
	context: Omit<AttemptContext, 'boundaries'> & { attempt: string },
	result: Execution,
	boundaries: Array<MeasureBoundary>,
	scenario: MeasureScenario,
): Completeness {
	const summary = summaries(path.join(context.directory, STARTUP_FILE), context.attempt)
	const completeness = backlog_measure_completeness.assess(
		summary,
		boundaries,
		execution_edge(result),
		context.warmup,
	)

	write_result(context.directory, context.index, {
		attempt: context.attempt,
		warmup: scenario.mode === 'warm' && context.index === 0,
		completeness,
		result,
		boundaries,
		summaries: summary,
		scope: MEASUREMENT_SCOPE,
	})

	return completeness
}

async function measured(
	scenario: MeasureScenario,
	scope: StartupScope & { run: string },
	boundaries: Array<MeasureBoundary>,
): Promise<Execution> {
	const from = boundaries.length

	try {
		return await run_startup.within(
			scope,
			async () =>
				await run_startup.phase(
					'isolated selection and simulated launch',
					async () => await execute(scenario, path.join(scope.run, scope.attempt), boundaries),
					{ edge_of: execution_edge },
				),
		)
	} finally {
		for (const row of boundaries.slice(from)) row.attempt = scope.attempt
	}
}

async function one_attempt(
	scenario: MeasureScenario,
	context: AttemptContext,
): Promise<Completeness> {
	const { directory, index, boundaries } = context
	const attempt = `${scenario.name}:${String(index)}`
	const scope = { run: directory, attempt, destination: path.join(directory, STARTUP_FILE) }
	const from = boundaries.length
	const result = await measured(scenario, scope, boundaries)

	const completeness = save_result(
		{ directory, index, attempt, ...('warmup' in context && { warmup: context.warmup }) },
		result,
		boundaries.slice(from),
		scenario,
	)

	if (boundaries.some((row) => row.source === 'denied') || execution_edge(result) === 'failed') {
		throw new Error('Measurement refused or failed an operation')
	}

	return completeness
}

async function attempts(
	scenario: MeasureScenario,
	directory: string,
	boundaries: Array<MeasureBoundary>,
): Promise<void> {
	const completeness = await one_attempt(scenario, { directory, index: 0, boundaries })
	if (scenario.mode === 'cold') return
	const warmup = { attempt: `${scenario.name}:0`, completeness }

	for (let index = 1; index <= scenario.repetitions; index++) {
		// Sequential attempts deliberately retain only this trial's cache.
		// eslint-disable-next-line no-await-in-loop
		await one_attempt(scenario, {
			directory,
			index,
			boundaries,
			warmup,
		})
	}
}

async function run(scenario: MeasureScenario, directory: string): Promise<void> {
	const boundaries: Array<MeasureBoundary> = []
	const restore = backlog_measure_guard.install(scenario, process.cwd(), boundaries)
	const restore_http = backlog_measure_observe.install_http(boundaries, scenario.live_get)
	const restore_reads = await replay_reads(scenario, boundaries)

	try {
		await attempts(scenario, directory, boundaries)
	} finally {
		writeFileSync(path.join(directory, 'boundaries.json'), JSON.stringify(boundaries))
		restore()
		restore_http()
		restore_reads()
	}
}

async function main(): Promise<void> {
	if (process.argv[1] !== fileURLToPath(import.meta.url)) return
	const [input = '', directory = ''] = process.argv.slice(POSITIONALS_START)
	const scenario = backlog_measure_schema.scenario_schema.parse(
		JSON.parse(readFileSync(input, 'utf8')),
	)

	await run(scenario, directory)
}

await main()

const backlog_measure_worker = { run, execute, execution_edge }
export { backlog_measure_worker }
