#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { cost_attribute } from './cost-attribute'
import { cost_blocks } from './cost-blocks'
import { cost_composition } from './cost-composition'
import { cost_corpus, type AttributedRecord, type Corpus } from './cost-corpus'
import { cost_report, type CostReport, type Measurement, type MissingData } from './cost-report'
import { cost_resident } from './cost-resident'
import { cost_transcript, type SessionFile, type SessionUsage } from './cost-transcript'
import { cost_usage } from './cost-usage'

// `josh cost` — what a run actually spent, read from Claude Code's own session transcripts
// (joshuafolkken/kit#962).

const ARGV_OFFSET = 2
const FAILURE_EXIT_CODE = 1
const JSON_INDENT = 2
const USAGE =
	'Usage: josh cost [--session <id>] [--issue <number>] [--all] [--json] [--over <tokens-per-request>]'

// What a turn costs is decided by the accumulated preamble, not by what the turn does, so the
// marginal cost of a session is its billed input divided by the requests that paid for it. Measured
// across one `epicrun` that ran six children in one context: 222k per request during the first
// child, 645k during the sixth — the same work at 2.9x the price (joshuafolkken/kit#968).
//
// Per request rather than in total, because the total only says the session was long. The ratio
// says what the *next* turn will cost, which is the thing a hand-off decision turns on.
const OVER_VERDICT = 'over'
const UNDER_VERDICT = 'under'

interface Options {
	session?: string
	issue?: number
	is_all: boolean
	is_json: boolean
	over?: number
}

interface RawValues {
	session?: string | undefined
	issue?: string | undefined
	all?: boolean | undefined
	json?: boolean | undefined
	over?: string | undefined
}

// `exactOptionalPropertyTypes` rejects `{ issue: undefined }`, so an absent flag contributes no key
// at all rather than an undefined one.
//
// Only a positive number is an issue. `--issue=-1` would otherwise collide with `UNATTRIBUTED_KEY`
// and print the unattributed bucket as though it were an issue's cost.
function to_issue(raw: string | undefined): number | undefined {
	if (raw === undefined) return undefined

	const parsed = Number(raw)

	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

// A threshold of 0 is a legitimate limit — "hand off after any request at all" — so it does not
// share `to_issue`'s positive-only rule, which exists because issue numbers cannot collide with
// `UNATTRIBUTED_KEY`. Negative is still refused: there is no such thing as a negative cost.
function to_threshold(raw: string | undefined): number | undefined {
	if (raw === undefined) return undefined

	// `Number('')` is 0, and 0 is a legitimate threshold here — so an empty value would arrive as
	// "hand off after any request at all" and an unattended run would hand off after its first
	// child, with nothing reported. `to_issue` escapes this only by its incidental positive-only
	// rule; this one has to say so.
	if (raw.trim() === '') return undefined

	const parsed = Number(raw)

	return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined
}

function optional_session(session: string | undefined): { session?: string } {
	return session === undefined ? {} : { session }
}

function optional_issue(issue: number | undefined): { issue?: number } {
	return issue === undefined ? {} : { issue }
}

function optional_over(over: number | undefined): { over?: number } {
	return over === undefined ? {} : { over }
}

// A flag that was given but did not parse is a refusal, not an absent flag: `--issue abc` must not
// silently become "no issue".
function is_unparsed(raw: string | undefined, parsed: number | undefined): boolean {
	return parsed === undefined && raw !== undefined
}

// `--over` answers "what will the next turn of *this session* cost". A scope flag would have it
// answer for one issue's slice instead, which is a different number and not the one the hand-off
// rule is written against, and `--json` would promise a JSON caller a document it never prints — so
// every such combination is refused rather than silently reinterpreted.
function is_scoped(values: RawValues, issue: number | undefined): boolean {
	return issue !== undefined || values.all === true || values.json === true
}

function is_refused(
	values: RawValues,
	issue: number | undefined,
	over: number | undefined,
): boolean {
	if (is_unparsed(values.issue, issue) || is_unparsed(values.over, over)) return true

	return over !== undefined && is_scoped(values, issue)
}

function to_options(values: RawValues): Options | undefined {
	const issue = to_issue(values.issue)
	const over = to_threshold(values.over)

	if (is_refused(values, issue, over)) return undefined

	return {
		...optional_session(values.session),
		...optional_issue(issue),
		...optional_over(over),
		is_all: values.all ?? false,
		is_json: values.json ?? false,
	}
}

const PARSE_ARGS_OPTIONS = {
	session: { type: 'string' },
	issue: { type: 'string' },
	all: { type: 'boolean', default: false },
	json: { type: 'boolean', default: false },
	over: { type: 'string' },
} as const

function parse_options(argv: ReadonlyArray<string>): Options | undefined {
	try {
		const { values } = parseArgs({ args: [...argv], options: PARSE_ARGS_OPTIONS, strict: true })

		return to_options(values)
	} catch {
		return undefined
	}
}

function scope_label(key: number): string {
	return key === cost_attribute.UNATTRIBUTED_KEY ? 'unattributed' : `issue #${String(key)}`
}

// The resident and context decompositions for one whole session. Built here rather than in
// `build_report` because only this scope has a transcript file to read them from.
function build_measurement(cwd: string, file: SessionFile, session: SessionUsage): Measurement {
	const blocks = cost_blocks.parse_content(cost_transcript.read_raw(file))

	return {
		resident: cost_resident.build(cwd, session.baseline_tokens),
		composition: cost_composition.build(
			blocks,
			cost_usage.sum_totals(session.records).thinking_tokens,
		),
	}
}

// A session with no readable request has a baseline of 0, and a breakdown against a baseline of 0
// is a table of estimates beside a measurement that was never made — "this could not be read"
// dressed as a reading. The text report already says so through `format_empty`; this keeps `--json`
// from saying otherwise.
function optional_measurement(
	cwd: string,
	file: SessionFile,
	session: SessionUsage,
): { measurement?: Measurement } {
	if (session.records.length === 0) return {}

	return { measurement: build_measurement(cwd, file, session) }
}

// One session — the newest by default, which is "the run that just finished". Which of the listing
// that is is `cost_transcript`'s to say, because a delegated unit is part of a run rather than a run
// of its own and it writes the newer file whenever a session delegates (joshuafolkken/kit#1285).
//
// Its missing counts are the session's own, never the corpus's. A malformed line in some unrelated
// session is not missing data about *this* one, and reporting it as such attributes a defect to the
// wrong run — the same misreading, one level up, that this command exists to stop.
function report_session(corpus: Corpus, cwd: string): CostReport | undefined {
	const index = cost_transcript.latest_own_index(corpus.files)
	const session = corpus.sessions[index]
	const file = corpus.files[index]

	if (session === undefined || file === undefined) return undefined

	return cost_report.build_report({
		scope: `session ${session.session_id}`,
		records: session.records,
		missing: cost_corpus.accumulate_missing([session]),
		resident_billed_tokens: session.baseline_tokens * session.records.length,
		...optional_measurement(cwd, file, session),
	})
}

// One issue, across every session that touched it. A child implemented over two sessions — an
// interrupted run resumed later — would otherwise be reported at half its cost.
//
// Here the corpus-wide missing counts *are* the right ones: a line that could not be read carries no
// branch, so there is no way to rule out that it belonged to this issue.
// Each contributing session's own baseline, times the records it contributed. That is what the
// scope actually paid to re-read the resident preamble, and it is the only form that survives a
// scope spanning several sessions.
function to_scope_report(
	label: string,
	pairs: ReadonlyArray<AttributedRecord>,
	missing: MissingData,
): CostReport {
	return cost_report.build_report({
		scope: label,
		records: pairs.map((pair) => pair.record),
		missing,
		resident_billed_tokens: pairs.reduce((sum, pair) => sum + pair.baseline_tokens, 0),
	})
}

// An issue scope is the one place a unit that could not follow its parent disappears — in `--all` it
// still shows in the `unattributed` bucket — so the count is merged into `missing` here alone, marking
// `cost_usd` a floor exactly as `unpriced_models` does.
function with_unattributed(missing: MissingData, unattributed_units: number): MissingData {
	return { ...missing, unattributed_sessions: unattributed_units }
}

function report_issue(corpus: Corpus, issue_number: number): CostReport {
	const attribution = cost_corpus.attribute_corpus(corpus)
	const pairs = cost_corpus
		.dedupe_across_sessions(attribution.pairs)
		.filter((pair) => pair.issue === issue_number)
	const floor = cost_corpus.floor_for_issue(attribution.unattributed, issue_number)
	const missing = with_unattributed(corpus.missing, floor)

	return to_scope_report(scope_label(issue_number), pairs, missing)
}

function report_all(corpus: Corpus): Array<CostReport> {
	const merged = new Map<number, Array<AttributedRecord>>()

	for (const pair of cost_corpus.attributed(corpus)) {
		merged.set(pair.issue, [...(merged.get(pair.issue) ?? []), pair])
	}

	return [...merged]
		.toSorted(([left], [right]) => left - right)
		.map(([key, pairs]) => to_scope_report(scope_label(key), pairs, corpus.missing))
}

// The empty check is made once, for every scope. `--all` and `--issue` used to answer an absent
// transcript directory with an empty listing and a zero-cost issue — exit 0 either way, which is
// exactly the silent zero this command exists to remove.
function build_reports(
	options: Options,
	corpus: Corpus,
	cwd: string,
): Array<CostReport> | undefined {
	if (corpus.sessions.length === 0) return undefined
	if (options.is_all) return report_all(corpus)
	if (options.issue !== undefined) return [report_issue(corpus, options.issue)]

	const single = report_session(corpus, cwd)

	return single === undefined ? undefined : [single]
}

function print_reports(reports: ReadonlyArray<CostReport>, is_json: boolean): void {
	if (is_json) {
		console.info(JSON.stringify(reports, undefined, JSON_INDENT))

		return
	}

	console.info(reports.map((report) => cost_report.format_report(report)).join('\n\n'))
	if (reports.length > 1) console.info(`\n${cost_report.format_totals_line(reports)}`)
}

// An empty corpus is reported, never priced at zero. "No transcript was found" and "this run was
// free" are different answers, and only one of them is ever true. The wording is
// `cost_transcript`'s, so `josh time` says the same thing about the same directory.
function report_empty(cwd: string, session_id: string | undefined): number {
	const directory = cost_transcript.transcript_directory(cwd)

	for (const line of cost_transcript.missing_message(directory, session_id)) console.error(line)

	return FAILURE_EXIT_CODE
}

// The marginal cost of the next turn, in billed input tokens. Zero requests answers 0 rather than
// dividing by none — a session that has not asked anything yet has nothing to hand off.
function per_request_cost(report: CostReport): number {
	if (report.request_count === 0) return 0

	return Math.round(report.breakdown.billed_input_tokens / report.request_count)
}

// A verdict, not a table: the point of the flag is that the hand-off is decided by a number rather
// than by whether the run feels long, which is a judgement made under exactly the pressure that
// resolves it the wrong way.
function report_over(reports: ReadonlyArray<CostReport>, limit: number): number {
	const [report] = reports

	if (report === undefined) return FAILURE_EXIT_CODE

	if (report.request_count === 0) {
		console.error('No requests in this session; there is nothing to hand off.')

		return FAILURE_EXIT_CODE
	}

	const cost = per_request_cost(report)

	console.info(cost > limit ? OVER_VERDICT : UNDER_VERDICT)
	console.error(
		`${String(cost)} billed input tokens per request over ${String(report.request_count)} request(s); limit ${String(limit)}`,
	)

	return 0
}

// The session's checkout rather than this process's, for the reason `time-cli.ts` gives: a lane's
// commands run in a work tree no session ever wrote a transcript from (joshuafolkken/kit#1617).
function run(
	argv: ReadonlyArray<string>,
	cwd: string = cost_transcript.session_cwd(process.cwd()),
): number {
	const options = parse_options(argv)

	if (options === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const reports = build_reports(options, cost_corpus.load_corpus(cwd, options.session), cwd)

	if (reports === undefined) return report_empty(cwd, options.session)
	if (options.over !== undefined) return report_over(reports, options.over)

	print_reports(reports, options.is_json)

	return 0
}

// `process.exitCode` rather than `process.exit()`: the report is written with `console.info`, and
// `process.exit()` tears the process down before a pipe has drained — `--all --json | cat` lost
// everything past the 64KB pipe buffer and produced JSON that would not parse. The same idiom, for
// the same reason, is in `scripts/verification-gate.ts` and `scripts/lint-parallel.ts`.
function main(argv: ReadonlyArray<string>): void {
	process.exitCode = run(argv)
}

const cost_cli = {
	USAGE,
	parse_options,
	load_corpus: cost_corpus.load_corpus,
	report_session,
	report_issue,
	report_all,
	attributed: cost_corpus.attributed,
	to_threshold,
	per_request_cost,
	report_over,
	build_reports,
	run,
	main,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(ARGV_OFFSET))

export type { Options }
export { cost_cli }
