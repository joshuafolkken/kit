#!/usr/bin/env tsx
import { execSync } from 'node:child_process'
import { appendFile, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { observation_ledger_home } from '#scripts/observations/observation-ledger-home'
import { baseline_measure, type Baseline } from './baseline-measure'

// `josh measure:rerun <path>` — read a behavior-change Issue body after merge, re-run each baseline
// command, and print the before/after pair (joshuafolkken/kit#2212). A value that did not move means
// the premise the rule rested on is refuted, so a line is appended to the observation ledger — reusing
// that append-only, same-key mechanism rather than a second one.

const FAILURE_EXIT_CODE = 1
const USAGE = 'Usage: josh measure:rerun <path-to-issue-body>'
const NO_BASELINE = 'no `command → value` baseline found in ## ベースライン — nothing to re-run'
const DATE_END = 10

// The command's stdout, trimmed to one value. A failing command yields its message so the pair still
// prints rather than aborting the whole re-measurement.
function measure(command: string): string {
	try {
		return execSync(command, { encoding: 'utf8' }).trim()
	} catch (error) {
		return `(command failed: ${error instanceof Error ? error.message : String(error)})`
	}
}

interface Outcome {
	pair: string
	ledger_line: string | undefined
}

function rerun_one(baseline: Baseline, date: string): Outcome {
	const after = measure(baseline.command)
	const is_unchanged = baseline_measure.is_no_change(baseline.value, after)

	return {
		pair: baseline_measure.format_pair(baseline, after),
		ledger_line: is_unchanged ? baseline_measure.ledger_line(baseline, date) : undefined,
	}
}

async function append_ledger(lines: ReadonlyArray<string>): Promise<void> {
	if (lines.length === 0) return

	// The primary checkout's ledger even inside a lane, whose own copy never reaches the default branch
	// (joshuafolkken/kit#2419).
	const ledger_path = observation_ledger_home.ledger_path()

	await appendFile(ledger_path, `${lines.join('\n')}\n`, 'utf8')
	console.info(`Recorded ${String(lines.length)} refuted premise(s) in ${ledger_path}.`)
}

function today(now: Date): string {
	return now.toISOString().slice(0, DATE_END)
}

async function rerun(body_path: string, now: Date): Promise<number> {
	const baselines = baseline_measure.parse_baselines(await readFile(body_path, 'utf8'))

	if (baselines.length === 0) {
		console.error(NO_BASELINE)

		return FAILURE_EXIT_CODE
	}

	const outcomes = baselines.map((baseline) => rerun_one(baseline, today(now)))
	const ledger_lines = outcomes
		.map((outcome) => outcome.ledger_line)
		.filter((line): line is string => line !== undefined)

	console.info(outcomes.map((outcome) => outcome.pair).join('\n\n'))
	await append_ledger(ledger_lines)

	return 0
}

async function run(body_path: string | undefined, now: Date): Promise<number> {
	if (body_path === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	return await rerun(body_path, now)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv[0], new Date())
}

const measure_rerun_cli = { run, rerun_one, USAGE, NO_BASELINE }

const ARGV_OFFSET = 2

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { measure_rerun_cli }
