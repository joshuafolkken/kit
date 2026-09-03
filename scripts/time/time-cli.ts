#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { cost_transcript, type SessionFile } from '#scripts/cost/cost-transcript'
import { time_report, type TimeReport } from './time-report'
import { time_spans } from './time-spans'

// `josh time` — where a run's wall clock went, read from Claude Code's own session transcripts
// (joshuafolkken/kit#1267).
//
// The wall-clock sibling of `josh cost`: same files, same discovery, the other axis. Discovery and
// reading come from `cost-transcript.ts` unchanged — a second copy of the slug rule is how one of
// the two commands quietly stops finding a project's transcripts.

const ARGV_OFFSET = 2
const FAILURE_EXIT_CODE = 1
const JSON_INDENT = 2
const USAGE = 'Usage: josh time [--session <id>] [--json]'

interface Options {
	session?: string
	is_json: boolean
}

// `exactOptionalPropertyTypes` rejects `{ session: undefined }`, so an absent flag contributes no
// key at all rather than an undefined one — the idiom `cost-cli.ts` uses for the same reason.
function optional_session(session: string | undefined): { session?: string } {
	return session === undefined ? {} : { session }
}

const PARSE_ARGS_OPTIONS = {
	session: { type: 'string' },
	json: { type: 'boolean', default: false },
} as const

// An unknown flag is a refusal rather than a default: a misspelled `--session` must not quietly
// report the newest session's time as though it were the one that was asked for.
function parse_options(argv: ReadonlyArray<string>): Options | undefined {
	try {
		const { values } = parseArgs({ args: [...argv], options: PARSE_ARGS_OPTIONS, strict: true })

		return { ...optional_session(values.session), is_json: values.json }
	} catch {
		return undefined
	}
}

// The newest session by default, which is "the run that just finished" — `cost_transcript` already
// sorts them that way.
function pick_session(cwd: string, session_id: string | undefined): SessionFile | undefined {
	const files = cost_transcript.list_sessions(cost_transcript.transcript_directory(cwd))

	if (session_id === undefined) return files[0]

	return files.find((file) => file.session_id === session_id)
}

// An absent transcript is reported, never timed at zero. "No transcript was found" and "this run
// took no time" are different answers, and only one of them is ever true. The wording is
// `cost_transcript`'s — the same directory, so the same sentence.
function report_empty(cwd: string, session_id: string | undefined): number {
	const directory = cost_transcript.transcript_directory(cwd)

	for (const line of cost_transcript.missing_message(directory, session_id)) console.error(line)

	return FAILURE_EXIT_CODE
}

function build(file: SessionFile): TimeReport {
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

function run(argv: ReadonlyArray<string>, cwd: string = process.cwd()): number {
	const options = parse_options(argv)

	if (options === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const file = pick_session(cwd, options.session)

	if (file === undefined) return report_empty(cwd, options.session)

	print_report(build(file), options.is_json)

	return 0
}

// `process.exitCode` rather than `process.exit()`: the report is written with `console.info`, and
// `process.exit()` tears the process down before a pipe has drained — the same idiom, for the same
// reason, as `scripts/cost/cost-cli.ts`.
function main(argv: ReadonlyArray<string>): void {
	process.exitCode = run(argv)
}

const time_cli = {
	USAGE,
	parse_options,
	pick_session,
	report_empty,
	run,
	main,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(ARGV_OFFSET))

export type { Options }
export { time_cli }
