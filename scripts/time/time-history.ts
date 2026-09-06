import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'
import { time_format } from './time-format'
import type { TimeReport } from './time-report'
import { time_run } from './time-run'

// The durable half of `josh time` (joshuafolkken/kit#1471). The measurement itself only ever ran
// when a person typed `diag`, so a run nobody asked about left no record at all — and a measurement
// that is not continuous cannot answer whether the last change made anything faster.
//
// **It measures nothing of its own.** The report is built by `time_run.build_run_report`, the same
// builder `josh time` calls, and this module only decides what of it is worth keeping and how the
// keeping is read back. A second reader of the transcripts would be a second classification, which is
// exactly what makes two runs incomparable — the rule the `diag` skill already states.
//
// **Nothing here may fail a run.** It is reached after the merge has already happened, so a history
// file that cannot be read or written ends as one honest line saying so, never as a thrown error
// that would make a completed run look like a broken one.

// One JSON object per line, appended in the order the runs finished. A line-oriented file **written
// by appending** rather than one JSON array rewritten each time: an interrupt then costs the tail it
// was in the middle of, not the whole sample the comparison is built on.
const HISTORY_FILE_NAME = '.time-history.jsonl'
// The newest runs are kept and the oldest fall off. A rolling sample is what the comparison needs;
// an unbounded log would grow forever with nothing ever reading its far end.
const MAX_RECORDS = 200
// How far past the cap the file is allowed to run before it is trimmed. **The trim is the one write
// that rewrites the file whole**, so it happens once every `TRIM_SLACK` runs rather than on every run
// past the cap — which is what keeps the append-only property above true in the steady state.
const TRIM_SLACK = 50
// A bound on the measurement, because it now sits on every merged run's path rather than only on a
// `diag` someone asked for: the corpus walk grows with the checkout's transcript history, and a
// report is never worth holding a finished run open for.
const BUILD_TIMEOUT_MS = 60_000
const TIMED_OUT = `the measurement did not finish within ${String(BUILD_TIMEOUT_MS)} ms`
const ENVIRONMENT_KEY = 'JOSH_TIME_HISTORY'
const DISABLED_VALUE = '0'
const PERCENT_SCALE = 100
const PERCENT_DECIMALS = 1
const NO_PREVIOUS = 'no earlier run recorded'
const HEADING_PREFIX = '📈 Run report'

// Only the figures two runs are actually compared on. The full report stays reachable through
// `pnpm josh time --issue <N>`; carrying its tables here would make the file large without making
// any comparison possible that these numbers do not already support.
const record_schema = z.object({
	issue: z.number(),
	recorded_at: z.string(),
	elapsed_ms: z.number(),
	turn_count: z.number(),
	tool_call_count: z.number(),
	round_trip_count: z.number(),
	ms_per_round_trip: z.number(),
	model_ms_per_round_trip: z.number(),
})

type RunTimeRecord = z.infer<typeof record_schema>
type ReportBuilder = (issue_number: number, cwd: string) => Promise<TimeReport>
type Clock = () => string

function history_path(root: string): string {
	return path.join(root, HISTORY_FILE_NAME)
}

// An absent or unreadable history is an empty one, not a failure: the first run in a checkout has no
// file at all, and that is the ordinary case rather than the exceptional one.
function read_text(target: string): string {
	try {
		return readFileSync(target, 'utf8')
	} catch {
		return ''
	}
}

// A line that does not parse is dropped rather than taking the read with it — the file is a log, and
// one truncated tail must not cost every earlier run's record.
function parse_line(line: string): RunTimeRecord | undefined {
	try {
		return record_schema.parse(JSON.parse(line))
	} catch {
		return undefined
	}
}

function is_record(value: RunTimeRecord | undefined): value is RunTimeRecord {
	return value !== undefined
}

function read_records(root: string): Array<RunTimeRecord> {
	return read_text(history_path(root))
		.split('\n')
		.filter((line) => line.trim().length > 0)
		.map((line) => parse_line(line))
		.filter(is_record)
}

function write_records(root: string, records: ReadonlyArray<RunTimeRecord>): void {
	const lines = records.map((record) => `${JSON.stringify(record)}\n`)

	writeFileSync(history_path(root), lines.join(''), 'utf8')
}

// **The new record is appended, and the file is rewritten only to trim it.** Rewriting it whole on
// every run would make the one failure the line-oriented format exists to survive — an interrupt
// mid-write — cost the entire sample rather than the last line, which is the property the header
// comment claims and a case below asserts.
function append_record(root: string, record: RunTimeRecord): Array<RunTimeRecord> {
	appendFileSync(history_path(root), `${JSON.stringify(record)}\n`, 'utf8')

	const all = read_records(root)
	if (all.length <= MAX_RECORDS + TRIM_SLACK) return all

	const kept = all.slice(-MAX_RECORDS)

	write_records(root, kept)

	return kept
}

function to_record(issue: number, report: TimeReport, recorded_at: string): RunTimeRecord {
	return {
		issue,
		recorded_at,
		elapsed_ms: report.elapsed_ms,
		turn_count: report.turn_count,
		tool_call_count: report.tool_call_count,
		round_trip_count: report.round_trip_count,
		ms_per_round_trip: report.ms_per_round_trip,
		model_ms_per_round_trip: report.model_ms_per_round_trip,
	}
}

function sign_of(delta: number): string {
	return delta < 0 ? '-' : '+'
}

function signed_minutes(delta_ms: number): string {
	return `${sign_of(delta_ms)}${time_format.format_minutes(Math.abs(delta_ms))}`
}

function signed_count(delta: number): string {
	return `${sign_of(delta)}${String(Math.abs(delta))}`
}

// A previous run of zero elapsed time yields no percentage rather than a division by zero: an
// unknown is withheld — an empty part the suffix drops — never rendered as a number.
function signed_share(current: number, previous: number): string {
	if (previous === 0) return ''

	const share = ((current - previous) / previous) * PERCENT_SCALE

	return `${sign_of(share)}${Math.abs(share).toFixed(PERCENT_DECIMALS)}%`
}

function comparison_row(current: RunTimeRecord, previous: RunTimeRecord | undefined): string {
	if (previous === undefined) return time_format.format_columns('vs previous', '', NO_PREVIOUS)

	const trip_delta = current.round_trip_count - previous.round_trip_count
	const parts = [
		signed_share(current.elapsed_ms, previous.elapsed_ms),
		`round trips ${signed_count(trip_delta)}`,
	]

	return time_format.format_columns(
		`vs #${String(previous.issue)}`,
		signed_minutes(current.elapsed_ms - previous.elapsed_ms),
		parts.filter((part) => part.length > 0).join(time_format.SUFFIX_SEPARATOR),
	)
}

function figure_rows(current: RunTimeRecord): Array<string> {
	return [
		time_format.format_columns(
			'elapsed',
			time_format.format_minutes(current.elapsed_ms),
			`${String(current.turn_count)} turns · ${String(current.round_trip_count)} round trips`,
		),
		time_format.format_columns(
			'per round trip',
			time_format.format_seconds(current.ms_per_round_trip),
			`model ${time_format.format_seconds(current.model_ms_per_round_trip)}`,
		),
	]
}

// **The newest record for a _different_ issue**, rather than simply the one before this. `josh
// followup` is re-runnable — a merge that succeeded with a failing step after it is finished by
// re-invoking it — so the record before this one can be this same run measured twice, which would
// print `+0.0 min` as though nothing had changed between two runs.
function previous_of(
	kept: ReadonlyArray<RunTimeRecord>,
	current: RunTimeRecord,
): RunTimeRecord | undefined {
	return kept.slice(0, -1).findLast((entry) => entry.issue !== current.issue)
}

function run_count(count: number): string {
	return count === 1 ? '1 run' : `${String(count)} runs`
}

// The newest record is the run that just finished and the one before it is what it is compared
// against, so the block is rendered from the kept history rather than from the report alone.
function format_block(kept: ReadonlyArray<RunTimeRecord>): Array<string> {
	const current = kept.at(-1)
	if (current === undefined) return []

	return [
		'',
		`${HEADING_PREFIX} — issue #${String(current.issue)} (${run_count(kept.length)} in ${HISTORY_FILE_NAME})`,
		...figure_rows(current),
		comparison_row(current, previous_of(kept, current)),
	]
}

async function build_default(issue_number: number, cwd: string): Promise<TimeReport> {
	return await time_run.build_run_report(issue_number, cwd)
}

function now_default(): string {
	return new Date().toISOString()
}

// Off by setting `JOSH_TIME_HISTORY=0`. A consumer that does not want a generated file in its
// checkout should not have to choose between that and using `josh followup` at all.
function is_disabled(): boolean {
	return process.env[ENVIRONMENT_KEY] === DISABLED_VALUE
}

function unavailable_lines(issue_number: number, reason: string): Array<string> {
	const issue = String(issue_number)

	return [
		'',
		`${HEADING_PREFIX} unavailable for issue #${issue} (${reason}) — run \`pnpm josh time --issue ${issue}\` to measure it.`,
	]
}

function reason_of(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

// **`build_run_report` never throws for a missing half.** A run with no transcript attributed to it —
// a `followup` typed by hand outside a session is the ordinary case — comes back with every count at
// zero and the reason in `notes`. Appended, that record is indistinguishable from a measured one and
// becomes the baseline the *next* run is compared against, so it is reported and not kept: an unknown
// is withheld, never recorded as a zero.
function is_measured(report: TimeReport): boolean {
	return report.span_count > 0 && report.elapsed_ms > 0
}

// The measurement, bounded. `undefined` is the timeout rather than a thrown error, because the timer
// is a race the builder lost and not something that went wrong with it.
async function build_within(
	build: ReportBuilder,
	issue_number: number,
	cwd: string,
): Promise<TimeReport | undefined> {
	const expiry = new AbortController()

	try {
		return await Promise.race([
			build(issue_number, cwd),
			delay(BUILD_TIMEOUT_MS, undefined, { signal: expiry.signal }),
		])
	} finally {
		expiry.abort()
	}
}

// `undefined` is the bound above having expired, which is reported exactly as an unreadable half is:
// the run finished either way, and what is withheld is the measurement rather than the run.
function measured_lines(
	issue_number: number,
	cwd: string,
	report: TimeReport | undefined,
	now: Clock,
): Array<string> {
	if (report === undefined) return unavailable_lines(issue_number, TIMED_OUT)
	if (!is_measured(report)) return unavailable_lines(issue_number, report.notes.join('; '))

	const kept = append_record(cwd, to_record(issue_number, report, now()))

	return format_block(kept)
}

// The whole feature, as one call the caller prints: measure the finished run, keep the record, and
// render it beside the one before it. Never throws — a run that merged has finished, and a failure
// here is reported rather than raised.
async function record_run(
	issue_number: number,
	cwd: string,
	build: ReportBuilder = build_default,
	now: Clock = now_default,
): Promise<Array<string>> {
	if (is_disabled()) return []

	try {
		return measured_lines(issue_number, cwd, await build_within(build, issue_number, cwd), now)
	} catch (error) {
		return unavailable_lines(issue_number, reason_of(error))
	}
}

const time_history = {
	HISTORY_FILE_NAME,
	MAX_RECORDS,
	TRIM_SLACK,
	history_path,
	read_records,
	append_record,
	to_record,
	format_block,
	record_run,
}

export { time_history }
export type { RunTimeRecord }
