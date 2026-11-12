#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { session_cite } from '#scripts/issue/session-cite'
import { cli_flags } from '#scripts/lib/cli-flags'
import { run_split, type SplitRequest, type SplitResult } from './run-split'
import { run_split_prerequisite, type PrerequisiteRequest } from './run-split-prerequisite'

// `josh run:split <N> --children <N1,N2,...> [--ordered] [--title <title>]` and
// `josh run:split <N> --prerequisite <P> [--title <title>]` — the argument parsing and the report
// around `run-split.ts` and `run-split-prerequisite.ts`. One line per step that landed, then the
// verdict line a run branches on: `epic #E` to continue against, or `needs-decision` to report. A
// failure names its step, what was already done, and that a rerun continues from there.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const USAGE = [
	'Usage: josh run:split <issue> --children <N1,N2,...> [--ordered] [--title <title>]',
	'       josh run:split <issue> --prerequisite <P> [--title <title>]',
].join('\n')
const OPTIONS = {
	children: { type: 'string' },
	prerequisite: { type: 'string' },
	ordered: { type: 'boolean' },
	title: { type: 'string' },
} as const

type Request = SplitRequest | PrerequisiteRequest

// Every child has to be an issue number other than `#N`, each named once.
function children_of(value: string | undefined, issue: string): Array<string> | undefined {
	if (value === undefined) return undefined
	const children = value.split(',').map((child) => child.trim())
	const is_valid = children.every((child) => issue_number_shape.is_issue_number(child))
	const is_distinct = new Set([issue, ...children]).size === children.length + 1

	return is_valid && is_distinct ? children : undefined
}

interface Values {
	children?: string | undefined
	prerequisite?: string | undefined
	ordered?: boolean | undefined
	title?: string | undefined
}

function children_request(issue: string, values: Values): Request | undefined {
	const children = children_of(values.children, issue)
	if (children === undefined) return undefined
	const is_ordered = values.ordered === true

	return { issue, children, is_ordered, title: values.title }
}

// `--prerequisite` takes neither `--children` nor `--ordered`: the order is always `#P` first.
function prerequisite_request(
	issue: string,
	prerequisite: string,
	values: Values,
): Request | undefined {
	const is_alone = values.children === undefined && values.ordered !== true
	const is_valid = issue_number_shape.is_issue_number(prerequisite) && prerequisite !== issue
	if (!is_alone || !is_valid) return undefined

	return { issue, prerequisite, title: values.title }
}

function parse_request(argv: ReadonlyArray<string>): Request | undefined {
	const parsed = cli_flags.arguments_of(argv, OPTIONS)
	if (parsed === undefined) return undefined
	const issue = issue_number_shape.single_of(parsed.positionals)
	if (issue === undefined) return undefined
	const { values } = parsed
	if (values.prerequisite === undefined) return children_request(issue, values)

	return prerequisite_request(issue, values.prerequisite, values)
}

async function result_of(request: Request): Promise<SplitResult> {
	if ('prerequisite' in request) return await run_split_prerequisite.prerequisite(request)

	return await run_split.split(request)
}

// A missing `--title` is refused before any write, so the same command would only refuse again.
function rerun_hint(step: string): string {
	if (step === 'title') return 'Rerun with `--title <title>`.'

	return `Rerun the same \`pnpm josh run:split\` to continue from ${step}.`
}

function report_failure(result: SplitResult & { kind: 'failed' }): number {
	const steps = result.done.map(({ step }) => step).join(', ')

	console.error(`✖ ${result.step} failed: ${result.reason}`)
	console.error(`Done: ${steps.length === 0 ? 'nothing' : steps}.`)
	console.error(rerun_hint(result.step))

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

	const result = await result_of(request)

	for (const { step, detail } of result.done) console.info(`${step}: ${detail}`)

	return result.kind === 'failed' ? report_failure(result) : report_verdict(result)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const run_split_cli = { USAGE, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { run_split_cli }
