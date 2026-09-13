import { cost_usage } from '#scripts/cost/cost-usage'
import { describe, expect, it } from 'vitest'
import { time_contributor_costs, type ContributorCostFacts } from './time-contributor-costs'
import { time_parent_turns } from './time-parent-turns'
import { time_region_costs, type PricedRequest } from './time-region-costs'
import { time_span_fixture } from './time-span-fixture'
import { time_spans, type Span } from './time-spans'

// joshuafolkken/kit#1872: what a run's turns cost, keyed by what they were for — with the billed
// turns that issued no tool counted on their own. The purpose of a trip is the count block's own
// `contributor_of_trip`, so a case here needs only to show the money lands in the row that rule names.

const { MINUTE_MS, outcome_span } = time_span_fixture

const EDIT_LABEL = 'Edit'
const READ_LABEL = 'Read'
const ROUND_TRIPS = 4

// A timed tool call closing on the given minute, so the round trip it forms owns [minute - 1, minute].
function call(end_minute: number, label: string): Span {
	return outcome_span(end_minute, time_spans.UNKNOWN_OUTCOME, label)
}

// A timed think between two calls, which is what separates one round trip from the next when the
// spans carry no message id — the same rule `time-round-trips.ts` groups by.
function think(end_minute: number): Span {
	return { ...call(end_minute, ''), category: time_spans.MODEL_CATEGORY }
}

function at(minute: number, cost_usd: number, is_priced = true): PricedRequest {
	return { at_ms: minute * MINUTE_MS, cost_usd, is_priced }
}

function build(
	spans: ReadonlyArray<Span>,
	requests: ReadonlyArray<PricedRequest> | undefined,
): ContributorCostFacts {
	return time_contributor_costs.build({ spans, requests, round_trip_count: ROUND_TRIPS })
}

function usd_of(facts: ContributorCostFacts, contributor: string): number {
	return facts.by_contributor.find((row) => row.contributor === contributor)?.cost_usd ?? 0
}

// One Edit call closing at minute 2, so its round trip owns [1, 2]; the turn's own billed request
// sits on the opening instant.
const EDIT_RUN: ReadonlyArray<Span> = [call(2, EDIT_LABEL)]

describe('time_contributor_costs.build — charging a turn to the purpose it served', () => {
	it('charges a request inside a round trip to that trip contributor', () => {
		const facts = build(EDIT_RUN, [at(1, 5)])

		expect(usd_of(facts, time_parent_turns.IMPLEMENTATION)).toBe(5)
	})

	it('keeps a purpose no request landed in out of the rows', () => {
		const rows = build(EDIT_RUN, [at(1, 5)]).by_contributor.map((row) => row.contributor)

		expect(rows).toEqual([time_parent_turns.IMPLEMENTATION])
	})

	it('labels different round trips by their own purpose', () => {
		const facts = build([call(2, EDIT_LABEL), think(3), call(4, READ_LABEL)], [at(1, 5), at(3, 2)])

		expect([
			usd_of(facts, time_parent_turns.IMPLEMENTATION),
			usd_of(facts, time_parent_turns.INVESTIGATION),
		]).toEqual([5, 2])
	})
})

describe('time_contributor_costs.build — the turns that called nothing', () => {
	// `group_round_trips` drops a turn that issued no tool, so its billed request lands in no region.
	it('counts a billed request outside every round trip as a no-tool-call turn', () => {
		const facts = build(EDIT_RUN, [at(1, 5), at(30, 3)])

		expect(facts.no_tool_call).toEqual({ request_count: 1, cost_usd: 3 })
	})

	it('keeps the no-tool-call turns inside the priced total', () => {
		const facts = build(EDIT_RUN, [at(1, 5), at(30, 3)])

		expect([facts.cost_usd, facts.request_count]).toEqual([8, 2])
	})
})

describe('time_contributor_costs.build — a scope whose cost corpus was not read', () => {
	// Withheld is not measured as zero: a reader that took an unread scope's zeros for a measurement
	// would rank a purpose as costless.
	it('reports itself unmeasured rather than as turns that were free', () => {
		expect(build(EDIT_RUN, undefined).is_measured).toBe(false)
	})

	it('is measured where the read happened and found nothing', () => {
		expect(build(EDIT_RUN, []).is_measured).toBe(true)
	})
})

describe('time_contributor_costs — requests the price table could not cost', () => {
	it('counts an unpriced request without letting it read as a free turn', () => {
		const facts = build(EDIT_RUN, [at(1, 0, false)])

		expect([facts.unpriced_request_count, facts.request_count]).toEqual([1, 1])
	})
})

describe('time_contributor_costs.cost_lines', () => {
	it('prints nothing for a scope that never carried the record', () => {
		expect(time_contributor_costs.cost_lines(undefined)).toEqual([])
	})

	it('marks the no-tool-call row as counted, never prorated', () => {
		const lines = time_contributor_costs.cost_lines(build(EDIT_RUN, [at(30, 3)])).join('\n')

		expect(lines).toContain(time_contributor_costs.NO_TOOL_CALL_NOTE)
	})

	it('says the corpus was not read rather than printing a zero total', () => {
		const lines = time_contributor_costs.cost_lines(build(EDIT_RUN, undefined)).join('\n')

		expect(lines).toContain(time_region_costs.NOT_MEASURED_NOTE)
	})
})

// joshuafolkken/kit#1899: one response is written thinking → tool_use, sharing a request id, and the
// round trip's cost window opens at the tool_use line — the later of the two. Passed through both the
// cost parser and the span parser, the request has to land in its round trip's contributor rather
// than the no-tool-call bucket; folding its instant to the latest line is what puts it there.
const THINK_AT = '2026-09-09T01:00:00.000Z'
const TOOL_AT = '2026-09-09T01:00:30.000Z'
const RESULT_AT = '2026-09-09T01:01:00.000Z'
const CALL_ID = 'call-x'
const INTEGRATION_COST = 7

function assistant_line(timestamp: string, block: Record<string, unknown>): string {
	return JSON.stringify({
		type: 'assistant',
		requestId: 'req-x',
		timestamp,
		gitBranch: 'main',
		message: {
			id: 'msg-x',
			model: 'claude-opus-5',
			content: [block],
			usage: { input_tokens: 1, output_tokens: 1 },
		},
	})
}

function result_line(): string {
	return JSON.stringify({
		type: 'user',
		timestamp: RESULT_AT,
		message: { content: [{ type: 'tool_result', tool_use_id: CALL_ID, content: 'ok' }] },
	})
}

const THINKING_FIRST_TRANSCRIPT = [
	assistant_line(THINK_AT, { type: 'thinking', thinking: 'weighing it' }),
	assistant_line(TOOL_AT, { type: 'tool_use', name: EDIT_LABEL, id: CALL_ID, input: {} }),
	result_line(),
].join('\n')

function priced_from_transcript(): ReadonlyArray<PricedRequest> {
	const records = THINKING_FIRST_TRANSCRIPT.split('\n').flatMap((raw) => {
		const outcome = cost_usage.parse_line(raw)

		return outcome.kind === 'record' ? [outcome.record] : []
	})

	return cost_usage
		.dedupe(records)
		.map((record) => ({ at_ms: record.at_ms, cost_usd: INTEGRATION_COST, is_priced: true }))
}

function integration_facts(): ContributorCostFacts {
	return time_contributor_costs.build({
		spans: time_spans.parse_timeline(THINKING_FIRST_TRANSCRIPT).spans,
		requests: priced_from_transcript(),
		round_trip_count: 1,
	})
}

describe('time_contributor_costs.build — a thinking-first response through both parsers', () => {
	it('charges the tool-issuing request to its round trip, not the no-tool-call bucket', () => {
		expect(usd_of(integration_facts(), time_parent_turns.IMPLEMENTATION)).toBe(INTEGRATION_COST)
	})

	it('leaves the no-tool-call bucket empty', () => {
		expect(integration_facts().no_tool_call.request_count).toBe(0)
	})
})
