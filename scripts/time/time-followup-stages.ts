import { git_followup_stages, type FollowupStage } from '#scripts/git/git-followup-stages'
import { time_format } from './time-format'
import { time_shell } from './time-shell'
import type { Span } from './time-spans'

// The per-stage table `josh time` prints for the `followup` invocations in its window
// (joshuafolkken/kit#1445).
//
// `time-followup-stage.ts` reads one body's rows; this sums them across the run's invocations and
// renders the block. The pair is `time-single-check.ts` beside `time-single-checks.ts`, and the
// reason is the same: the reader is reached from the transcript parse, so it cannot know about
// `Span` without closing a cycle.
//
// **The rows are printed in the order a run passes them, not by descending duration.** Every other
// table here ranks, because its rows are an open set and the question is which is largest. These are
// a closed set of named laps, and the question the block exists for is *which stage of this run
// was slower than the same stage of that one* — a table that reorders itself between two runs cannot
// be read down the column, which is exactly the comparison joshuafolkken/kit#1445 was filed for.
//
// **A stage no invocation reported says `not measured`, never `0.0 s`.** Both cases that produce it
// are real: `merge` is absent from a run that did not merge, and a run that threw stops at
// `interrupted` with every later lap missing. Zero would assert a lap that ran and took no time,
// which is the reading `time-format.ts`'s `NOT_MEASURED` exists to keep a report out of.
//
// **The block is withheld entirely where the window holds no `followup` call at all** — a heading
// over a column of `not measured` rows would assert the question was asked of something, and the
// answer for a session that never merged anything is that there was nothing to ask.

const HEADING = 'Followup stages (in run order):'
const NOTE = 'read from the rows followup printed into the transcript'
const FOLLOWUP_COMMAND = `${time_shell.JOSH_PREFIX}followup`
const NO_DURATION = 0
const NO_RUNS = 0
const ONE_RUN = 1

// One stage, summed over the invocations that reported it. `run_count` rides along because two
// invocations of `followup` in one window make the seconds a sum rather than a measurement, and a
// reader comparing this table against a single run's printed block has to be able to tell.
interface FollowupStageRow {
	label: string
	duration_ms: number
	run_count: number
}

// `run_count` counts the `followup` calls the window held; `read_count` counts those whose body still
// carried the block. They are kept apart because their difference is the one thing the table cannot
// show in a row: a body the harness truncated, or a preview it replaced the output with, leaves an
// invocation that happened and was not measured.
interface FollowupStageTotals {
	run_count: number
	read_count: number
	rows: ReadonlyArray<FollowupStageRow>
}

// A span split around a delegated unit comes back as a head and a tail carrying the same fields, so
// the continuation is dropped rather than summed — the convention the per-invocation table already
// follows for the same reason.
function is_followup_run(span: Span): boolean {
	return span.josh_command === FOLLOWUP_COMMAND && !span.is_continuation
}

function added(row: FollowupStageRow | undefined, stage: FollowupStage): FollowupStageRow {
	return {
		label: stage.name,
		duration_ms: (row?.duration_ms ?? NO_DURATION) + stage.duration_ms,
		run_count: (row?.run_count ?? NO_RUNS) + ONE_RUN,
	}
}

function summed(stages: ReadonlyArray<FollowupStage>): Array<FollowupStageRow> {
	const totals = new Map<string, FollowupStageRow>()
	const rows: Array<FollowupStageRow> = []

	for (const stage of stages) totals.set(stage.name, added(totals.get(stage.name), stage))
	// Drained with a loop rather than a spread: `Iterator#toArray` is not in this project's TS lib,
	// the same reason `time-invocations.ts` drains its own totals map this way.
	for (const [, row] of totals) rows.push(row)

	return rows
}

function build_followup_stages(spans: ReadonlyArray<Span>): FollowupStageTotals {
	const runs = spans.filter((span) => is_followup_run(span))
	const measured = runs.filter((run) => run.followup_stages.length > NO_RUNS)

	return {
		run_count: runs.length,
		read_count: measured.length,
		rows: summed(measured.flatMap((run) => run.followup_stages)),
	}
}

// **Every declared stage gets a row, and an observed name the printer no longer declares gets one
// after them.** Pinning the table to `STAGE` alone would drop a renamed lap without saying so, which
// is the going-quiet-without-failing this repository argues against everywhere else; pinning it to
// what was observed instead would let the row set change between two runs of the same command.
function ordered_labels(rows: ReadonlyMap<string, FollowupStageRow>): Array<string> {
	const declared: ReadonlyArray<string> = Object.values(git_followup_stages.STAGE)
	const labels = [...declared]

	for (const [label] of rows) {
		if (!declared.includes(label)) labels.push(label)
	}

	return labels
}

function stage_line(label: string, row: FollowupStageRow | undefined): string {
	if (row === undefined) return time_format.unmeasured_row(label)

	const runs = `${String(row.run_count)} invocation(s)`

	return time_format.format_columns(label, time_format.format_seconds(row.duration_ms), runs)
}

function notes_of(totals: FollowupStageTotals): Array<string> {
	const unread = totals.run_count - totals.read_count

	if (unread === NO_RUNS) return [NOTE]

	return [NOTE, `${String(unread)} of ${String(totals.run_count)} printed no readable rows`]
}

function followup_stage_lines(totals: FollowupStageTotals): Array<string> {
	if (totals.run_count === NO_RUNS) return []

	const rows = new Map(totals.rows.map((row) => [row.label, row]))
	const lines = ordered_labels(rows).map((label) => stage_line(label, rows.get(label)))

	return ['', HEADING, ...time_format.note_lines(notes_of(totals)), ...lines]
}

// The empty totals, for a report built without spans — the shape `time_single_checks.NO_SINGLE_CHECKS`
// already has, so a fixture states "no followup ran" once rather than four times.
const NO_FOLLOWUP_STAGES: FollowupStageTotals = {
	run_count: NO_RUNS,
	read_count: NO_RUNS,
	rows: [],
}

const time_followup_stages = {
	HEADING,
	NOTE,
	FOLLOWUP_COMMAND,
	NO_FOLLOWUP_STAGES,
	build_followup_stages,
	followup_stage_lines,
}

export type { FollowupStageRow, FollowupStageTotals }
export { time_followup_stages }
