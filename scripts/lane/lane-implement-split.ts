import { lane_breakdown, type Breakdown, type Stage } from './lane-breakdown'
import { lane_ledger, type LedgerEntry } from './lane-ledger'
import type { LaneSpan } from './lane-net-time'

// The implementation's net time split by what it waited on (joshuafolkken/kit#8998): the core budget,
// the `test:pinned` check, the review, the gate's checks, and the rest of `run:chain`'s stages — each
// read off the lane's ledger rows as the span `[at - elapsed, at]` — and what none of them covers, the
// editing (writing the tests included). Spans overlap (a core wait inside `check:related`, the pinned
// check under `recheck`), so each millisecond counts once, under the first segment in `ORDER` that
// covers it. `lane:breakdown` prints the split and `lane:breakdown --period` takes its medians, both
// from this one table.

const SEGMENT = {
	EDIT: 'editing (tests included)',
	GATE: 'gate wait',
	PINNED: 'test:pinned wait',
	REVIEW: 'review wait',
	CORE: 'core budget wait',
	OTHER: 'other run:chain stages',
} as const

type SegmentName = (typeof SEGMENT)[keyof typeof SEGMENT]

// The claim order: a millisecond two segments cover counts under the earlier one.
const ORDER: ReadonlyArray<SegmentName> = [
	SEGMENT.CORE,
	SEGMENT.PINNED,
	SEGMENT.REVIEW,
	SEGMENT.GATE,
	SEGMENT.OTHER,
]

// The print order: the editing first, then the waits.
const PRINTED: ReadonlyArray<SegmentName> = [SEGMENT.EDIT, ...ORDER]

// `run:chain`'s stages by the segment they count under; a stage not named here counts under
// `SEGMENT.OTHER`. `recheck` holds on the background `test:pinned` check (`run-chain-recheck.ts`).
const CHAIN_SEGMENTS: ReadonlyMap<string, SegmentName> = new Map([
	['recheck', SEGMENT.PINNED],
	['run:review', SEGMENT.REVIEW],
	['review:record', SEGMENT.REVIEW],
	['review:attest', SEGMENT.REVIEW],
	['check:related', SEGMENT.GATE],
	['guard-tests', SEGMENT.GATE],
	['metrics-totals', SEGMENT.GATE],
	['exports:unused', SEGMENT.GATE],
	['main:merge', SEGMENT.GATE],
	['preflight:check', SEGMENT.GATE],
	['review:selfcheck', SEGMENT.GATE],
	['command:derive', SEGMENT.GATE],
	['acceptance:check', SEGMENT.GATE],
	['scoped-green', SEGMENT.GATE],
])

// The join's `ship` stage is the ship's own stages, outside the implementation (`lane-breakdown-chain.ts`).
const SHIP_STAGE = 'ship'
const LABEL = 'split'
const { KIND } = lane_ledger

interface TaggedSpan extends LaneSpan {
	segment: SegmentName
}

interface Claim {
	parts: ReadonlyArray<LaneSpan>
	covered_ms: number
	stages: ReadonlyArray<Stage>
}

function chain_segment(name: string): SegmentName {
	return CHAIN_SEGMENTS.get(name) ?? SEGMENT.OTHER
}

function tagged(at: string, elapsed_ms: number, segment: SegmentName): TaggedSpan {
	const to_ms = Date.parse(at)

	return { from_ms: to_ms - elapsed_ms, to_ms, segment }
}

// A core wait or an answered `test:pinned` check; a discarded check was not waited on.
function wait_span(entry: LedgerEntry): TaggedSpan | undefined {
	if (entry.kind === KIND.CORE_WAIT) return tagged(entry.at, entry.waited_ms, SEGMENT.CORE)
	if (entry.kind !== KIND.TEST_PINNED || entry.discarded === true) return undefined

	return tagged(entry.at, entry.elapsed_ms, SEGMENT.PINNED)
}

function chain_span(entry: LedgerEntry): TaggedSpan | undefined {
	if (entry.kind !== KIND.CHAIN_STAGE || entry.name === SHIP_STAGE) return undefined

	return tagged(entry.at, entry.elapsed_ms, chain_segment(entry.name))
}

// The span a lane row of the implementation's waits stands for, `undefined` for any other row.
function span_of(entry: LedgerEntry): TaggedSpan | undefined {
	return wait_span(entry) ?? chain_span(entry)
}

function is_issue_row(entry: LedgerEntry, issue: number): boolean {
	return 'issue' in entry && entry.issue === issue
}

function spans_of(entries: ReadonlyArray<LedgerEntry>, issue: number): Array<TaggedSpan> {
	return entries
		.filter((entry) => is_issue_row(entry, issue))
		.map((entry) => span_of(entry))
		.filter((span) => span !== undefined)
}

// Whether the ledger holds a row of `issue` to split its implementation by — `of` is `undefined` without.
function has_rows(issue: number, entries: ReadonlyArray<LedgerEntry>): boolean {
	return spans_of(entries, issue).length > 0
}

function covered_ms(spans: ReadonlyArray<LaneSpan>, parts: ReadonlyArray<LaneSpan>): number {
	return spans.reduce((sum, span) => sum + lane_breakdown.covered_ms(span, parts), 0)
}

function span_ms(spans: ReadonlyArray<LaneSpan>): number {
	return spans.reduce((sum, span) => sum + span.to_ms - span.from_ms, 0)
}

// `claim` with `segment`'s spans added: the segment's milliseconds are those no earlier claim covered.
function claim_next(
	claim: Claim,
	segment: SegmentName,
	implement: ReadonlyArray<LaneSpan>,
	spans: ReadonlyArray<TaggedSpan>,
): Claim {
	const parts = [...claim.parts, ...spans.filter((span) => span.segment === segment)]
	const reached_ms = covered_ms(implement, parts)
	const stage = { name: segment, ms: reached_ms - claim.covered_ms }

	return { parts, covered_ms: reached_ms, stages: [...claim.stages, stage] }
}

// The implementation's net time by segment in `PRINTED` order, summing to it; `undefined` when the
// ledger holds no row of `issue` to split it by — that lane's split is unknown, not all editing.
function of(
	issue: number,
	breakdown: Breakdown,
	entries: ReadonlyArray<LedgerEntry>,
): Array<Stage> | undefined {
	const spans = spans_of(entries, issue)
	if (spans.length === 0) return undefined
	const { implement, waits } = breakdown
	let claim: Claim = { parts: waits, covered_ms: covered_ms(implement, waits), stages: [] }

	for (const segment of ORDER) claim = claim_next(claim, segment, implement, spans)
	const edit = { name: SEGMENT.EDIT, ms: span_ms(implement) - claim.covered_ms }

	return [edit, ...claim.stages]
}

// The lines `josh lane:breakdown` prints under the implementation; none when its split is unknown.
function lines_of(
	issue: number,
	breakdown: Breakdown,
	entries: ReadonlyArray<LedgerEntry>,
): Array<string> {
	return (of(issue, breakdown, entries) ?? []).map(
		(stage) => `${LABEL} › ${stage.name} ${lane_breakdown.minutes_text(stage.ms)}`,
	)
}

const lane_implement_split = { PRINTED, SEGMENT, has_rows, lines_of, of }

export { lane_implement_split }
