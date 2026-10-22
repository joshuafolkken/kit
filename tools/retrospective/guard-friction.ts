import { cost_pricing } from '#scripts/cost-runtime/cost-pricing'
import type { UsageRecord } from '#scripts/cost-runtime/cost-usage'
import { figure_format } from '#scripts/lib/figure-format'
import { delivered_rules } from '#scripts/rules/delivered-rules'
import {
	time_transcript_line,
	type TranscriptLine,
} from '#scripts/time-runtime/time-transcript-line'
import type { RunNode } from '#tools/cost/cost-run-nodes'

// Guard refusals and Stop re-entries counted per guard, and what their round trips cost.
//
// **A refusal or a Stop block costs the run one more request**: the model re-reads its whole context
// to answer the reason. That request — the session's first at or after the hit, shared among every
// hit it answered — is what the round trip is priced at, so a refusal late in a long session costs what it really did rather than an
// average. The guard is the one `time-transcript-line.ts` already reads off the reason's opening, so
// this tally and every other reader of a refusal name a guard the same way — save a renamed guard,
// which is tallied under its current name (`RENAMED_GUARDS`).

type HitKind = 'refusal' | 'stop'

interface GuardHit {
	guard: string
	kind: HitKind
	at_ms: number
}

// One session of the run with its parsed transcript — the node carries the priced records.
interface SessionTranscript {
	node: RunNode
	lines: ReadonlyArray<TranscriptLine>
}

// What the tally reads of a session — its priced records and its lines — so a reader with no run tree
// (`josh cost:audit`) hands sessions in without inventing a role for them.
interface GuardSource {
	node: Pick<RunNode, 'records'>
	lines: ReadonlyArray<TranscriptLine>
}

interface GuardRow {
	guard: string
	refusals: number
	stops: number
	usd: number
}

function renamed_pairs(
	reason: string,
	former_reasons: ReadonlyArray<string>,
): Array<[string, string]> {
	const current = time_transcript_line.guard_from_refusal(reason)

	return former_reasons.map((former) => [time_transcript_line.guard_from_refusal(former), current])
}

// **A reworded reason can rename its guard** — `issue comments` opened as `an Issue's comments are
// part of the Issue` before #3570 — so a refusal under a `former_reasons` opening is tallied under the
// guard's current name, and a rename alone never reads as one guard vanishing and another regressing.
const RENAMED_GUARDS = new Map(
	delivered_rules.MEASURED_RULES.flatMap((rule) =>
		renamed_pairs(rule.reason, rule.former_reasons ?? []),
	).filter(([former, current]) => former !== current),
)

function hit(guard: string, kind: HitKind, at_ms: number): GuardHit {
	return { guard: RENAMED_GUARDS.get(guard) ?? guard, kind, at_ms }
}

function line_hits(line: TranscriptLine): Array<GuardHit> {
	const refusals = line.blocks
		.filter((block) => block.refusal_guard !== '')
		.map((block) => hit(block.refusal_guard, 'refusal', line.timestamp_ms))
	const stops = line.stop_guard === '' ? [] : [hit(line.stop_guard, 'stop', line.timestamp_ms)]

	return [...refusals, ...stops]
}

function hits_of(lines: ReadonlyArray<TranscriptLine>): Array<GuardHit> {
	return lines.flatMap((line) => line_hits(line))
}

// The request that answered a hit — undefined when the session ended on it.
function answer_of(at_ms: number, records: ReadonlyArray<UsageRecord>): UsageRecord | undefined {
	return records.find((record) => record.at_ms !== undefined && record.at_ms >= at_ms)
}

function share_counts(answers: ReadonlyArray<UsageRecord | undefined>): Map<UsageRecord, number> {
	const counts = new Map<UsageRecord, number>()

	for (const answer of answers) {
		if (answer !== undefined) counts.set(answer, (counts.get(answer) ?? 0) + 1)
	}

	return counts
}

function share_usd(answer: UsageRecord | undefined, counts: Map<UsageRecord, number>): number {
	if (answer === undefined) return 0

	return cost_pricing.cost_of([answer]) / (counts.get(answer) ?? 1)
}

// Hits refused in parallel are answered by one request, so its cost is split among them rather
// than charged to each — the session's round-trip total counts each answering request once.
function priced_hits(session: GuardSource): Array<[GuardHit, number]> {
	const hits = hits_of(session.lines)
	const answers = hits.map((one) => answer_of(one.at_ms, session.node.records))
	const counts = share_counts(answers)

	return hits.map((one, index) => [one, share_usd(answers[index], counts)])
}

function count_of(kind: HitKind, wanted: HitKind): number {
	return kind === wanted ? 1 : 0
}

function add_hit(rows: Map<string, GuardRow>, one: GuardHit, usd: number): void {
	const row = rows.get(one.guard) ?? { guard: one.guard, refusals: 0, stops: 0, usd: 0 }

	rows.set(one.guard, {
		guard: one.guard,
		refusals: row.refusals + count_of(one.kind, 'refusal'),
		stops: row.stops + count_of(one.kind, 'stop'),
		usd: row.usd + usd,
	})
}

function total_hits(row: GuardRow): number {
	return row.refusals + row.stops
}

// Every guard that fired in the given sessions, the most frequent first.
function guard_rows(sessions: ReadonlyArray<GuardSource>): Array<GuardRow> {
	const rows = new Map<string, GuardRow>()

	for (const session of sessions) {
		for (const [one, usd] of priced_hits(session)) add_hit(rows, one, usd)
	}

	return [...rows.values()].toSorted((left, right) => total_hits(right) - total_hits(left))
}

function sum_of(rows: ReadonlyArray<GuardRow>, field: 'refusals' | 'stops' | 'usd'): number {
	return rows.reduce((total, row) => total + row[field], 0)
}

function row_line(row: GuardRow): string {
	return `  ${row.guard}: ${String(row.refusals)} refused, ${String(row.stops)} stopped, ${figure_format.format_usd(row.usd)}`
}

function report_lines(rows: ReadonlyArray<GuardRow>): Array<string> {
	if (rows.length === 0) return ['Guard friction: none']

	const refusals = String(sum_of(rows, 'refusals'))
	const stops = String(sum_of(rows, 'stops'))
	const usd = figure_format.format_usd(sum_of(rows, 'usd'))
	const head = `Guard friction: ${refusals} refusal(s), ${stops} Stop re-entry(ies), ${usd} in round trips`

	return [head, ...rows.map((row) => row_line(row))]
}

const guard_friction = { guard_rows, report_lines }

export type { GuardRow, GuardSource, SessionTranscript }
export { guard_friction }
