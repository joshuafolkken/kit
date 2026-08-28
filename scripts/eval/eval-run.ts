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
const MS_PER_SECOND = 1000
// An inconclusive verdict means the session did not produce a measurement, and a retried scenario is
// announced rather than quietly replaced. One attempt, because a second buys nothing: raised to two
// while investigating joshuafolkken/kit#1001 and put back, since neither the extra attempt nor the
// longer waits recovered a single scenario — and the pair roughly doubled the worst-case suite time
// for the same verdict.
const INCONCLUSIVE_RETRIES = 1
// Sessions run back to back were the first suspected cause: measured on this suite, the first two
// scenarios return full transcripts and every one after them returns an empty one, and each of those
// passes on its own moments later. The pause is what was meant to make a five-scenario run mean the
// same thing as five single runs.
//
// **Pacing has not been shown to be the cause, and this is not the remedy.** Raising it to 45s with a
// second retry changed nothing, and the first run to print a reason named something else — `API
// Error: Unable to connect to API (ConnectionRefused)`, after the session had started. The pause is
// kept at its original value as a cheap margin; the remedy is whatever that error turns out to be
// (joshuafolkken/kit#1001).
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
		log(
			`  … ${scenario.name} produced no measurement; waiting ${String(RETRY_PAUSE_MS / MS_PER_SECOND)}s, then retrying`,
		)
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

	for (const [index, scenario] of chosen.entries()) {
		if (verdicts.length > 0) {
			log(`  … pausing ${String(SCENARIO_PAUSE_MS / MS_PER_SECOND)}s before the next scenario`)
			await pause(SCENARIO_PAUSE_MS)
		}

		// Announced before it runs, not only after. A scenario can occupy the ten-minute session
		// timeout, and until joshuafolkken/kit#1001 the suite printed nothing for that whole time — so
		// a stall was indistinguishable from slow progress, and the harness watchdog that kills a run
		// with no output had nothing to see.
		log(`  ▸ ${scenario.name} (${String(index + 1)}/${String(chosen.length)})`)

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

	const verdicts = await run_all(chosen, model)
	// The count first, then what it means for a merge: the verdict line is what `josh eval:scope`
	// sent the run here for, so it is the last thing printed rather than something to scroll back to.
	const is_held = eval_report.report_summary(verdicts)

	eval_report.report_merge_verdict(verdicts)

	return is_held
}

async function main(): Promise<boolean> {
	const names = process.argv.slice(ARGV_SCENARIO_OFFSET)
	const scenarios = eval_scenario.load_scenarios(SCENARIO_DIRECTORY)
	const unknown = unknown_scenarios(names, scenarios)

	if (unknown !== undefined) {
		console.error(unknown)
		// Not silence: without a verdict line the caller's rule reads this as `unmeasured`, which does
		// not block a merge — and this path is reached by a typo in the very re-run a `blocked`
		// verdict asked for (joshuafolkken/kit#907).
		eval_report.report_not_run()

		return false
	}

	return await run_selection(selected(scenarios, names))
}

const is_all_held = await main()

if (!is_all_held) process.exitCode = FAILURE_EXIT_CODE
