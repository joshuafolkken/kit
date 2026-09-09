import { describe, expect, it } from 'vitest'
import { time_markers } from './time-markers'
import { time_phase_costs, type PhaseCostFacts, type PricedRequest } from './time-phase-costs'
import { time_phase_fixture } from './time-phase-fixture'
import { time_phases } from './time-phases'
import type { Span } from './time-spans'

// joshuafolkken/kit#1606: `josh time` knew the phases and `josh cost` knew the money, and no reading
// put the two together — so a proposal could be ranked in minutes and never in dollars.

const { MINUTE_MS, span } = time_phase_fixture

// Six minutes of preparation, then two minutes of editing: the setup/implement boundary the phase
// classifier already draws, reused here so the money lands in the same rows the minutes do.
const RUN: ReadonlyArray<Span> = [span(0, 6), span(6, 2, { marker: time_markers.EDIT_MARKER })]

const ROUND_TRIPS = 4

function at(minute: number, cost_usd: number): PricedRequest {
	return { at_ms: minute * MINUTE_MS, cost_usd, is_priced: true }
}

function build(requests: ReadonlyArray<PricedRequest> | undefined): PhaseCostFacts {
	return time_phase_costs.build({ spans: RUN, requests, round_trip_count: ROUND_TRIPS })
}

function usd_of(facts: PhaseCostFacts, phase: string): number {
	return facts.by_phase.find((row) => row.phase === phase)?.cost_usd ?? 0
}

describe('time_phase_costs.build — placing a billed request in the phase it was sent from', () => {
	it('charges a request to the phase whose window contains its instant', () => {
		const facts = build([at(3, 1), at(7, 2)])

		expect([
			usd_of(facts, time_phases.SETUP_PHASE),
			usd_of(facts, time_phases.IMPLEMENT_PHASE),
		]).toEqual([1, 2])
	})

	it('counts the requests of a phase beside its dollars', () => {
		const facts = build([at(1, 1), at(3, 1), at(7, 2)])
		const setup = facts.by_phase.find((row) => row.phase === time_phases.SETUP_PHASE)

		expect(setup?.request_count).toBe(2)
	})

	it('leaves a phase no request landed in out of the rows', () => {
		const facts = build([at(3, 1)])

		expect(facts.by_phase.map((row) => row.phase)).toEqual([time_phases.SETUP_PHASE])
	})
})

describe('time_phase_costs.build — the unattributed bucket', () => {
	// Prorating it across the phases would put money into stages that were demonstrably not running.
	it('keeps a request outside every phase window out of the phase rows', () => {
		const facts = build([at(3, 1), at(20, 5)])

		expect([facts.unattributed.cost_usd, usd_of(facts, time_phases.SETUP_PHASE)]).toEqual([5, 1])
	})

	it('sends a request whose instant could not be read to the same bucket', () => {
		const facts = build([{ at_ms: undefined, cost_usd: 3, is_priced: true }])

		expect([facts.unattributed.request_count, facts.by_phase.length]).toEqual([1, 0])
	})

	it('counts the unattributed bucket inside the priced total', () => {
		const facts = build([at(3, 1), at(20, 5)])

		expect([facts.cost_usd, facts.request_count]).toEqual([6, 2])
	})
})

// Every assistant line closes a model span, so a request's instant sits exactly on a span boundary far
// more often than inside one. The span that *ends* there is the model wait for that very request.
describe('time_phase_costs.build — a request sitting exactly on a phase boundary', () => {
	it('charges it to the phase whose window ends at that instant', () => {
		const facts = build([at(6, 4)])

		expect(facts.by_phase.map((row) => row.phase)).toEqual([time_phases.SETUP_PHASE])
	})

	it('charges the last instant of the run to the phase that closed there', () => {
		const facts = build([at(8, 4)])

		expect(facts.by_phase.map((row) => row.phase)).toEqual([time_phases.IMPLEMENT_PHASE])
	})
})

// A model the price table does not carry costs nothing, which would read as a free phase. The count
// is what makes the total a floor instead.
describe('time_phase_costs — requests the price table could not cost', () => {
	it('counts an unpriced request without letting it read as a measured zero', () => {
		const facts = build([{ at_ms: 3 * MINUTE_MS, cost_usd: 0, is_priced: false }])

		expect([facts.unpriced_request_count, facts.request_count]).toEqual([1, 1])
	})

	it('says the total is a floor when one was left out', () => {
		const lines = time_phase_costs
			.cost_lines(build([{ at_ms: 3 * MINUTE_MS, cost_usd: 0, is_priced: false }]))
			.join('\n')

		expect(lines).toContain(time_phase_costs.UNPRICED_NOTE)
	})

	it('prints no floor note where every model was priced', () => {
		const lines = time_phase_costs.cost_lines(build([at(3, 1)])).join('\n')

		expect(lines).not.toContain(time_phase_costs.UNPRICED_LABEL)
	})
})

// The corpus concatenates spans per session, so a run worked in two sessions arrives with its spans
// out of time order — which is what the sort in `regions_of` is for. Reversed here so that sort is
// load-bearing: read in array order, the implement span would claim the boundary instead.
const REVERSED: ReadonlyArray<Span> = [span(6, 2, { marker: time_markers.EDIT_MARKER }), span(0, 6)]

describe('time_phase_costs.build — spans that did not arrive in time order', () => {
	it('charges a boundary instant to the phase that ends there, whatever order they came in', () => {
		const facts = time_phase_costs.build({
			spans: REVERSED,
			requests: [at(6, 4)],
			round_trip_count: ROUND_TRIPS,
		})

		expect(facts.by_phase.map((row) => row.phase)).toEqual([time_phases.SETUP_PHASE])
	})
})

describe('time_phase_costs.build — the price of one round trip', () => {
	// The same denominator `ms_per_round_trip` uses, so a bundling proposal can be ranked by
	// multiplying either figure by the recoverable round trips it names.
	it('divides the priced total by the round trip count', () => {
		expect(build([at(3, 1), at(7, 3)]).usd_per_round_trip).toBe(1)
	})

	it('answers zero where there was no round trip to divide by', () => {
		const facts = time_phase_costs.build({ spans: RUN, requests: [at(3, 1)], round_trip_count: 0 })

		expect(facts.usd_per_round_trip).toBe(0)
	})
})

describe('time_phase_costs.build — a scope whose cost corpus was not read', () => {
	// Withheld is not measured as zero: the epic and last-N scopes never ask, and a reader that took
	// their zeros for a measurement would rank a phase as free.
	it('reports itself unmeasured rather than as a run that spent nothing', () => {
		expect(build(undefined).is_measured).toBe(false)
	})

	it('is measured where the read happened and found nothing', () => {
		expect(build([]).is_measured).toBe(true)
	})
})

describe('time_phase_costs.cost_lines', () => {
	it('prints nothing for a scope that never carried the record', () => {
		expect(time_phase_costs.cost_lines(undefined)).toEqual([])
	})

	it('says the corpus was not read rather than printing a zero total', () => {
		const lines = time_phase_costs.cost_lines(build(undefined)).join('\n')

		expect(lines).toContain(time_phase_costs.NOT_MEASURED_NOTE)
	})

	it('names the denominator the round-trip price was divided by', () => {
		const lines = time_phase_costs.cost_lines(build([at(3, 1)])).join('\n')

		expect(lines).toContain(time_phase_costs.DENOMINATOR_NOTE)
	})

	it('marks the unattributed row as never prorated', () => {
		const lines = time_phase_costs.cost_lines(build([at(20, 5)])).join('\n')

		expect(lines).toContain(time_phase_costs.UNATTRIBUTED_NOTE)
	})
})
