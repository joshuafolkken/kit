#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { ci_timing, type RunTiming, type TimingAnswer } from './ci-timing'
import { ci_timing_table } from './ci-timing-table'

// `josh ci:timing <pr|branch|run-id> [--json]` — the command line over `ci-timing.ts`.

const ARGV_OFFSET = 2
const FAILURE_EXIT_CODE = 1
const SUCCESS_EXIT_CODE = 0
const JSON_FLAG = '--json'
const JSON_INDENT = 2
const USAGE = 'Usage: josh ci:timing <pr|branch|run-id> [--json]'

function report_of(timing: RunTiming): string {
	const { run: workflow_run, jobs } = timing
	const state = workflow_run.conclusion ?? 'in progress'
	const name = workflow_run.name ?? ''
	const heading = `run ${String(workflow_run.id)} — ${name} · ${state} · ${workflow_run.html_url}`

	return `${heading}\n${ci_timing_table.table(jobs)}`
}

function print_answer(answer: TimingAnswer, is_json: boolean): number {
	if (answer.kind === 'none') {
		console.error(`ci:timing ${answer.target} — no GitHub Actions run found`)

		return FAILURE_EXIT_CODE
	}

	const text = is_json
		? JSON.stringify(answer.runs, undefined, JSON_INDENT)
		: answer.runs.map((timing) => report_of(timing)).join('\n\n')

	process.stdout.write(`${text}\n`)

	return SUCCESS_EXIT_CODE
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const positionals = argv.filter((token) => token !== JSON_FLAG)
	const [argument] = positionals

	if (argument === undefined || positionals.length > 1) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	return print_answer(await ci_timing.timing_of(argument), argv.includes(JSON_FLAG))
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const ci_timing_cli = { USAGE, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { ci_timing_cli }
