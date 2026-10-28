#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { observation_ledger_home } from '#scripts/observations/observation-ledger-home'
import { baseline_measure, type Baseline } from './baseline-measure'
import { trusted_measure } from './trusted-measure'

// `josh measure:rerun <N>` — read a behavior-change Issue body after merge, re-run each baseline
// command, and print the before/after pair. A value that did not move means
// the premise the rule rested on is refuted, so a line is appended to the observation ledger — reusing
// that append-only, same-key mechanism rather than a second one.
//
// The baseline is shell, so only a body whose author can write to the repository is run
// (`trusted-measure.ts`).

const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const USAGE = 'Usage: josh measure:rerun <issue-number>'
const NO_BASELINE = 'no `command → value` baseline found in ## ベースライン — nothing to re-run'
const DATE_END = 10

interface Outcome {
	pair: string
	ledger_line: string | undefined
}

// A failing or timed-out command yields its message so the pair still prints and the remaining
// baselines still run, rather than aborting the whole re-measurement.
function rerun_one(baseline: Baseline, date: string): Outcome {
	const after = trusted_measure.text_of(trusted_measure.run_command(baseline.command))
	const is_unchanged = baseline_measure.is_no_change(baseline.value, after)

	return {
		pair: baseline_measure.format_pair(baseline, after),
		ledger_line: is_unchanged ? baseline_measure.ledger_line(baseline, date) : undefined,
	}
}

async function append_ledger(lines: ReadonlyArray<string>, now: Date): Promise<void> {
	if (lines.length === 0) return

	// The running work tree's file for the checked-out issue, a lane's inside a lane — the run's own
	// commit carries it.
	const ledger_path = await observation_ledger_home.writer_path(now)

	await observation_ledger_home.append(ledger_path, lines)
	console.info(`Recorded ${String(lines.length)} refuted premise(s) in ${ledger_path}.`)
}

function today(now: Date): string {
	return now.toISOString().slice(0, DATE_END)
}

async function rerun(body: string, now: Date): Promise<number> {
	const baselines = baseline_measure.parse_baselines(body)

	if (baselines.length === 0) {
		console.error(NO_BASELINE)

		return FAILURE_EXIT_CODE
	}

	const outcomes = baselines.map((baseline) => rerun_one(baseline, today(now)))
	const ledger_lines = outcomes
		.map((outcome) => outcome.ledger_line)
		.filter((line): line is string => line !== undefined)

	console.info(outcomes.map((outcome) => outcome.pair).join('\n\n'))
	await append_ledger(ledger_lines, now)

	return 0
}

async function run(issue_number: string | undefined, now: Date): Promise<number> {
	if (issue_number === undefined || !issue_number_shape.ISSUE_NUMBER_PATTERN.test(issue_number)) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const read = await trusted_measure.read_trusted_body(issue_number)

	if (read.kind === 'refused') {
		console.error(read.reason)

		return FAILURE_EXIT_CODE
	}

	return await rerun(read.body, now)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv[0], new Date())
}

const measure_rerun_cli = { run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { measure_rerun_cli }
