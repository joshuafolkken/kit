import { describe, expect, it } from 'vitest'
import { time_guard_refusals, type GuardRefusalFacts } from './time-guard-refusals'
import { time_line_fixture } from './time-line-fixture'
import type { PricedRequest } from './time-region-costs'
import { time_spans, type Span } from './time-spans'
import { time_transcript_line } from './time-transcript-line'

const { at, error_body, prompt, tool_result, tool_use } = time_line_fixture
const { MINUTE_MS } = time_line_fixture

const GATE = { command: 'pnpm josh gate' }
const PRE_GATE_GUARD = 'pre-gate cut'
const INVESTIGATION_GUARD = 'investigation'
// The openings a real hook writes back — the token before the first `:` is the guard.
const PRE_GATE_REASON = '⛔ pre-gate cut: this checkout is a lane dispatched for this issue'
const INVESTIGATION_REASON =
	'⛔ investigation: 3 files read and not edited since the last delegated unit'

// A gate refused by pre-gate-cut, then re-issued as the identical call (the false-positive shape), and
// a Read refused by the investigation guard with nothing re-issued after it.
const REFUSALS = [
	prompt(0),
	tool_use(1, 'Bash', 'c1', GATE),
	error_body(2, 'c1', PRE_GATE_REASON),
	tool_use(3, 'Bash', 'c2', GATE),
	tool_result(4, 'c2'),
	tool_use(5, 'Read', 'c3', { file_path: 'scripts/x.ts' }),
	error_body(6, 'c3', INVESTIGATION_REASON),
].join('\n')

const PRE_GATE_MINUTE = 1
const INVESTIGATION_MINUTE = 5
const PRE_GATE_COST = 0.5
const INVESTIGATION_COST = 0.3
const TOTAL_COST = 0.8

// The absolute instant a fixture minute lands on — the same epoch the parser dates spans by, so a
// request placed here falls inside the region built from those spans.
function ms(minute: number): number {
	return new Date(at(minute)).getTime()
}

// One priced request per refused call, placed on the instant its composing model wait ended so it
// lands inside that refusal's region.
const REQUESTS: ReadonlyArray<PricedRequest> = [
	{ at_ms: ms(PRE_GATE_MINUTE), cost_usd: PRE_GATE_COST, is_priced: true },
	{ at_ms: ms(INVESTIGATION_MINUTE), cost_usd: INVESTIGATION_COST, is_priced: true },
]

function spans_of(text: string): Array<Span> {
	return time_spans.parse_timeline(text).spans
}

function facts_of(
	text: string,
	requests: ReadonlyArray<PricedRequest> | undefined,
): GuardRefusalFacts {
	return time_guard_refusals.build({ spans: spans_of(text), requests })
}

function row_for(facts: GuardRefusalFacts, guard: string): GuardRefusalFacts['by_guard'][number] {
	const row = facts.by_guard.find((one) => one.guard === guard)

	if (row === undefined) throw new Error(`no row for ${guard}`)

	return row
}

describe('guard identification from the refusal opening', () => {
	const { guard_from_refusal } = time_transcript_line

	it('reads the token before the first colon', () => {
		expect(guard_from_refusal(PRE_GATE_REASON)).toBe(PRE_GATE_GUARD)
	})

	it('takes the whole headline when the reason carries no colon', () => {
		expect(guard_from_refusal('⛔ scoped checks not green on this tree')).toBe(
			'scoped checks not green on this tree',
		)
	})

	it('is empty for a body that is not a refusal', () => {
		expect(guard_from_refusal('done')).toBe('')
	})
})

describe('per-guard refusal breakdown', () => {
	it('counts each guard, the investigation guard included', () => {
		const facts = facts_of(REFUSALS, undefined)

		expect(facts.refusal_count).toBe(2)
		expect(row_for(facts, PRE_GATE_GUARD).refusal_count).toBe(1)
		expect(row_for(facts, INVESTIGATION_GUARD).refusal_count).toBe(1)
	})

	it('marks a refusal the run re-issued the same call past', () => {
		const facts = facts_of(REFUSALS, undefined)

		expect(row_for(facts, PRE_GATE_GUARD).same_args_reissue_count).toBe(1)
		expect(row_for(facts, INVESTIGATION_GUARD).same_args_reissue_count).toBe(0)
	})

	it('reports the re-issue cost as unmeasured when the corpus was not read', () => {
		const facts = facts_of(REFUSALS, undefined)

		expect(facts.is_cost_measured).toBe(false)
		expect(row_for(facts, PRE_GATE_GUARD).cost_usd).toBe(0)
	})

	it('prices the re-issue per guard from the composing request', () => {
		const facts = facts_of(REFUSALS, REQUESTS)

		expect(facts.is_cost_measured).toBe(true)
		expect(row_for(facts, PRE_GATE_GUARD).cost_usd).toBeCloseTo(PRE_GATE_COST)
		expect(row_for(facts, INVESTIGATION_GUARD).cost_usd).toBeCloseTo(INVESTIGATION_COST)
		expect(facts.cost_usd).toBeCloseTo(TOTAL_COST)
	})

	it('charges each refusal the model wait that composed it', () => {
		const facts = facts_of(REFUSALS, REQUESTS)

		// The region opens at the preceding model span, so a one-minute wait plus a one-minute call is
		// two minutes of re-issue time.
		expect(row_for(facts, PRE_GATE_GUARD).reissue_ms).toBe(2 * MINUTE_MS)
	})
})

describe('rendering', () => {
	it('prints a line per guard when refusals happened', () => {
		const lines = time_guard_refusals.guard_refusal_lines(facts_of(REFUSALS, REQUESTS))
		const text = lines.join('\n')

		expect(text).toContain(time_guard_refusals.HEADING)
		expect(text).toContain(PRE_GATE_GUARD)
		expect(text).toContain(INVESTIGATION_GUARD)
		expect(text).toContain('re-issued same args')
	})

	it('prints nothing when no guard refused', () => {
		const clean = [
			prompt(0),
			tool_use(1, 'Read', 'c1', { file_path: 'x' }),
			tool_result(2, 'c1'),
		].join('\n')

		expect(time_guard_refusals.guard_refusal_lines(facts_of(clean, undefined))).toEqual([])
	})

	it('reports nothing measured for a transcript that was never read', () => {
		const facts = time_guard_refusals.build({ spans: [], requests: undefined })

		expect(facts.is_measured).toBe(false)
		expect(facts.by_guard).toEqual([])
		expect(time_guard_refusals.guard_refusal_lines(facts)).toEqual([])
	})
})
