import { fileURLToPath } from 'node:url'
import { RUN_LANE_LABEL, RUN_SOLO_LABEL } from '#scripts/issue/issue-labels'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { session_cite } from '#scripts/issue/session-cite'
import { cli_flags } from '#scripts/lib/cli-flags'
import { auto_ok_judge_read } from './auto-ok-judge-read'
import { auto_ok_judge_write } from './auto-ok-judge-write'

// `josh auto-ok:judge` — the open issues `backlogrun` judges for `auto-ok` when a lane is free and
// nothing is opted in (joshuafolkken/kit#3854), and the record of each judgement.
//
// Bare, it lists the issues that still owe a judgement: one number per line on stdout, or `none`, with
// each title on stderr. The agent reads each one's body and comments (`josh issue:read`) and answers
// with `--apply <N> --lane|--solo` or `--decline <N> --reason <text>`; which of the two is a reading of
// the issue, never this command's.

const ARGV_OFFSET = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const NONE_TOKEN = 'none'
const USAGE =
	'Usage: josh auto-ok:judge [--apply <N> (--lane | --solo) | --decline <N> --reason <text>]'

const OPTIONS = {
	apply: { type: 'string' },
	decline: { type: 'string' },
	lane: { type: 'boolean' },
	solo: { type: 'boolean' },
	reason: { type: 'string' },
} as const

type Values = NonNullable<ReturnType<typeof cli_flags.values_of<typeof OPTIONS>>>

type JudgeRequest =
	| { kind: 'list' }
	| { kind: 'apply'; issue: string; run_label: string }
	| { kind: 'decline'; issue: string; reason: string }

function run_label_of(values: Values): string | undefined {
	if (values.lane === values.solo) return undefined

	return values.lane === true ? RUN_LANE_LABEL : RUN_SOLO_LABEL
}

function apply_request(issue: string, values: Values): JudgeRequest | undefined {
	const run_label = run_label_of(values)

	return run_label === undefined ? undefined : { kind: 'apply', issue, run_label }
}

function decline_request(issue: string, values: Values): JudgeRequest | undefined {
	const reason = values.reason?.trim() ?? ''

	return reason === '' ? undefined : { kind: 'decline', issue, reason }
}

function request_of(values: Values): JudgeRequest | undefined {
	const issue = values.apply ?? values.decline

	if (issue === undefined) return { kind: 'list' }
	if (!issue_number_shape.is_issue_number(issue)) return undefined

	return values.apply === undefined ? decline_request(issue, values) : apply_request(issue, values)
}

function parse_request(argv: ReadonlyArray<string>): JudgeRequest | undefined {
	const values = cli_flags.values_of(argv, OPTIONS)

	if (values === undefined || (values.apply !== undefined && values.decline !== undefined)) {
		return undefined
	}

	return request_of(values)
}

async function list(): Promise<number> {
	const owed = await auto_ok_judge_read.owed()

	if (owed === undefined) {
		console.error('the open issues could not be read')

		return FAILURE_EXIT_CODE
	}

	if (owed.length === 0) console.info(NONE_TOKEN)

	for (const row of owed) {
		console.error(session_cite.issue(row.number, row.title))
		console.info(String(row.number))
	}

	return SUCCESS_EXIT_CODE
}

async function dispatch(request: JudgeRequest): Promise<number> {
	const { apply, decline } = auto_ok_judge_write

	if (request.kind === 'list') return await list()
	if (request.kind === 'decline') return await decline(request.issue, request.reason)

	return await apply(request.issue, request.run_label)
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const request = parse_request(argv)

	if (request === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	return await dispatch(request)
}

// `process.exitCode` rather than `process.exit()`, so the report on standard output drains first.
async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const auto_ok_judge_cli = { NONE_TOKEN, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { auto_ok_judge_cli }
