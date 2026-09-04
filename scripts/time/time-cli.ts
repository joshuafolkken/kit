#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { cost_transcript, type SessionFile } from '#scripts/cost/cost-transcript'
import { time_epic } from './time-epic'
import { time_epic_report } from './time-epic-report'
import { time_last } from './time-last'
import { time_last_report } from './time-last-report'
import { time_report, type TimeReport } from './time-report'
import { time_row_cap } from './time-row-cap'
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
// `--session <id>` still reports one session on its own, and `--epic <number>` reports a whole
// `epicrun` child by child (joshuafolkken/kit#1271).

const ARGV_OFFSET = 2
const FAILURE_EXIT_CODE = 1
const JSON_INDENT = 2
const USAGE =
	'Usage: josh time [--issue <number>] [--session <id>] [--epic <number>] [--last <runs>] [--top <rows>] [--json]'
const NO_MERGED_RUN =
	'No merged pull request could be resolved, so there is no run to report on. Name one with --issue <number>, or a session with --session <id>.'
const ONE_SCOPE = 'Give one of --issue, --session, --epic or --last: they name different things.'
const NO_EPIC =
	'The epic could not be read, so there is no batch to report on. Check the number, and that gh is authenticated.'
const NO_RUNS =
	'No merged run could be resolved, so there is no distribution to report. Check that the repository has merged pull requests whose branches name an issue, and that gh is authenticated.'

// Every scope is a present key whose value may be `undefined`, rather than a key that is absent.
// Under `exactOptionalPropertyTypes` an optional key rejects `{ session: undefined }`, so one shim
// per field would be needed to build this — three near-identical functions differing only in the key
// they name, which is the duplication a third scope would have made unmistakable.
interface Options {
	session: string | undefined
	issue: number | undefined
	epic: number | undefined
	// How many of the most recently merged runs to report the distribution across
	// (joshuafolkken/kit#1312). A scope like the three above, and refused alongside them.
	last: number | undefined
	// How many rows of the per-tool and per-`josh <cmd>` tables to carry, or `undefined` for all of
	// them (joshuafolkken/kit#1301). It is not a scope: it narrows whichever scope was asked for.
	top: number | undefined
	is_json: boolean
}

// What `print_scope` needs to know, which is how to render and how much to carry — never which scope
// produced the payload. Kept as a slice of `Options` rather than a second pair of parameters, so a
// third output-shaping flag reaches every scope by being added once.
type Output = Pick<Options, 'top' | 'is_json'>

const PARSE_ARGS_OPTIONS = {
	session: { type: 'string' },
	issue: { type: 'string' },
	epic: { type: 'string' },
	last: { type: 'string' },
	top: { type: 'string' },
	json: { type: 'boolean', default: false },
} as const

// The flags that name a scope, in both the spelling `parseArgs` reports and the spelling a person
// types. One list, so a fifth scope cannot be added to the parser and forgotten by the refusal.
const SCOPE_KEYS = ['issue', 'session', 'epic', 'last'] as const
const SCOPE_FLAGS = SCOPE_KEYS.map((key) => `--${key}`)

// Only a positive number is an issue number, the rule `cost-cli.ts` states: a non-positive value
// would collide with `cost_attribute`'s unattributed sentinel and report that bucket as though it
// were an issue's run. An epic is named the same way, so both go through this.
function to_number(raw: string | undefined): number | undefined {
	if (raw === undefined) return undefined

	const parsed = Number(raw)

	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

interface RawValues {
	issue?: string
	session?: string
	epic?: string
	last?: string
	top?: string
}

// The four flags that carry a number, parsed. Grouped so the refusal below asks one question of one
// record rather than growing a parameter per flag past the four-parameter limit.
interface ParsedNumbers {
	issue: number | undefined
	epic: number | undefined
	last: number | undefined
	top: number | undefined
}

// Every flag whose value is a number, listed once so a fifth one is refused when it does not parse
// by being added here rather than by being remembered in the condition below.
const NUMBER_KEYS = ['issue', 'epic', 'last', 'top'] as const

// A flag that was given but did not parse is a refusal, not an absent flag: `--issue abc` must not
// quietly become "report the most recent run instead".
function is_unparsed(raw: string | undefined, parsed: number | undefined): boolean {
	return raw !== undefined && parsed === undefined
}

function has_unparsed(values: RawValues, parsed: ParsedNumbers): boolean {
	return NUMBER_KEYS.some((key) => is_unparsed(values[key], parsed[key]))
}

function named_scopes(values: RawValues): number {
	return SCOPE_KEYS.filter((key) => values[key] !== undefined).length
}

// Naming more than one scope is refused too — they are different questions, and answering one of
// them silently is the wrong of the two.
// `--top 0` and `--top abc` are refused on the same rule the scope numbers are: a cap that did not
// parse must not quietly become "carry every row", which is the opposite of what was asked for.
// `--last 0` goes the same way: a distribution over no run is not a smaller answer, it is none.
function is_refused(values: RawValues, parsed: ParsedNumbers): boolean {
	if (has_unparsed(values, parsed)) return true

	return named_scopes(values) > 1
}

// An unknown flag is a refusal rather than a default: a misspelled `--session` must not quietly
// report some other scope's time as though it were the one that was asked for.
function parse_options(argv: ReadonlyArray<string>): Options | undefined {
	try {
		const { values } = parseArgs({ args: [...argv], options: PARSE_ARGS_OPTIONS, strict: true })
		const parsed = {
			issue: to_number(values.issue),
			epic: to_number(values.epic),
			last: to_number(values.last),
			top: to_number(values.top),
		}

		if (is_refused(values, parsed)) return undefined

		return { session: values.session, ...parsed, is_json: values.json }
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
	const named = SCOPE_FLAGS.filter((flag) => has_flag(argv, flag)).length

	return named > 1 ? [ONE_SCOPE] : [USAGE]
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

// The one place a report reaches stdout, whichever scope produced it. `--json` prints the whole
// record, so a scope that carries more than the text table shows — an epic's per-child breakdown —
// needs nothing of its own here.
function print_scope(payload: unknown, text: () => string, is_json: boolean): void {
	console.info(is_json ? JSON.stringify(payload, undefined, JSON_INDENT) : text())
}

// **The cap is applied to the record both outputs are made from, not to one of them.** Printing the
// whole report as JSON while the text table showed a capped one would make `--top` mean two different
// things depending on `--json`, and the note that says how many rows were withheld rides in `notes`,
// which both renderings already print.
function print_report(report: TimeReport, output: Output): void {
	const capped = time_row_cap.cap_report(report, output.top)

	print_scope(capped, () => time_report.format_report(capped), output.is_json)
}

function run_session(session_id: string, cwd: string, output: Output): number {
	const file = pick_session(cwd, session_id)

	if (file === undefined) return report_empty(cwd, session_id)

	print_report(build_session_report(file), output)

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

async function run_issue(issue: number | undefined, cwd: string, output: Output): Promise<number> {
	const report = await build(issue, cwd)

	if (report === undefined) {
		console.error(NO_MERGED_RUN)

		return FAILURE_EXIT_CODE
	}

	print_report(report, output)

	return 0
}

// An epic's whole batch, child by child. A failure here is the epic itself being unreadable — a
// child with no run of its own is reported as `not run` inside the table rather than failing it.
async function run_epic(epic_number: number, cwd: string, output: Output): Promise<number> {
	const report = await time_epic.build_epic_report(epic_number, cwd)

	if (report === undefined) {
		console.error(NO_EPIC)

		return FAILURE_EXIT_CODE
	}

	const capped = time_row_cap.cap_epic_report(report, output.top)

	print_scope(capped, () => time_epic_report.format_epic_report(capped), output.is_json)

	return 0
}

// The last N merged runs as a distribution. A failure here is that no merged run could be resolved at
// all — a run that merged with no transcript attributed is reported as such inside the table rather
// than failing it, exactly as an epic's child is.
async function run_last(count: number, cwd: string, output: Output): Promise<number> {
	const report = await time_last.build_last_report(count, cwd)

	if (report === undefined) {
		console.error(NO_RUNS)

		return FAILURE_EXIT_CODE
	}

	const capped = time_row_cap.cap_last_report(report, output.top)

	print_scope(capped, () => time_last_report.format_last_report(capped), output.is_json)

	return 0
}

async function dispatch(options: Options, cwd: string): Promise<number> {
	const { session, epic, last } = options

	if (session !== undefined) return run_session(session, cwd, options)
	if (epic !== undefined) return await run_epic(epic, cwd, options)
	if (last !== undefined) return await run_last(last, cwd, options)

	return await run_issue(options.issue, cwd, options)
}

async function run(argv: ReadonlyArray<string>, cwd: string = process.cwd()): Promise<number> {
	const options = parse_options(argv)

	if (options === undefined) {
		for (const line of usage_lines(argv)) console.error(line)

		return FAILURE_EXIT_CODE
	}

	return await dispatch(options, cwd)
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
	NO_EPIC,
	NO_RUNS,
	ONE_SCOPE,
	parse_options,
	pick_session,
	report_empty,
	run,
	main,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) void main(process.argv.slice(ARGV_OFFSET))

export type { Options }
export { time_cli }
