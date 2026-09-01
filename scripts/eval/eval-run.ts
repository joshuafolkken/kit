#!/usr/bin/env tsx
import path from 'node:path'
import { bounded_pool } from '#scripts/bounded-pool'
import { PACKAGE_DIR } from '#scripts/init/init-paths'
import { eval_judge, type Verdict } from './eval-judge'
import { eval_report } from './eval-report'
import { eval_runner, type RunnerDependencies } from './eval-runner'
import { eval_sandbox } from './eval-sandbox'
import { eval_scenario, type Scenario } from './eval-scenario'
import { eval_session } from './eval-session'
import { eval_stamp } from './eval-stamp'
import { eval_transcript } from './eval-transcript'

// `pnpm josh eval [name...]`. Deliberately not wired into CI: every scenario is a real Claude
// session, so the suite costs tokens and minutes and is run when a document or hook changes — the
// moment its answer is worth paying for (joshuafolkken/kit#855).
//
// The command around the run; how the run spends its wall-clock is `eval-runner.ts`, which is where
// the loop can be tested without spawning a session (joshuafolkken/kit#1144).
const SCENARIO_DIRECTORY = path.join(PACKAGE_DIR, 'evals/scenarios')
const DEFAULT_MODEL = 'sonnet'
const MODEL_ENV_KEY = 'JOSH_EVAL_MODEL'
// `node scripts/eval/eval-run.ts <name...>` — the names begin after the runtime and the script.
const ARGV_SCENARIO_OFFSET = 2
const FAILURE_EXIT_CODE = 1

function selected(
	scenarios: ReadonlyArray<Scenario>,
	names: ReadonlyArray<string>,
): Array<Scenario> {
	if (names.length === 0) return [...scenarios]

	return scenarios.filter((scenario) => names.includes(scenario.name))
}

function log(message: string): void {
	console.info(message)
}

async function pause(duration_ms: number): Promise<void> {
	await new Promise((resolve) => {
		setTimeout(resolve, duration_ms)
	})
}

// The sandbox is removed in `finally` so a scenario that threw does not leave a full copy of the
// distributed documents behind; a suite run would otherwise leak one per failure. Each scenario
// builds its own, which is what makes them independent enough to run side by side.
async function run_once(scenario: Scenario, model: string): Promise<Verdict> {
	const sandbox_path = eval_sandbox.create_sandbox(scenario)

	try {
		const session = await eval_session.run_session(scenario, sandbox_path, model)
		const calls = eval_transcript.read_tool_calls(session.transcript)

		return eval_judge.judge(scenario, calls, session)
	} finally {
		eval_sandbox.remove_sandbox(sandbox_path)
	}
}

function runner_dependencies(model: string, concurrency: number): RunnerDependencies {
	return {
		concurrency,
		log,
		pause,
		report: eval_report.report_verdict,
		run_once: async (scenario) => await run_once(scenario, model),
	}
}

// Returns the message rather than throwing it: a typo in a scenario name is a user error, and a Node
// stack trace answers it with the harness's own internals instead of the list of names to pick from.
function unknown_scenarios(
	names: ReadonlyArray<string>,
	scenarios: ReadonlyArray<Scenario>,
): string | undefined {
	const known = scenarios.map((scenario) => scenario.name)
	const unknown = names.filter((name) => !known.includes(name))

	if (unknown.length === 0) return undefined

	return `unknown scenario(s): ${unknown.join(', ')}\nknown: ${known.join(', ')}`
}

// Not silence: without a verdict line the caller's rule reads this as `unmeasured`, which does not
// block a merge — and this path is reached by a typo in the very re-run a `blocked` verdict asked
// for (joshuafolkken/kit#907).
function report_startup_problem(message: string): boolean {
	console.error(message)
	eval_report.report_not_run()

	return false
}

// Returns the exit state rather than setting it: assigning `process.exitCode` after an await is a
// write to shared state from a point where nothing guarantees the process is still the one that
// started the run, and the lint rule that says so is right.
// Recorded before the first session starts, so a `/code-review` running alongside can afterwards be
// checked against exactly the tree the suite read (joshuafolkken/kit#1152). Best-effort on
// purpose: a record that could not be written leaves `josh eval:scope --since-eval` with nothing,
// which answers `required` — measure again rather than trust a result nothing vouches for. Failing
// the run instead would turn a temp-directory problem into a lost measurement.
function record_measured_tree(): void {
	try {
		eval_stamp.write_stamp()
	} catch (error) {
		console.error(`Could not record what this run measures: ${String(error)}`)
	}
}

async function run_selection(
	chosen: ReadonlyArray<Scenario>,
	concurrency: number,
): Promise<boolean> {
	const model = process.env[MODEL_ENV_KEY] ?? DEFAULT_MODEL
	const width = bounded_pool.pool_width(concurrency, chosen.length)

	console.info(
		`Running ${String(chosen.length)} scenario(s) on ${model}, ${String(width)} at a time.\n`,
	)

	const verdicts = await eval_runner.run_all(chosen, runner_dependencies(model, concurrency))
	// The count first, then what it means for a merge: the verdict line is what `josh eval:scope`
	// sent the run here for, so it is the last thing printed rather than something to scroll back to.
	const is_held = eval_report.report_summary(verdicts)

	eval_report.report_merge_verdict(verdicts)

	return is_held
}

async function main(): Promise<boolean> {
	const names = process.argv.slice(ARGV_SCENARIO_OFFSET)
	const scenarios = eval_scenario.load_scenarios(SCENARIO_DIRECTORY)
	const choice = eval_runner.read_concurrency(process.env[eval_runner.CONCURRENCY_ENV_KEY])

	if (choice.kind === 'problem') return report_startup_problem(choice.problem)

	const unknown = unknown_scenarios(names, scenarios)

	if (unknown !== undefined) return report_startup_problem(unknown)

	// **Only a whole-suite run leaves a record.** A named re-run — what a `blocked` verdict asks for —
	// would otherwise overwrite the record with a newer timestamp and the tree as it is now, and
	// `--since-eval` would then compare that tree against itself and answer `skip`: a one-scenario
	// reading standing in for the suite's measurement. The record says what the suite measured, so it
	// is written only where the suite is what ran.
	if (names.length === 0) record_measured_tree()

	return await run_selection(selected(scenarios, names), choice.limit)
}

const is_all_held = await main()

if (!is_all_held) process.exitCode = FAILURE_EXIT_CODE
