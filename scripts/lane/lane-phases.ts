import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { lane_breakdown } from './lane-breakdown'
import { lane_breakdown_pause } from './lane-breakdown-pause'
import { lane_ledger, type LedgerEntry } from './lane-ledger'
import { lane_stats } from './lane-stats'
import { lane_stop_stats } from './lane-stop-stats'

// `josh lane:phases` (joshuafolkken/kit#8287): each lane phase's median minutes across lanes, so a change
// that lightens a lane is estimated against measured phases. The bounds, per lane:
// - prep & investigation — the last dispatch before the first `run:chain` to the lane's first
//   implementation marker (`plan` / `lane-phase … implement` run event, as `lane:breakdown` reads it);
// - implement — that marker to the first `run:chain`'s start;
// - local checks — every `run:chain` stage but the review stages and `ship`, summed;
// - review — the review stages summed, plus the first review round's wait: the last pre-review
//   `run:chain`'s end to the first `--join` run's start;
// - push → merge — the first `ship` chain stage's start to the last merge, and apart under it the
//   `ci-wait` stages inside that span.
// A lane lacking a phase's records is left out of that phase's samples, never counted as zero; a lane
// whose dispatch before its first run was not read (cut off by a period's window) gives no sample.

type ChainEntry = Extract<LedgerEntry, { kind: typeof KIND.CHAIN }>
type StageEntry = Extract<LedgerEntry, { kind: typeof KIND.STAGE }>
type ChainStage = NonNullable<ChainEntry['stages']>[number]

interface PhaseSample {
	readonly phase: string
	readonly ms: number
}

interface PhaseRow {
	readonly phase: string
	readonly median_ms: number
	readonly samples: number
}

interface Span {
	readonly from_ms: number
	readonly to_ms: number
}

const { KIND, CI_WAIT_STAGE } = lane_ledger
const PHASE = {
	PREP: 'prep & investigation',
	IMPLEMENT: 'implement',
	CHECK: 'local checks',
	REVIEW: 'review',
	SHIP: 'push → merge',
	CI_WAIT: '  of which CI wait',
} as const
const PHASES: ReadonlyArray<string> = Object.values(PHASE)
const SHIP_STAGE = 'ship'
const REVIEW_STAGES: ReadonlySet<string> = new Set([
	'run:review',
	'review:selfcheck',
	'review:attest',
])

function at_ms(entry: { readonly at: string }): number {
	return Date.parse(entry.at)
}

function start_ms(entry: ChainEntry): number {
	return at_ms(entry) - entry.elapsed_ms
}

function sum(values: ReadonlyArray<number>): number {
	return values.reduce((total, value) => total + value, 0)
}

function is_chain(entry: LedgerEntry): entry is ChainEntry {
	return entry.kind === KIND.CHAIN
}

function lane_of(entries: ReadonlyArray<LedgerEntry>, issue: number): Array<LedgerEntry> {
	return entries
		.filter((entry) => 'issue' in entry && entry.issue === issue)
		.toSorted((left, right) => at_ms(left) - at_ms(right))
}

function stages_of(chains: ReadonlyArray<ChainEntry>): Array<ChainStage> {
	return chains.flatMap((chain) => chain.stages ?? [])
}

function is_inside(ms: number, span: Span): boolean {
	return ms >= span.from_ms && ms < span.to_ms
}

// The lane's first implementation marker inside `span`, `lane:breakdown`'s own marker.
function implement_ms(
	events: ReadonlyArray<RunEvent>,
	issue: number,
	span: Span,
): number | undefined {
	const marks = events
		.filter((event) => lane_breakdown_pause.is_planning(event))
		.filter((event) => lane_stop_stats.issue_of(event) === issue)
		.map((event) => Date.parse(event.at))
		.filter((ms) => is_inside(ms, span))

	return marks.length === 0 ? undefined : Math.min(...marks)
}

function lane_start_ms(lane: ReadonlyArray<LedgerEntry>, before_ms: number): number | undefined {
	return lane
		.filter((entry) => entry.kind === KIND.DISPATCH && at_ms(entry) <= before_ms)
		.map((entry) => at_ms(entry))
		.at(-1)
}

// The lane's start (its last dispatch before the first chain run) and that run's start; undefined
// where the read missed the dispatch, so a lane cut off by a period's window yields no partial phase.
function opening_span(lane: ReadonlyArray<LedgerEntry>): Span | undefined {
	const chain = lane.find((entry) => is_chain(entry))
	if (chain === undefined) return undefined
	const to_ms = start_ms(chain)
	const from_ms = lane_start_ms(lane, to_ms)

	return from_ms === undefined ? undefined : { from_ms, to_ms }
}

function opening(span: Span, events: ReadonlyArray<RunEvent>, issue: number): Array<PhaseSample> {
	const { from_ms, to_ms } = span
	const mark_ms = implement_ms(events, issue, { from_ms, to_ms })
	if (mark_ms === undefined) return []

	return [
		{ phase: PHASE.PREP, ms: mark_ms - from_ms },
		{ phase: PHASE.IMPLEMENT, ms: to_ms - mark_ms },
	]
}

function is_review(stage: ChainStage): boolean {
	return REVIEW_STAGES.has(stage.name)
}

function is_check(stage: ChainStage): boolean {
	return stage.name !== SHIP_STAGE && !is_review(stage)
}

function check(chains: ReadonlyArray<ChainEntry>): Array<PhaseSample> {
	const stages = stages_of(chains)
	if (stages.length === 0) return []

	const checks_ms = sum(stages.filter((stage) => is_check(stage)).map((stage) => stage.elapsed_ms))

	return [{ phase: PHASE.CHECK, ms: checks_ms }]
}

// The first review round's wait: the reviewer runs between the last pre-review run and the `--join`.
function review_wait_ms(chains: ReadonlyArray<ChainEntry>): number | undefined {
	const join = chains.find((chain) => chain.join)
	if (join === undefined) return undefined
	const before = chains.findLast((chain) => !chain.join && at_ms(chain) <= start_ms(join))

	return before === undefined ? undefined : start_ms(join) - at_ms(before)
}

function review(chains: ReadonlyArray<ChainEntry>): Array<PhaseSample> {
	const wait_ms = review_wait_ms(chains)
	if (wait_ms === undefined) return []
	const stages_ms = sum(
		stages_of(chains)
			.filter((stage) => is_review(stage))
			.map((stage) => stage.elapsed_ms),
	)

	return [{ phase: PHASE.REVIEW, ms: wait_ms + stages_ms }]
}

// A `ci-wait` row is written when the wait ends, so it falls after the ship's start, up to the merge.
function ended_in(entry: LedgerEntry, span: Span): boolean {
	return at_ms(entry) > span.from_ms && at_ms(entry) <= span.to_ms
}

function is_ci_wait(entry: LedgerEntry): entry is StageEntry {
	return entry.kind === KIND.STAGE && entry.stage === CI_WAIT_STAGE
}

function ci_wait_ms(lane: ReadonlyArray<LedgerEntry>, span: Span): Array<number> {
	return lane
		.filter((entry): entry is StageEntry => is_ci_wait(entry) && ended_in(entry, span))
		.map((entry) => entry.elapsed_ms)
}

function closing(
	lane: ReadonlyArray<LedgerEntry>,
	chains: ReadonlyArray<ChainEntry>,
): Array<PhaseSample> {
	const ship = stages_of(chains).find((stage) => stage.name === SHIP_STAGE)
	const merge = lane.findLast((entry) => entry.kind === KIND.MERGE)
	if (ship === undefined || merge === undefined) return []
	const span = { from_ms: at_ms(ship), to_ms: at_ms(merge) }
	const waits = ci_wait_ms(lane, span)
	const shipped = { phase: PHASE.SHIP, ms: span.to_ms - span.from_ms }

	return waits.length === 0 ? [shipped] : [shipped, { phase: PHASE.CI_WAIT, ms: sum(waits) }]
}

// One lane's phase samples, each phase present only where its bounding records are.
function phases_of(
	entries: ReadonlyArray<LedgerEntry>,
	events: ReadonlyArray<RunEvent>,
	issue: number,
): Array<PhaseSample> {
	const lane = lane_of(entries, issue)
	const span = opening_span(lane)
	if (span === undefined) return []
	const chains = lane.filter((entry) => is_chain(entry))

	return [
		...opening(span, events, issue),
		...check(chains),
		...review(chains),
		...closing(lane, chains),
	]
}

function row_of(phase: string, samples: ReadonlyArray<PhaseSample>): Array<PhaseRow> {
	const values = samples.filter((sample) => sample.phase === phase).map((sample) => sample.ms)
	const median_ms = lane_stats.median(values)

	return median_ms === undefined ? [] : [{ phase, median_ms, samples: values.length }]
}

function rows_of(samples: ReadonlyArray<PhaseSample>): Array<PhaseRow> {
	return PHASES.flatMap((phase) => row_of(phase, samples))
}

// The issues whose last merge falls in the span, oldest merge first.
function merged_in(entries: ReadonlyArray<LedgerEntry>, span: Span): Array<number> {
	const merged = new Map<number, number>()

	for (const entry of entries) {
		if (entry.kind === KIND.MERGE) merged.set(entry.issue, at_ms(entry))
	}

	return [...merged]
		.filter(([, ms]) => ms >= span.from_ms && ms <= span.to_ms)
		.toSorted(([, left], [, right]) => left - right)
		.map(([issue]) => issue)
}

// One table row: `<phase>: <median> min median / <samples> <unit>`, shared with `lane-phases-steps.ts`.
function line_of(row: PhaseRow, unit: string): string {
	return `- ${row.phase}: ${lane_breakdown.minutes_text(row.median_ms)} median / ${String(row.samples)} ${unit}`
}

function text(rows: ReadonlyArray<PhaseRow>, lanes: number): string {
	const lines = rows.map((row) => line_of(row, 'lanes'))

	return [`Lane phases over ${String(lanes)} lanes (median, samples):`, ...lines].join('\n')
}

const lane_phases = { PHASE, line_of, merged_in, phases_of, rows_of, text }

export { lane_phases }
export type { PhaseRow, PhaseSample, Span }
