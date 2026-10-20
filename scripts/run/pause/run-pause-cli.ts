#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { cli_flags } from '#scripts/lib/cli-flags'
import { run_pause, type PauseRequest, type PauseResult, type StepReport } from './run-pause'

// `josh run:pause <M> --for <N>` — the argument parsing and the report around `run-pause.ts`. One
// line per step that landed; a failure names its step, what was already done, and the rerun that
// continues from there.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const USAGE = 'Usage: josh run:pause <issue> --for <prerequisite>'
const OPTIONS = { for: { type: 'string' } } as const

// The prerequisite has to be another issue: `#M` blocked by itself is no order at all.
function prerequisite_of(value: string | undefined, issue: string): string | undefined {
	if (value === undefined || value === issue) return undefined

	return issue_number_shape.is_issue_number(value) ? value : undefined
}

function parse_request(argv: ReadonlyArray<string>): PauseRequest | undefined {
	const parsed = cli_flags.arguments_of(argv, OPTIONS)
	if (parsed === undefined) return undefined
	const issue = issue_number_shape.single_of(parsed.positionals)
	const prerequisite = issue === undefined ? undefined : prerequisite_of(parsed.values.for, issue)

	return issue === undefined || prerequisite === undefined ? undefined : { issue, prerequisite }
}

function report_done(done: ReadonlyArray<StepReport>): void {
	for (const { step, detail } of done) console.info(`${step}: ${detail}`)
}

function report_failure(request: PauseRequest, result: PauseResult & { kind: 'failed' }): void {
	const steps = result.done.map(({ step }) => step).join(', ')

	console.error(`✖ ${result.step} failed: ${result.reason}`)
	console.error(`Done: ${steps.length === 0 ? 'nothing' : steps}.`)
	console.error(
		`Rerun \`pnpm josh run:pause ${request.issue} --for ${request.prerequisite}\` to continue from ${result.step}.`,
	)
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const request = parse_request(argv)

	if (request === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const result = await run_pause.pause(request)

	report_done(result.done)
	if (result.kind === 'paused') return SUCCESS_EXIT_CODE
	report_failure(request, result)

	return FAILURE_EXIT_CODE
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const run_pause_cli = { USAGE, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { run_pause_cli }
