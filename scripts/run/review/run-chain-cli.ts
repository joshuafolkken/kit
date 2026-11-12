#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { cli_flags } from '#scripts/lib/cli-flags'
import { run_ship_args } from '#scripts/run/ship/run-ship-args'
import { run_chain, type ChainStage, type ChainStop } from './run-chain'
import { run_chain_join } from './run-chain-join'

// `josh run:chain <N>` — `main:merge` (none in a lane child), `review:selfcheck`, `check:related` and `run:review` in one call
// (`run-chain.ts`); `--join [--fixing]` runs the half after the review instead (`run-chain-join.ts`).
// `--from <stage>` resumes at a stage after a stop the run settled; `--unpinned-ok "<reason>"` goes to
// `run:review` as given, so it opens a review and never rides on `--join`.

const ARGV_OFFSET = 2
const FAILURE_EXIT_CODE = 1
const USAGE =
	'Usage: josh run:chain <N> [--from <stage>] [--unpinned-ok "<reason>"] | <N> --join [--fixing] [--from <stage>] [--ship "<title> #<N>"]'
const OPTIONS = {
	from: { type: 'string' },
	'unpinned-ok': { type: 'string' },
	join: { type: 'boolean' },
	fixing: { type: 'boolean' },
	ship: { type: 'string' },
} as const

interface ChainValues {
	from: string | undefined
	unpinned_ok: string | undefined
	is_join: boolean
	is_fixing: boolean
	ship: string | undefined
}

interface ChainArguments {
	issue: string
	from?: string
	is_join: boolean
	stages: ReadonlyArray<ChainStage>
}

interface StopFields {
	stage?: string
	reason?: 'exit' | 'hold'
}

// A lane child merges main in ship's sync, so its opening half is the review stages alone
// (`chain-rule.md` → "A lane child").
function opening_stages(unpinned_ok: ReadonlyArray<string>): ReadonlyArray<ChainStage> {
	if (lane_child_marker.is_child_of(process.cwd())) return run_chain.review_stages(unpinned_ok)

	return run_chain.main_line_stages(unpinned_ok)
}

function stages_of(issue: string, values: ChainValues): ReadonlyArray<ChainStage> {
	if (values.is_join) return run_chain_join.join_stages(issue, values.is_fixing, values.ship)
	const reason = values.unpinned_ok

	return opening_stages(reason === undefined ? [] : ['--unpinned-ok', reason])
}

// `--fixing` belongs to the join and `--unpinned-ok` to the opening half, so each refuses the other list.
function is_mixed(values: ChainValues): boolean {
	if (values.is_join) return values.unpinned_ok !== undefined

	return values.is_fixing || values.ship !== undefined
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
		stages: stages_of(issue, values),
	}
}

function parse(argv: ReadonlyArray<string>): ChainArguments | undefined {
	const parsed = cli_flags.arguments_of(argv, OPTIONS)

	if (parsed === undefined) return undefined
	const { values, positionals } = parsed

	return arguments_from(issue_number_shape.single_of(positionals), {
		from: values.from,
		unpinned_ok: values['unpinned-ok'],
		is_join: values.join === true,
		is_fixing: values.fixing === true,
		ship: values.ship,
	})
}

function refuse(message: string): number {
	console.error(message)

	return FAILURE_EXIT_CODE
}

// A stage that exited 0 stops the run only on its hold notice.
function stop_fields(stop: ChainStop | undefined): StopFields {
	if (stop === undefined) return {}

	return {
		stage: stop.stage.name,
		reason: stop.code === run_chain.SUCCESS_EXIT_CODE ? 'hold' : 'exit',
	}
}

// One ledger line per run, done or stopped, so `lane:stats` counts the stops by stage and reason and
// the wait until the next run (joshuafolkken/kit#7024).
async function record_run(
	parsed: ChainArguments,
	started_ms: number,
	stop: ChainStop | undefined,
): Promise<void> {
	await lane_ledger_write.record_chain({
		issue: Number(parsed.issue),
		elapsed_ms: Date.now() - started_ms,
		join: parsed.is_join,
		...stop_fields(stop),
	})
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const parsed = parse(argv)

	if (parsed === undefined) return refuse(USAGE)
	const stages = run_chain.stages_from(parsed.stages, parsed.from)

	if (stages === undefined) return refuse(`no stage ${String(parsed.from)}\n${USAGE}`)
	const started_ms = Date.now()
	const stop = await run_chain.run_stages(stages, parsed.issue, (text) => {
		console.info(text)
	})

	await record_run(parsed, started_ms, stop)
	if (stop !== undefined) return refuse(run_chain.stop_report(stop, parsed.issue))
	console.info(run_chain.done_report(stages, parsed.issue))

	return run_chain.SUCCESS_EXIT_CODE
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await run(process.argv.slice(ARGV_OFFSET))
}

const run_chain_cli = { USAGE, run }

export { run_chain_cli }
