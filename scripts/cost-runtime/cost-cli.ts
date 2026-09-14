#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { cost_corpus, type Corpus } from './cost-corpus'
import { cost_curve } from './cost-curve'
import { cost_optional } from './cost-optional'
import { cost_run_scope } from './cost-run-scope'
import { cost_transcript } from './cost-transcript'
import { cost_usage, type UsageRecord } from './cost-usage'
import { cost_verdict, type OverMeasurement } from './cost-verdict'
import { transcript_cwd } from './transcript-cwd'

// `josh cost` — what a run actually spent, read from Claude Code's own session transcripts
// (joshuafolkken/kit#962).
//
// This is the distributed entry: it parses the flags, answers the `--over` / `--cap` verdicts from a
// light path that never leaves the runtime modules, and reaches the kit-only report path
// (`cost-report-cli`) through a dynamic import so those report modules stay out of its static import
// closure (joshuafolkken/kit#1996).

const ARGV_OFFSET = 2
const FAILURE_EXIT_CODE = 1
const USAGE =
	'Usage: josh cost [--run] [--session <id>] [--issue <number>] [--all] [--json] [--over <tokens-per-request>] [--cap <tokens-per-request>]'

interface Options {
	session?: string
	issue?: number
	is_all: boolean
	is_json: boolean
	// Whether the run-tree scope was named. It is also the bare no-argument default — `josh cost` with
	// no scope reports the last run tree rather than the newest single transcript (joshuafolkken/kit#1937).
	is_run: boolean
	over?: number
	cap?: number
	// The target project whose transcripts to read, or absent for this process's own working directory
	// (joshuafolkken/kit#1987). Not a scope: it says *where* to read, so it narrows nothing and is
	// refused alongside no flag. From the kit checkout, `--path <dir>` reads another project's cost.
	path?: string
}

interface RawValues {
	session?: string | undefined
	issue?: string | undefined
	all?: boolean | undefined
	json?: boolean | undefined
	run?: boolean | undefined
	over?: string | undefined
	cap?: string | undefined
	path?: string | undefined
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

function has_unparsed(
	values: RawValues,
	issue: number | undefined,
	over: number | undefined,
	cap: number | undefined,
): boolean {
	return (
		is_unparsed(values.issue, issue) ||
		is_unparsed(values.over, over) ||
		is_unparsed(values.cap, cap)
	)
}

// `--cap` is a whole-run counterfactual, so it may narrow to `--issue` and may print as `--json`;
// what it may not do is share an invocation with `--all` (which report's ratio?) or with `--over`
// (two different verdicts on one run).
function is_cap_conflict(
	values: RawValues,
	over: number | undefined,
	cap: number | undefined,
): boolean {
	return cap !== undefined && (values.all === true || over !== undefined)
}

function is_refused(
	values: RawValues,
	issue: number | undefined,
	over: number | undefined,
	cap: number | undefined,
): boolean {
	const competing = [issue !== undefined, values.session !== undefined, values.all === true]

	if (has_unparsed(values, issue, over, cap)) return true
	if (over !== undefined && is_scoped(values, issue)) return true

	if (
		cost_run_scope.is_conflict(values.run === true, [
			...competing,
			over !== undefined,
			cap !== undefined,
		])
	) {
		return true
	}

	return is_cap_conflict(values, over, cap)
}

function to_options(values: RawValues): Options | undefined {
	const issue = to_issue(values.issue)
	const over = to_threshold(values.over)
	const cap = to_threshold(values.cap)

	if (is_refused(values, issue, over, cap)) return undefined

	return {
		...cost_optional.session(values.session),
		...cost_optional.issue(issue),
		...cost_optional.over(over),
		...cost_optional.cap(cap),
		...cost_optional.target_path(values.path),
		is_all: values.all ?? false,
		is_json: values.json ?? false,
		is_run: values.run ?? false,
	}
}

const PARSE_ARGS_OPTIONS = {
	session: { type: 'string' },
	issue: { type: 'string' },
	all: { type: 'boolean', default: false },
	json: { type: 'boolean', default: false },
	run: { type: 'boolean', default: false },
	over: { type: 'string' },
	cap: { type: 'string' },
	path: { type: 'string' },
} as const

function parse_options(argv: ReadonlyArray<string>): Options | undefined {
	try {
		const { values } = parseArgs({ args: [...argv], options: PARSE_ARGS_OPTIONS, strict: true })

		return to_options(values)
	} catch {
		return undefined
	}
}

// An empty corpus is reported, never priced at zero. "No transcript was found" and "this run was
// free" are different answers, and only one of them is ever true. The wording is
// `cost_transcript`'s, so `josh time` says the same thing about the same directory.
function report_empty(cwd: string, session_id: string | undefined): number {
	const searched = cost_transcript.searched_directories(cost_transcript.transcript_directories(cwd))

	for (const line of cost_transcript.missing_message(searched, session_id)) console.error(line)

	return FAILURE_EXIT_CODE
}

// The records the `--cap` counterfactual runs over: one issue's slice when `--issue` narrows it,
// otherwise the latest own session — the same records `cost-report-cli` would build a report from,
// read here without the report.
function cap_records(corpus: Corpus, options: Options): ReadonlyArray<UsageRecord> {
	if (options.issue !== undefined) {
		return cost_corpus
			.dedupe_across_sessions(cost_corpus.attribute_corpus(corpus).pairs)
			.filter((pair) => pair.issue === options.issue)
			.map((pair) => pair.record)
	}

	return corpus.sessions[cost_transcript.latest_own_index(corpus.files)]?.records ?? []
}

// `--over`: what the next turn of this session will cost, read from the latest own session alone —
// the flag refuses `--issue` / `--all`, so there is no other scope to consider.
function run_over(target: string, options: Options, limit: number): number {
	const corpus = cost_corpus.load_corpus(target, options.session)
	const session = corpus.sessions[cost_transcript.latest_own_index(corpus.files)]

	if (session === undefined) return report_empty(target, options.session)

	const measurement: OverMeasurement = {
		request_count: session.records.length,
		billed_input_tokens: cost_usage.billed_input(cost_usage.sum_totals(session.records)),
	}

	return cost_verdict.report_over(measurement, limit)
}

// `--cap` (text): the share of a scope's priced cost at or under the cap. An empty scope has no
// simulation, matching the report path's `optional_cap`, so the verdict reports it rather than a
// ratio of zero.
function run_cap(target: string, options: Options, cap: number): number {
	const corpus = cost_corpus.load_corpus(target, options.session)

	if (corpus.sessions.length === 0) return report_empty(target, options.session)

	const records = cap_records(corpus, options)
	const simulation = records.length === 0 ? undefined : cost_curve.simulate_cap(records, cap)

	return cost_verdict.report_cap(simulation, cap)
}

// The one-line `--over` / `--cap` verdicts, answered without the report path; undefined when neither
// flag applies, so the caller falls through to the full report.
function run_verdict(target: string, options: Options): number | undefined {
	if (options.over !== undefined) return run_over(target, options, options.over)
	if (options.cap !== undefined && !options.is_json) return run_cap(target, options, options.cap)

	return undefined
}

// This process's own working directory, kept as-is: the transcript search now covers both a lane's
// own slug and the main checkout that slug resolves to (joshuafolkken/kit#1825), so pre-rewriting the
// cwd here would drop the lane's own slug and hide a dispatched child's transcript
// (joshuafolkken/kit#1749). `time-cli.ts` gives the same reason.
async function run(argv: ReadonlyArray<string>, cwd: string = process.cwd()): Promise<number> {
	const options = parse_options(argv)

	if (options === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	// `--path <dir>` reads the target project instead of the process cwd (joshuafolkken/kit#1987).
	const target = transcript_cwd.resolve(options.path, cwd)
	const verdict = run_verdict(target, options)

	if (verdict !== undefined) return verdict

	// The kit-only report path is reached only here, dynamically, so its report-module closure never
	// enters this distributed entry's static imports.
	const { cost_report_cli } = await import('#scripts/cost/cost-report-cli')

	return cost_report_cli.run(target, options)
}

// `process.exitCode` rather than `process.exit()`: the report is written with `console.info`, and
// `process.exit()` tears the process down before a pipe has drained — `--all --json | cat` lost
// everything past the 64KB pipe buffer and produced JSON that would not parse. The same idiom, for
// the same reason, is in `scripts/verification-gate.ts` and `scripts/lint-parallel.ts`.
async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const cost_cli = {
	USAGE,
	parse_options,
	to_threshold,
	load_corpus: cost_corpus.load_corpus,
	attributed: cost_corpus.attributed,
	run,
	main,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) void main(process.argv.slice(ARGV_OFFSET))

export type { Options }
export { cost_cli, report_empty }
