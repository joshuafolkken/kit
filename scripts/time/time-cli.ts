#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { cost_transcript, type SessionFile } from '#scripts/cost/cost-transcript'
import { time_report, type TimeReport } from './time-report'
import { time_run } from './time-run'
import { time_spans } from './time-spans'

// `josh time` — where a run's wall clock went, read from Claude Code's own session transcripts and,
// for the part no transcript records, from GitHub (joshuafolkken/kit#1267, joshuafolkken/kit#1268).
//
// The wall-clock sibling of `josh cost`: same files, same discovery, the other axis. Discovery and
// reading come from `cost-transcript.ts` unchanged — a second copy of the slug rule is how one of
// the two commands quietly stops finding a project's transcripts.
//
// **The default scope is a run, not a session** (joshuafolkken/kit#1268). A `fullrun` is measured
// from its invocation to the merge, which spans sessions and reaches past the last transcript line;
// `--session <id>` still reports one session on its own.

const ARGV_OFFSET = 2
const FAILURE_EXIT_CODE = 1
const JSON_INDENT = 2
const USAGE = 'Usage: josh time [--issue <number>] [--session <id>] [--json]'
const NO_MERGED_RUN =
	'No merged pull request could be resolved, so there is no run to report on. Name one with --issue <number>, or a session with --session <id>.'
const BOTH_SCOPES = 'Give --issue or --session, not both: they name different things.'

interface Options {
	session?: string
	issue?: number
	is_json: boolean
}

// `exactOptionalPropertyTypes` rejects `{ session: undefined }`, so an absent flag contributes no
// key at all rather than an undefined one — the idiom `cost-cli.ts` uses for the same reason.
function optional_session(session: string | undefined): { session?: string } {
	return session === undefined ? {} : { session }
}

function optional_issue(issue: number | undefined): { issue?: number } {
	return issue === undefined ? {} : { issue }
}

const PARSE_ARGS_OPTIONS = {
	session: { type: 'string' },
	issue: { type: 'string' },
	json: { type: 'boolean', default: false },
} as const

// Only a positive number is an issue, the rule `cost-cli.ts` states: a non-positive value would
// collide with `cost_attribute`'s unattributed sentinel and report that bucket as though it were an
// issue's run.
function to_issue(raw: string | undefined): number | undefined {
	if (raw === undefined) return undefined

	const parsed = Number(raw)

	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

// A flag that was given but did not parse is a refusal, not an absent flag: `--issue abc` must not
// quietly become "report the most recent run instead". Naming both scopes at once is refused too —
// they are different questions, and answering one of them silently is the wrong of the two.
function is_refused(
	values: { issue?: string; session?: string },
	issue: number | undefined,
): boolean {
	if (issue === undefined) return values.issue !== undefined

	return values.session !== undefined
}

// An unknown flag is a refusal rather than a default: a misspelled `--session` must not quietly
// report some other scope's time as though it were the one that was asked for.
function parse_options(argv: ReadonlyArray<string>): Options | undefined {
	try {
		const { values } = parseArgs({ args: [...argv], options: PARSE_ARGS_OPTIONS, strict: true })
		const issue = to_issue(values.issue)

		if (is_refused(values, issue)) return undefined

		return { ...optional_session(values.session), ...optional_issue(issue), is_json: values.json }
	} catch {
		return undefined
	}
}

// `--issue 5` and `--issue=5` are the same flag. Matching only the space-separated form named the
// grammar instead of the mistake for the half of the users who write the other one.
function has_flag(argv: ReadonlyArray<string>, name: string): boolean {
	return argv.some((argument) => argument === name || argument.startsWith(`${name}=`))
}

// Why the options were refused, so the message names the mistake rather than only the grammar.
function usage_lines(argv: ReadonlyArray<string>): Array<string> {
	const has_both = has_flag(argv, '--issue') && has_flag(argv, '--session')

	return has_both ? [BOTH_SCOPES] : [USAGE]
}

function pick_session(cwd: string, session_id: string): SessionFile | undefined {
	return cost_transcript
		.list_sessions(cost_transcript.transcript_directory(cwd))
		.find((file) => file.session_id === session_id)
}

// An absent transcript is reported, never timed at zero. "No transcript was found" and "this run
// took no time" are different answers, and only one of them is ever true. The wording is
// `cost_transcript`'s — the same directory, so the same sentence.
function report_empty(cwd: string, session_id: string | undefined): number {
	const directory = cost_transcript.transcript_directory(cwd)

	for (const line of cost_transcript.missing_message(directory, session_id)) console.error(line)

	return FAILURE_EXIT_CODE
}

function build_session_report(file: SessionFile): TimeReport {
	return time_report.build_report(
		file.session_id,
		time_spans.parse_timeline(cost_transcript.read_raw(file)),
	)
}

function print_report(report: TimeReport, is_json: boolean): void {
	console.info(
		is_json ? JSON.stringify(report, undefined, JSON_INDENT) : time_report.format_report(report),
	)
}

function run_session(session_id: string, cwd: string, is_json: boolean): number {
	const file = pick_session(cwd, session_id)

	if (file === undefined) return report_empty(cwd, session_id)

	print_report(build_session_report(file), is_json)

	return 0
}

// The named issue, or the most recently merged run when none was named. The fallback is a real read
// rather than a guess — a repository with nothing merged is told so instead of being handed some
// other scope's figures — and it resolves the pull request and the report in one pass, so the pulls
// listing is paged once rather than twice.
async function build(issue: number | undefined, cwd: string): Promise<TimeReport | undefined> {
	if (issue === undefined) return await time_run.build_latest_run_report(cwd)

	return await time_run.build_run_report(issue, cwd)
}

async function run_issue(
	issue: number | undefined,
	cwd: string,
	is_json: boolean,
): Promise<number> {
	const report = await build(issue, cwd)

	if (report === undefined) {
		console.error(NO_MERGED_RUN)

		return FAILURE_EXIT_CODE
	}

	print_report(report, is_json)

	return 0
}

async function run(argv: ReadonlyArray<string>, cwd: string = process.cwd()): Promise<number> {
	const options = parse_options(argv)

	if (options === undefined) {
		for (const line of usage_lines(argv)) console.error(line)

		return FAILURE_EXIT_CODE
	}

	const { session } = options

	if (session !== undefined) return run_session(session, cwd, options.is_json)

	return await run_issue(options.issue, cwd, options.is_json)
}

// `process.exitCode` rather than `process.exit()`: the report is written with `console.info`, and
// `process.exit()` tears the process down before a pipe has drained — the same idiom, for the same
// reason, as `scripts/cost/cost-cli.ts`.
async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const time_cli = {
	USAGE,
	NO_MERGED_RUN,
	BOTH_SCOPES,
	parse_options,
	pick_session,
	report_empty,
	run,
	main,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) void main(process.argv.slice(ARGV_OFFSET))

export type { Options }
export { time_cli }
