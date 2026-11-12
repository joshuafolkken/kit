#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { error_text } from '#scripts/lib/error-message'
import { lane_resolve } from './lane-resolve'
import { lane_resolve_record } from './lane-resolve-record'

// `josh lane:resolve <issue>` — the verdict line on standard output, exit 0; a refusal, an unreadable
// thread or a git failure on standard error, exit 1, so a caller never reads a half-judged merge.
// `--record [<path>...]` posts the resolution comment instead and prints `recorded <url>`.

const ARGV_OFFSET = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const RECORD_FLAG = '--record'
const USAGE = 'Usage: josh lane:resolve <issue-number> [--record [<path>...]]'

interface Request {
	issue: string
	paths: ReadonlyArray<string> | undefined
}

function request_of(argv: ReadonlyArray<string>): Request | undefined {
	const [issue = '', flag, ...paths] = argv

	if (!issue_number_shape.is_issue_number(issue)) return undefined
	if (flag === undefined) return { issue, paths: undefined }

	return flag === RECORD_FLAG ? { issue, paths } : undefined
}

function emit(outcome: { kind: 'refused'; message: string } | { line: string }): number {
	if ('line' in outcome) {
		console.info(outcome.line)

		return SUCCESS_EXIT_CODE
	}

	console.error(outcome.message)

	return FAILURE_EXIT_CODE
}

async function judge(issue: string): Promise<number> {
	const outcome = await lane_resolve.resolve(issue)

	if (outcome.kind === 'refused') return emit(outcome)

	return emit({ line: lane_resolve.verdict_line(outcome) })
}

async function record(issue: string, paths: ReadonlyArray<string>): Promise<number> {
	const outcome = await lane_resolve_record.record(issue, paths)

	if (outcome.kind === 'refused') return emit(outcome)

	return emit({ line: `${outcome.kind} ${outcome.url}` })
}

async function dispatch({ issue, paths }: Request): Promise<number> {
	return paths === undefined ? await judge(issue) : await record(issue, paths)
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const request = request_of(argv)

	if (request === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	try {
		return await dispatch(request)
	} catch (error) {
		console.error(error_text.message_of(error))

		return FAILURE_EXIT_CODE
	}
}

const lane_resolve_cli = { run }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await run(process.argv.slice(ARGV_OFFSET))
}

export { lane_resolve_cli }
