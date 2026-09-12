import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { cost_transcript } from '#scripts/cost/cost-transcript'
import { z } from 'zod'
import { time_format } from './time-format'
import { time_parent_turns, type ParentTurnTotals } from './time-parent-turns'
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
const ENVIRONMENT_KEY = 'JOSH_TIME_HISTORY'
const DISABLED_VALUE = '0'
const PERCENT_SCALE = 100
const PERCENT_DECIMALS = 1
const NO_PREVIOUS = 'no earlier run recorded'
const NO_REASON_GIVEN = 'nothing was measured and no reason was given'
const HEADING_PREFIX = '📈 Run report'

// Only the figures two runs are actually compared on. The full report stays reachable through
// `pnpm josh time --issue <N>`; carrying its tables here would make the file large without making
// any comparison possible that these numbers do not already support.
//
// **`started_at` / `ended_at` are optional because the records written before them exist**
// (joshuafolkken/kit#1470). They are what a period report packs runs into lanes by — `recorded_at`
// is the append instant, which says when a run *finished being merged* and nothing about the window
// it occupied — and a schema that required them would drop every earlier line as unparsable, which
// is silent here by design. A record without them is excluded from the lane table and counted in
// that report's notes, never defaulted to the epoch.
const record_schema = z.object({
	issue: z.number(),
	recorded_at: z.string(),
	started_at: z.string().optional(),
	ended_at: z.string().optional(),
	elapsed_ms: z.number(),
	turn_count: z.number(),
	tool_call_count: z.number(),
	round_trip_count: z.number(),
	ms_per_round_trip: z.number(),
	model_ms_per_round_trip: z.number(),
	// What the run's turns were spent on, one count per contributor (joshuafolkken/kit#1763). It is
	// **optional for the reason `started_at` is**: every line written before this field exists carries
	// none, and a schema requiring it would drop them all as unparsable. Its absence is the record's
	// whole `is_measured` answer — a run whose transcript was never read writes no breakdown, and a
	// period report excludes it from the denominator rather than reading it as eight zeroes.
	by_contributor: z.record(z.string(), z.number()).optional(),
})

type RunTimeRecord = z.infer<typeof record_schema>

// What `record_run` answers. `lines` is what the caller prints, unchanged; `is_recorded` says
// whether a line actually reached `.time-history.jsonl`, and `reason` carries why it did not so a
// notification can name it without re-deriving it from the rendered text.
//
// **`reason` is absent, not `undefined`, whenever there is nothing to explain** —
// `exactOptionalPropertyTypes` is on — and its absence carries meaning of its own: a run that was
// *not* recorded because the history is switched off is not a gap anybody needs telling about. So a
// caller deciding whether to raise the alarm branches on `reason`, not on `is_recorded` alone;
// `is_recorded` answers the narrower question of whether a line reached the file.
interface RunRecordOutcome {
	is_recorded: boolean
	lines: Array<string>
	reason?: string
}

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

// **A record never continues a line it did not start.** The interrupt this format is built to
// survive leaves a partial line with no newline after it, and appending straight onto that would
// concatenate the new JSON to the fragment — dropping *this* run's record too, silently, since an
// unparsable line is skipped. So the separator is restored first.
function append_line(target: string, line: string): void {
	const existing = read_text(target)
	const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : ''

	appendFileSync(target, `${separator}${line}\n`, 'utf8')
}

// **The new record is appended, and the file is rewritten only to trim it.** Rewriting it whole on
// every run would make the one failure the line-oriented format exists to survive — an interrupt
// mid-write — cost the entire sample rather than the last line.
function append_record(root: string, record: RunTimeRecord): Array<RunTimeRecord> {
	append_line(history_path(root), JSON.stringify(record))

	const all = read_records(root)
	if (all.length <= MAX_RECORDS + TRIM_SLACK) return all

	const kept = all.slice(-MAX_RECORDS)

	write_records(root, kept)

	return kept
}

// **Written only where the transcript was read.** `exactOptionalPropertyTypes` is on, so the field is
// absent rather than `undefined` — which is what lets the read side tell an unmeasured run from one
// that made no turn of a given kind.
function contributor_field(report: TimeReport): Pick<RunTimeRecord, 'by_contributor'> {
	if (!report.parent_turns.is_measured) return {}

	return { by_contributor: report.parent_turns.by_contributor }
}

// The inverse of `contributor_field`, so the one place that writes the breakdown is beside the one
// place that reads it back — and a record without one comes back as the same withheld totals every
// other unmeasured scope prints.
function parent_turns_of(record: RunTimeRecord): ParentTurnTotals {
	const { by_contributor } = record

	if (by_contributor === undefined) return { ...time_parent_turns.NO_PARENT_TURNS }

	// **`round_trip_count`, not `turn_count`.** The breakdown is counted one per round trip — the
	// grouping `build_parent_turns` walks — so its counts sum to that figure, while `turn_count` is a
	// second walk that also counts a model span which issued no call. Reconstructing from the wrong
	// one gives back a record whose rows do not add up to its own total, and `contributor_row`
	// computes every share against that total.
	return { turn_count: record.round_trip_count, by_contributor, is_measured: true }
}

function to_record(issue: number, report: TimeReport, recorded_at: string): RunTimeRecord {
	return {
		issue,
		recorded_at,
		...contributor_field(report),
		started_at: report.started_at,
		ended_at: report.ended_at,
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

// The one shape a caller acts on: nothing reached the file, the line that says so, and the reason on
// its own so a notification can name it without parsing the rendered text back apart.
function not_recorded(issue_number: number, reason: string): RunRecordOutcome {
	const issue = String(issue_number)
	const line = `${HEADING_PREFIX} unavailable for issue #${issue} (${reason}) — run \`pnpm josh time --issue ${issue}\` to measure it.`

	return { is_recorded: false, lines: ['', line], reason }
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

// **There is deliberately no timeout around the builder.** A `Promise.race` was written here and
// removed: `collect_issue_spans` reads the transcript corpus with `readFileSync`, so the walk blocks
// the event loop and no timer can fire during it — and on the one await it *could* fire during, the
// builder keeps running afterwards, so the run would print `unavailable`, print the completion
// banner, and then sit there until the walk it never cancelled finished. A bound that cannot
// interrupt the work it names is worse than none: it claims a guarantee and adds a hang. Bounding
// this for real needs cancellation inside the walk or a worker of its own, which is not this change.
function measured_lines(
	issue_number: number,
	history_root: string,
	report: TimeReport,
	now: Clock,
): RunRecordOutcome {
	// An unmeasured report normally says why in `notes`, but the field defaults to empty — and an
	// empty reason renders as `unavailable for issue #42 () —`, which is the one thing the reason is
	// carried for. So the absence is named rather than left blank.
	if (!is_measured(report)) {
		const reason = report.notes.join('; ')

		return not_recorded(issue_number, reason.length > 0 ? reason : NO_REASON_GIVEN)
	}

	const kept = append_record(history_root, to_record(issue_number, report, now()))

	return { is_recorded: true, lines: format_block(kept) }
}

// The whole feature, as one call the caller prints: measure the finished run, keep the record, and
// render it beside the one before it. Never throws — a run that merged has finished, and a failure
// here is reported rather than raised.
//
// **The outcome is returned, not only the lines** (joshuafolkken/kit#1628). Printing was the whole
// of the report for one release, and thirteen consecutive runs lost their record with nothing but a
// line in a scrollback nobody re-reads to say so. A caller that has somewhere louder to put the fact
// — the completion notification — cannot find it by matching the rendered text, so the answer is
// carried as a field. `is_recorded` is false for a disabled history too: nothing was written, and a
// caller asking "is this run in the file" must not be told yes because the switch was off.
async function record_run(
	issue_number: number,
	cwd: string,
	build: ReportBuilder = build_default,
	now: Clock = now_default,
): Promise<RunRecordOutcome> {
	if (is_disabled()) return { is_recorded: false, lines: [] }

	try {
		// **Measured from where the run happened, recorded in the durable checkout.** A dispatched lane
		// child's transcript is filed under the lane's own slug (joshuafolkken/kit#1749), so the raw `cwd`
		// is what `build` must look it up from — `list_sessions_across` searches both that slug and the main
		// checkout's. The appended line, though, goes to `session_cwd(cwd)`: a line written into a lane's
		// own `.time-history.jsonl` is deleted with the lane by `pnpm josh lane:close`
		// (joshuafolkken/kit#1825).
		const report = await build(issue_number, cwd)

		return measured_lines(issue_number, cost_transcript.session_cwd(cwd), report, now)
	} catch (error) {
		return not_recorded(issue_number, reason_of(error))
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
	parent_turns_of,
	format_block,
	record_run,
}

export { time_history }
export type { RunRecordOutcome, RunTimeRecord }
