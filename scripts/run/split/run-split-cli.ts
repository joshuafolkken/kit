#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { session_cite } from '#scripts/issue/session-cite'
import { cli_flags } from '#scripts/lib/cli-flags'
import { run_split, type SplitRequest, type SplitResult } from './run-split'

// `josh run:split <N> --children <N1,N2,...> [--ordered] [--title <title>]` — the argument parsing
// and the report around `run-split.ts`. One line per step that landed, then the verdict line a run
// branches on: `epic #E` to continue against, or `needs-decision` to report. A failure names its step,
// what was already done, and that a rerun continues from there.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const USAGE = 'Usage: josh run:split <issue> --children <N1,N2,...> [--ordered] [--title <title>]'
const OPTIONS = {
	children: { type: 'string' },
	ordered: { type: 'boolean' },
	title: { type: 'string' },
} as const

// Every child has to be an issue number other than `#N`, each named once.
function children_of(value: string | undefined, issue: string): Array<string> | undefined {
	if (value === undefined) return undefined
	const children = value.split(',').map((child) => child.trim())
	const is_valid = children.every((child) => issue_number_shape.is_issue_number(child))
	const is_distinct = new Set([issue, ...children]).size === children.length + 1

	return is_valid && is_distinct ? children : undefined
}

function parse_request(argv: ReadonlyArray<string>): SplitRequest | undefined {
	const parsed = cli_flags.arguments_of(argv, OPTIONS)
	if (parsed === undefined) return undefined
	const issue = issue_number_shape.single_of(parsed.positionals)
	const children = issue === undefined ? undefined : children_of(parsed.values.children, issue)
	if (issue === undefined || children === undefined) return undefined
	const { ordered: is_ordered, title } = parsed.values

	return { issue, children, is_ordered: is_ordered === true, title }
}

function report_failure(result: SplitResult & { kind: 'failed' }): number {
	const steps = result.done.map(({ step }) => step).join(', ')

	console.error(`✖ ${result.step} failed: ${result.reason}`)
	console.error(`Done: ${steps.length === 0 ? 'nothing' : steps}.`)
	console.error(`Rerun the same \`pnpm josh run:split\` to continue from ${result.step}.`)

	return FAILURE_EXIT_CODE
}

// The verdict line a run branches on: the epic to continue against, or the park to report.
function report_verdict(result: SplitResult & { kind: 'epic' | 'needs-decision' }): number {
	console.info(result.kind === 'epic' ? `epic ${session_cite.issue(result.epic)}` : result.kind)

	return SUCCESS_EXIT_CODE
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const request = parse_request(argv)

	if (request === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const result = await run_split.split(request)

	for (const { step, detail } of result.done) console.info(`${step}: ${detail}`)

	return result.kind === 'failed' ? report_failure(result) : report_verdict(result)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const run_split_cli = { USAGE, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { run_split_cli }
