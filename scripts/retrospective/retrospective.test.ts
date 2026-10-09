import type { RunRole } from '#scripts/cost/cost-run-nodes'
import type { RunCostReport } from '#scripts/cost/cost-run-report'
import type { RoleTotals } from '#scripts/cost/cost-run-roles'
import type { CategoryCount } from '#scripts/review/review-finding-ledger'
import { run_event_scope, type EventScope } from '#scripts/run/event/run-event-scope'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { run_ship_stop_text } from '#scripts/run/ship/run-ship-stop-text'
import { describe, expect, it } from 'vitest'
import { guard_friction_fixture } from './guard-friction-fixture'
import { retrospective, type RetrospectiveInputs } from './retrospective'

const MINUTES = 12
const MS_PER_MINUTE = 60_000
// The invocation this digest covers begins here; the fixture's own events all carry this `at`, and the
// scope tests below add earlier ones to prove they are not counted (joshuafolkken/kit#2395).
const RUN_START = '2026-09-22T00:00:00.000Z'
const BEFORE_RUN = '2026-09-19T18:00:00.000Z'

function since(started_at: string): EventScope {
	return { kind: 'since', started_at }
}

const EMPTY_COMPOSITION = {
	input_usd: 0,
	cache_write_5m_usd: 0,
	cache_write_1h_usd: 0,
	cache_read_usd: 0,
	output_usd: 0,
	total_usd: 0,
	unpriced_models: [],
}

// A role at the two shares the retrospective reads — the rest of the totals are unused by `compose` and
// held at their zero so the fixture states only what the test turns on.
function role(name: RunRole, cost_share: number, elapsed_share: number): RoleTotals {
	return {
		role: name,
		session_count: 1,
		request_count: 1,
		output_tokens: 0,
		cost_usd: 0,
		composition: EMPTY_COMPOSITION,
		preamble_tokens: 0,
		cost_share,
		elapsed_share,
		elapsed_ms: 0,
	}
}

function cost_report(roles: ReadonlyArray<RoleTotals>): RunCostReport {
	return {
		scope: 'run tree',
		session_count: roles.length,
		run_count: 1,
		merged: undefined,
		unattributed_count: 0,
		unreadable_count: 0,
		total_usd: 42,
		total_elapsed_ms: MINUTES * MS_PER_MINUTE,
		roles,
		sessions: [],
		issues: [],
	}
}

function event(kind: string, at: string = RUN_START): RunEvent {
	return { pos: 1, at, kind, text: kind }
}

const FINDINGS: ReadonlyArray<CategoryCount> = [
	{ category: 'bug-risks', count: 3 },
	{ category: 'i18n', count: 1 },
]

function inputs(overrides: Partial<RetrospectiveInputs>): RetrospectiveInputs {
	return {
		cost: cost_report([role('parent', 0.5, 0.3)]),
		findings: FINDINGS,
		zero_rounds: 4,
		observations: ['- k:one | d1 | 2026-09-22 | where | what'],
		events: [event('park'), event('park'), event('outage')],
		scope: since(RUN_START),
		sessions: [],
		...overrides,
	}
}

describe('retrospective.compose — guard friction', () => {
	const refused = guard_friction_fixture.session(guard_friction_fixture.node('lane'), [
		guard_friction_fixture.refusal_line(1, 'a', '⛔ batching: issue these together'),
		guard_friction_fixture.stop_line(2, '⛔ lane background stop: wait'),
	])

	it("tallies the run's guard refusals and Stop re-entries", () => {
		const digest = retrospective.compose(inputs({ sessions: [refused] }))

		expect(digest).toContain('Guard friction: 1 refusal(s), 1 Stop re-entry(ies)')
		expect(digest).toContain('Investigation guard payback (main-line sessions):')
	})

	it('says none when no guard fired', () => {
		expect(retrospective.compose(inputs({}))).toContain('Guard friction: none')
	})
})

describe('retrospective.compose — the four sections are aggregated', () => {
	it('leads with the run cost and time, folding in every role', () => {
		const digest = retrospective.compose(inputs({}))

		expect(digest).toContain('Run cost & time: 1 session(s), 12 min')
		expect(digest).toContain('parent:')
	})

	it('carries the review findings with their zero-finding denominator', () => {
		const digest = retrospective.compose(inputs({}))

		expect(digest).toContain('Review findings (4 zero-finding round(s)):')
		expect(digest).toContain('bug-risks: 3')
	})

	it('reports how many observation ledger entries are held', () => {
		const digest = retrospective.compose(inputs({ observations: ['a', 'b', 'c'] }))

		expect(digest).toContain('Observation ledger: 3 entry(ies) held')
	})

	it('counts each friction event kind over the run', () => {
		const digest = retrospective.compose(inputs({}))

		expect(digest).toContain('Run events: park 2, outage 1, cut 0, review-round 0')
	})

	it('closes with the pointer to retrospective.md', () => {
		expect(retrospective.compose(inputs({}))).toContain(retrospective.CLOSING)
	})
})

describe('retrospective.compose — the signals it computes', () => {
	it('marks a role whose time share runs ahead of its cost share as waiting-heavy', () => {
		const cost = cost_report([role('wake', 0.25, 0.52)])
		const digest = retrospective.compose(inputs({ cost }))

		expect(digest).toContain('wake: 25% cost, 52% time — waiting-heavy')
	})

	it('leaves a role that pays its way unmarked', () => {
		const cost = cost_report([role('parent', 0.5, 0.3)])
		const digest = retrospective.compose(inputs({ cost }))

		expect(digest).not.toContain('waiting-heavy')
	})

	it('reports no transcripts rather than inventing figures when the run tree is absent', () => {
		expect(retrospective.compose(inputs({ cost: undefined }))).toContain(
			'Run cost & time: no run transcripts found',
		)
	})

	it('records the zero-finding denominator even when no category recurred', () => {
		const digest = retrospective.compose(inputs({ findings: [], zero_rounds: 7 }))

		expect(digest).toContain('Review findings: none recorded (7 zero-finding round(s))')
	})
})

// joshuafolkken/kit#2395: the friction count covers this invocation only. The stream is the repository's
// event log, so a digest handed the whole of it would report a previous run's cut and park as this one's
// friction — the numbers the retrospective weighs to file improvement issues.
describe('retrospective.compose — the invocation scope of the friction count', () => {
	it('does not count a cut, park, outage or review-round from before the run began', () => {
		const events = [
			event('park', BEFORE_RUN),
			event('cut', BEFORE_RUN),
			event('outage', BEFORE_RUN),
			event('review-round', BEFORE_RUN),
			event('park'),
		]
		const digest = retrospective.compose(inputs({ events }))

		expect(digest).toContain('Run events: park 1, outage 0, cut 0, review-round 0')
	})

	it('counts nothing rather than the whole stream when the scope cannot be determined', () => {
		const events = [event('park', BEFORE_RUN), event('park'), event('outage')]
		const digest = retrospective.compose(
			inputs({ events, scope: run_event_scope.UNKNOWN_EVENT_SCOPE }),
		)

		expect(digest).toContain('Run events: park 0, outage 0, cut 0, review-round 0')
	})
})

// joshuafolkken/kit#3245: where the run's ship supervisors stopped, by stage, read back from the very
// text the supervisor writes.
function ship_stop(reason: string, at: string = RUN_START): RunEvent {
	return { pos: 1, at, kind: 'ship-stop', text: run_ship_stop_text.format('3245', reason) }
}

describe('retrospective.compose — ship stops by stage', () => {
	it('counts this invocation’s ship stops per stage in the order they first occurred', () => {
		const events = [
			ship_stop('gate'),
			ship_stop('review'),
			ship_stop('gate'),
			ship_stop('followup', BEFORE_RUN),
		]

		expect(retrospective.compose(inputs({ events }))).toContain('Ship stops: gate 2, review 1')
	})

	it('reports no ship stops when the run had none', () => {
		expect(retrospective.compose(inputs({}))).toContain('Ship stops: none')
	})
})
