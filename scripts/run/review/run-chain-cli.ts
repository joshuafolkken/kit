#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { project_checks } from '#scripts/gate/project-checks'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import type { ChainRecord } from '#scripts/lane/lane-ledger-schema-ship'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { cli_flags } from '#scripts/lib/cli-flags'
import { run_ship_args } from '#scripts/run/ship/run-ship-args'
import { run_chain, type ChainRun, type ChainStage, type ChainStop } from './run-chain'
import { run_chain_background, type Worker } from './run-chain-background'
import { run_chain_gates } from './run-chain-gates'
import { run_chain_join } from './run-chain-join'
import { run_review_pinned_accepted } from './run-review-pinned-accepted'

// `josh run:chain <N>` — `main:merge` (none in a lane child), `review:selfcheck`, `check:related`,
// `command:derive --check` (kit only) and `run:review` in one call
// (`run-chain.ts`); `--join [--fixing]` runs the half after the review instead (`run-chain-join.ts`).
// `--from <stage>` resumes at a stage after a stop the run settled; `--unpinned-ok "<reason>"` and
// `--accept-metrics "<reason>"` go to `run:review` as given. On `--join`, `--unpinned-ok` alone rides:
// its worker records the reason as `run:review` does before any stage, so the recheck and the ship
// read it (joshuafolkken/kit#8862).

const ARGV_OFFSET = 2
const FAILURE_EXIT_CODE = 1
const USAGE =
	'Usage: josh run:chain <N> [--from <stage>] [--unpinned-ok "<reason>"] [--accept-metrics "<reason>"] | <N> --join [--fixing] [--from <stage>] [--ship "<title> #<N>"] [--unpinned-ok "<reason>"]'
const OPTIONS = {
	from: { type: 'string' },
	'unpinned-ok': { type: 'string' },
	'accept-metrics': { type: 'string' },
	join: { type: 'boolean' },
	fixing: { type: 'boolean' },
	ship: { type: 'string' },
	worker: { type: 'boolean' },
} as const

interface ChainValues {
	from: string | undefined
	unpinned_ok: string | undefined
	accept_metrics: string | undefined
	is_join: boolean
	is_fixing: boolean
	ship: string | undefined
	is_worker: boolean
}

// `stages` is the list from `--from` on; `undefined` for a `--from` no stage carries. `is_worker` marks
// the background run an opening call started (`run-chain-background.ts`).
interface ChainArguments {
	issue: string
	from?: string
	is_join: boolean
	is_worker: boolean
	stages: ReadonlyArray<ChainStage> | undefined
	join_reason?: string
}

type StopFields = Pick<ChainRecord, 'stage' | 'reason' | 'exit_code' | 'refusal'>

// A lane child merges main in ship's sync, so its opening half is the review stages alone
// (`chain-rule.md` → "A lane child"); the metrics stage follows `check:related` in both. The opening
// alone carries the entry's scoped-green ask: `run:review --join` never asked it.
function opening_stages(
	review_args: ReadonlyArray<string>,
	from: string | undefined,
): ReadonlyArray<ChainStage> | undefined {
	const is_kit = project_checks.is_kit_repository(process.cwd())
	const stages = lane_child_marker.is_child_of(process.cwd())
		? run_chain.review_stages(review_args, is_kit)
		: run_chain.main_line_stages(review_args, is_kit)
	const resumed = run_chain.stages_from(run_chain_gates.opening(stages, review_args), from)

	return resumed === undefined ? undefined : run_chain_gates.entry(resumed, from, review_args)
}

function flag_pair(flag: string, value: string | undefined): ReadonlyArray<string> {
	return value === undefined ? [] : [flag, value]
}

function review_args_of(values: ChainValues): ReadonlyArray<string> {
	return [
		...flag_pair('--unpinned-ok', values.unpinned_ok),
		...flag_pair('--accept-metrics', values.accept_metrics),
	]
}

function stages_of(issue: string, values: ChainValues): ReadonlyArray<ChainStage> | undefined {
	if (!values.is_join) return opening_stages(review_args_of(values), values.from)
	const join = run_chain_join.join_stages(issue, values.is_fixing, values.ship)

	return run_chain.stages_from(join, values.from)
}

// `--fixing` and `--ship` belong to the join and `--accept-metrics` to the opening half, so each refuses
// the other; a metrics stop after the review already resumes with `josh metrics --accept`.
function is_mixed(values: ChainValues): boolean {
	if (values.is_join) return values.accept_metrics !== undefined

	return values.is_fixing || values.ship !== undefined
}

function join_reason_of(values: ChainValues): Pick<ChainArguments, 'join_reason'> {
	if (!values.is_join || values.unpinned_ok === undefined) return {}

	return { join_reason: values.unpinned_ok }
}

function ship_matches(issue: string, title: string | undefined): boolean {
	if (title === undefined) return true
	const command = run_ship_args.parse([title])

	return command?.kind === 'ship' && command.args.number === issue
}

function arguments_from(
	issue: string | undefined,
	values: ChainValues,
): ChainArguments | undefined {
	if (issue === undefined || is_mixed(values) || !ship_matches(issue, values.ship)) return undefined

	return {
		issue,
		...(values.from !== undefined && { from: values.from }),
		is_join: values.is_join,
		is_worker: values.is_worker,
		stages: stages_of(issue, values),
		...join_reason_of(values),
	}
}

// The reason goes into the record `run:review` keeps, so nothing here judges with it again.
async function keep_join_reason(parsed: ChainArguments): Promise<void> {
	if (parsed.join_reason === undefined) return
	await run_review_pinned_accepted.keep_reason(parsed.join_reason)
}

function parse(argv: ReadonlyArray<string>): ChainArguments | undefined {
	const parsed = cli_flags.arguments_of(argv, OPTIONS)

	if (parsed === undefined) return undefined
	const { values, positionals } = parsed

	return arguments_from(issue_number_shape.single_of(positionals), {
		from: values.from,
		unpinned_ok: values['unpinned-ok'],
		accept_metrics: values['accept-metrics'],
		is_join: values.join === true,
		is_fixing: values.fixing === true,
		ship: values.ship,
		is_worker: values.worker === true,
	})
}

function refuse(message: string): number {
	console.error(message)

	return FAILURE_EXIT_CODE
}

// A stage that exited 0 stops the run only on its hold notice; a procedural stop names its kind.
function stop_fields(stop: ChainStop | undefined): StopFields {
	if (stop === undefined) return {}

	return {
		stage: stop.stage.name,
		reason: stop.code === run_chain.SUCCESS_EXIT_CODE ? 'hold' : 'exit',
		exit_code: stop.code,
		...(stop.refusal !== undefined && { refusal: stop.refusal }),
	}
}

// One ledger line per run, done or stopped, so `lane:stats` counts the stops by stage and reason and
// the wait until the next run (joshuafolkken/kit#7024), and `lane:breakdown` its stages' time
// (joshuafolkken/kit#7736).
async function record_run(
	parsed: ChainArguments,
	started_ms: number,
	chain: ChainRun,
): Promise<void> {
	await lane_ledger_write.record_chain({
		issue: Number(parsed.issue),
		elapsed_ms: Date.now() - started_ms,
		join: parsed.is_join,
		...stop_fields(chain.stop),
		stages: [...chain.stages],
	})
}

function worker_of(parsed: ChainArguments): Worker {
	const { HALF } = run_chain_background

	return run_chain_background.worker_of(parsed.issue, parsed.is_join ? HALF.JOIN : HALF.OPENING)
}

// Both halves run in the background so the call returns before the prompt cache expires
// (joshuafolkken/kit#8705, joshuafolkken/kit#8761); a join settles an opening worker not yet read
// first, then starts its own only when that worker ended green.
async function run_in_background(
	parsed: ChainArguments,
	argv: ReadonlyArray<string>,
): Promise<number> {
	const opening = run_chain_background.worker_of(parsed.issue, run_chain_background.HALF.OPENING)

	if (parsed.is_join && run_chain_background.has_worker(opening)) {
		const code = await run_chain_background.open(opening, argv)

		if (code !== run_chain.SUCCESS_EXIT_CODE) return code
	}

	return await run_chain_background.open(worker_of(parsed), argv)
}

async function run_in_place(
	parsed: ChainArguments,
	stages: ReadonlyArray<ChainStage>,
): Promise<number> {
	const started_ms = Date.now()

	await keep_join_reason(parsed)

	const chain = await run_chain.run_stages(stages, parsed.issue, (text) => {
		console.info(text)
	})

	await record_run(parsed, started_ms, chain)
	if (chain.stop !== undefined) return refuse(run_chain.stop_report(chain.stop, parsed.issue))
	console.info(run_chain.done_report(stages, parsed.issue))

	return run_chain.SUCCESS_EXIT_CODE
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const parsed = parse(argv)

	if (parsed === undefined) return refuse(USAGE)
	const { stages } = parsed

	if (stages === undefined) return refuse(`no stage ${String(parsed.from)}\n${USAGE}`)
	if (!parsed.is_worker) return await run_in_background(parsed, argv)
	run_chain_background.adopt_session()
	const code = await run_in_place(parsed, stages)

	run_chain_background.finish(worker_of(parsed), code)

	return code
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await run(process.argv.slice(ARGV_OFFSET))
}

const run_chain_cli = { USAGE, run }

export { run_chain_cli }
