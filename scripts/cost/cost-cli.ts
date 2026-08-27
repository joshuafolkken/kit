#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { cost_attribute } from './cost-attribute'
import { cost_report, type CostReport, type MissingData } from './cost-report'
import { cost_transcript, type SessionUsage } from './cost-transcript'
import type { UsageRecord } from './cost-usage'

// `josh cost` — what a run actually spent, read from Claude Code's own session transcripts
// (joshuafolkken/kit#962).

const ARGV_OFFSET = 2
const FAILURE_EXIT_CODE = 1
const JSON_INDENT = 2
const USAGE = 'Usage: josh cost [--session <id>] [--issue <number>] [--all] [--json]'

interface Options {
	session?: string
	issue?: number
	is_all: boolean
	is_json: boolean
}

interface RawValues {
	session?: string | undefined
	issue?: string | undefined
	all?: boolean | undefined
	json?: boolean | undefined
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

function optional_session(session: string | undefined): { session?: string } {
	return session === undefined ? {} : { session }
}

function optional_issue(issue: number | undefined): { issue?: number } {
	return issue === undefined ? {} : { issue }
}

function to_options(values: RawValues): Options | undefined {
	const issue = to_issue(values.issue)

	if (issue === undefined && values.issue !== undefined) return undefined

	return {
		...optional_session(values.session),
		...optional_issue(issue),
		is_all: values.all ?? false,
		is_json: values.json ?? false,
	}
}

const PARSE_ARGS_OPTIONS = {
	session: { type: 'string' },
	issue: { type: 'string' },
	all: { type: 'boolean', default: false },
	json: { type: 'boolean', default: false },
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

interface Corpus {
	sessions: Array<SessionUsage>
	missing: MissingData
}

function accumulate_missing(sessions: ReadonlyArray<SessionUsage>): MissingData {
	return {
		no_usage_lines: sessions.reduce((sum, session) => sum + session.no_usage_lines, 0),
		malformed_lines: sessions.reduce((sum, session) => sum + session.malformed_lines, 0),
		unreadable_sessions: sessions.filter((session) => !session.is_readable).length,
	}
}

// Every session for this project, newest first. A `--session` narrows it here rather than in each
// caller, so "that session does not exist" is one answer instead of three.
function load_corpus(cwd: string, session_id?: string): Corpus {
	const files = cost_transcript.list_sessions(cost_transcript.transcript_directory(cwd))
	const wanted =
		session_id === undefined ? files : files.filter((file) => file.session_id === session_id)
	const sessions = wanted.map((file) => cost_transcript.read_session(file))

	return { sessions, missing: accumulate_missing(sessions) }
}

// One session — the newest by default, which is "the run that just finished".
//
// Its missing counts are the session's own, never the corpus's. A malformed line in some unrelated
// session is not missing data about *this* one, and reporting it as such attributes a defect to the
// wrong run — the same misreading, one level up, that this command exists to stop.
function report_session(corpus: Corpus): CostReport | undefined {
	const [session] = corpus.sessions

	if (session === undefined) return undefined

	return cost_report.build_report({
		scope: `session ${session.session_id}`,
		records: session.records,
		missing: accumulate_missing([session]),
		resident_billed_tokens: session.baseline_tokens * session.records.length,
	})
}

interface AttributedRecord {
	record: UsageRecord
	issue: number
	// The resident baseline of the session this record was read from. Carried per record because a
	// scope that spans sessions has no single baseline, and the first record of a *filtered* set is
	// a warm mid-session request rather than a preamble — reading it as one reported an issue as
	// 86.5% resident against a real session's 27.7%.
	baseline_tokens: number
}

// Attribution is per session, because the branch sequence a session walks is what carries the
// mapping; concatenating sessions first would let one session's trailing branch attribute the next
// session's opening requests.
function attributed_per_session(corpus: Corpus): Array<AttributedRecord> {
	return corpus.sessions.flatMap((session) =>
		cost_attribute.group_by_issue(session.records).flatMap((group) =>
			group.records.map((record) => ({
				record,
				issue: group.issue,
				baseline_tokens: session.baseline_tokens,
			})),
		),
	)
}

// An occurrence carrying an issue beats one that does not. A copy written before the branch existed
// has nothing to attribute it to, so keeping it would move a real request into `unattributed`.
function is_better(candidate: AttributedRecord, existing: AttributedRecord): boolean {
	const { UNATTRIBUTED_KEY } = cost_attribute

	return existing.issue === UNATTRIBUTED_KEY && candidate.issue !== UNATTRIBUTED_KEY
}

function values_of(best: ReadonlyMap<string, AttributedRecord>): Array<AttributedRecord> {
	const collected: Array<AttributedRecord> = []

	for (const [, pair] of best) collected.push(pair)

	return collected
}

// **Dedupe again, across sessions.** Resuming or forking a session copies the earlier lines into a
// new transcript file, so one billed request appears in several — 152 such request ids in this
// repository's own transcripts, some in three files. Per-session dedup does not see them, and every
// scope spanning more than one session would bill those requests twice or three times.
function dedupe_across_sessions(pairs: ReadonlyArray<AttributedRecord>): Array<AttributedRecord> {
	const best = new Map<string, AttributedRecord>()

	for (const pair of pairs) {
		const existing = best.get(pair.record.request_id)

		if (existing === undefined || is_better(pair, existing)) {
			best.set(pair.record.request_id, pair)
		}
	}

	return values_of(best)
}

function attributed(corpus: Corpus): Array<AttributedRecord> {
	return dedupe_across_sessions(attributed_per_session(corpus))
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

function report_issue(corpus: Corpus, issue_number: number): CostReport {
	const pairs = attributed(corpus).filter((pair) => pair.issue === issue_number)

	return to_scope_report(scope_label(issue_number), pairs, corpus.missing)
}

function report_all(corpus: Corpus): Array<CostReport> {
	const merged = new Map<number, Array<AttributedRecord>>()

	for (const pair of attributed(corpus)) {
		merged.set(pair.issue, [...(merged.get(pair.issue) ?? []), pair])
	}

	return [...merged]
		.toSorted(([left], [right]) => left - right)
		.map(([key, pairs]) => to_scope_report(scope_label(key), pairs, corpus.missing))
}

// The empty check is made once, for every scope. `--all` and `--issue` used to answer an absent
// transcript directory with an empty listing and a zero-cost issue — exit 0 either way, which is
// exactly the silent zero this command exists to remove.
function build_reports(options: Options, corpus: Corpus): Array<CostReport> | undefined {
	if (corpus.sessions.length === 0) return undefined
	if (options.is_all) return report_all(corpus)
	if (options.issue !== undefined) return [report_issue(corpus, options.issue)]

	const single = report_session(corpus)

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
// free" are different answers, and only one of them is ever true.
function report_empty(cwd: string, session_id: string | undefined): number {
	const directory = cost_transcript.transcript_directory(cwd)

	if (session_id === undefined) {
		console.error(`No transcripts found under ${directory}`)
		console.error('Claude Code writes them per project; run this from the project it ran in.')
	} else {
		console.error(`No transcript named ${session_id} under ${directory}`)
	}

	return FAILURE_EXIT_CODE
}

function run(argv: ReadonlyArray<string>, cwd: string = process.cwd()): number {
	const options = parse_options(argv)

	if (options === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const reports = build_reports(options, load_corpus(cwd, options.session))

	if (reports === undefined) return report_empty(cwd, options.session)

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
	load_corpus,
	report_session,
	report_issue,
	report_all,
	attributed,
	build_reports,
	run,
	main,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(ARGV_OFFSET))

export type { Options }
export { cost_cli }
