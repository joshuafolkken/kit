#!/usr/bin/env tsx
import path from 'node:path'
import { PACKAGE_DIR } from '#scripts/init/init-paths'
import { eval_judge, type Verdict } from './eval-judge'
import { eval_report } from './eval-report'
import { eval_sandbox } from './eval-sandbox'
import { eval_scenario, type Scenario } from './eval-scenario'
import { eval_session } from './eval-session'
import { eval_transcript } from './eval-transcript'

// `pnpm josh eval [name...]`. Deliberately not wired into CI: every scenario is a real Claude
// session, so the suite costs tokens and minutes and is run when a document or hook changes — the
// moment its answer is worth paying for (joshuafolkken/kit#855).
const SCENARIO_DIRECTORY = path.join(PACKAGE_DIR, 'evals/scenarios')
const DEFAULT_MODEL = 'sonnet'
const MODEL_ENV_KEY = 'JOSH_EVAL_MODEL'
// `node scripts/eval/eval-run.ts <name...>` — the names begin after the runtime and the script.
const ARGV_SCENARIO_OFFSET = 2
const FAILURE_EXIT_CODE = 1
// An inconclusive verdict means the session did not produce a measurement — an API drop, a stalled
// start. Those cluster in the back half of a long batch, so one retry recovers most of them, and a
// retried scenario is announced rather than quietly replaced.
const INCONCLUSIVE_RETRIES = 1
// Sessions run back to back exhaust something upstream: measured on this suite, the first two
// scenarios return full transcripts and every one after them returns an empty one — and each of those
// passes on its own moments later, so it is pacing rather than the scenario. The pause is what makes
// a five-scenario run mean the same thing as five single runs.
const SCENARIO_PAUSE_MS = 20_000
// A retry follows an empty transcript, which is the signal that the pause was not enough, so it waits
// longer than the pause that already failed to prevent it.
const RETRY_PAUSE_MS = 60_000

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
// distributed documents behind; a suite run would otherwise leak one per failure.
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

// Only an inconclusive verdict is retried. A scenario that failed measured something, and running it
// again until it passes would turn the suite into a slot machine.
async function run_scenario(scenario: Scenario, model: string): Promise<Verdict> {
	let verdict = await run_once(scenario, model)

	for (let attempt = 0; attempt < INCONCLUSIVE_RETRIES && verdict.is_inconclusive; attempt += 1) {
		log(`  … ${scenario.name} produced no measurement; waiting, then retrying`)
		await pause(RETRY_PAUSE_MS)
		verdict = await run_once(scenario, model)
	}

	return verdict
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

// Sequential on purpose: the scenarios share one API rate budget, and a parallel run trades a
// slower suite for verdicts that fail on throttling rather than on the rule.
async function run_all(chosen: ReadonlyArray<Scenario>, model: string): Promise<Array<Verdict>> {
	const verdicts: Array<Verdict> = []

	for (const scenario of chosen) {
		if (verdicts.length > 0) await pause(SCENARIO_PAUSE_MS)

		const verdict = await run_scenario(scenario, model)

		eval_report.report_verdict(verdict)
		verdicts.push(verdict)
	}

	return verdicts
}

// Returns the exit state rather than setting it: assigning `process.exitCode` after an await is a
// write to shared state from a point where nothing guarantees the process is still the one that
// started the run, and the lint rule that says so is right.
async function run_selection(chosen: ReadonlyArray<Scenario>): Promise<boolean> {
	const model = process.env[MODEL_ENV_KEY] ?? DEFAULT_MODEL

	console.info(`Running ${String(chosen.length)} scenario(s) on ${model}.\n`)

	return eval_report.report_summary(await run_all(chosen, model))
}

async function main(): Promise<boolean> {
	const names = process.argv.slice(ARGV_SCENARIO_OFFSET)
	const scenarios = eval_scenario.load_scenarios(SCENARIO_DIRECTORY)
	const unknown = unknown_scenarios(names, scenarios)

	if (unknown !== undefined) {
		console.error(unknown)

		return false
	}

	return await run_selection(selected(scenarios, names))
}

const is_all_held = await main()

if (!is_all_held) process.exitCode = FAILURE_EXIT_CODE
