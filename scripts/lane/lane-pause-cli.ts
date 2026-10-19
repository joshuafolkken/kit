#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { issue_cite } from '#scripts/issue/issue-cite'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { lane_pause } from './lane-pause'

// `josh lane:pause <issue> | --all` and `josh lane:resume <issue> | --all` — one script told apart by
// the verb the registry passes first. A named lane with no child process to signal exits non-zero, so a
// caller never takes a pause that stopped nothing as done.

const ARGV_OFFSET = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ALL_FLAG = '--all'
const USAGE = [
	'Usage: josh lane:pause <issue-number> | josh lane:pause --all',
	'       josh lane:resume <issue-number> | josh lane:resume --all',
].join('\n')

const VERBS = {
	pause: { act: 'pause_lane', done: 'paused' },
	resume: { act: 'resume_lane', done: 'resumed' },
} as const

type Verb = keyof typeof VERBS

function is_verb(value: string | undefined): value is Verb {
	return value === 'pause' || value === 'resume'
}

async function issues_of(target: ReadonlyArray<string>): Promise<Array<string> | undefined> {
	const [issue, ...rest] = target

	if (issue === undefined || rest.length > 0) return undefined
	if (issue === ALL_FLAG) return await lane_pause.open_issues()

	return issue_number_shape.is_issue_number(issue) ? [issue] : undefined
}

// One line per lane: how many of its processes were signalled.
function report(verb: Verb, issue: string, pids: ReadonlyArray<number>): void {
	const lane = `lane:${verb} ${issue_cite.plain(issue)}`
	const { done } = VERBS[verb]
	const outcome =
		pids.length === 0
			? `no child process running — nothing ${done}`
			: `${done} ${String(pids.length)} process(es)`

	console.info(`${lane}: ${outcome}`)
}

function apply(verb: Verb, issues: ReadonlyArray<string>, is_named: boolean): number {
	const signalled = issues.map((issue) => {
		const pids = lane_pause[VERBS[verb].act](issue)

		report(verb, issue, pids)

		return pids.length
	})

	return is_named && signalled.includes(0) ? FAILURE_EXIT_CODE : SUCCESS_EXIT_CODE
}

function report_usage(): number {
	console.error(USAGE)

	return FAILURE_EXIT_CODE
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const [verb, ...target] = argv
	if (!is_verb(verb)) return report_usage()
	const issues = await issues_of(target)

	return issues === undefined ? report_usage() : apply(verb, issues, target[0] !== ALL_FLAG)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const lane_pause_cli = { run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { lane_pause_cli }
