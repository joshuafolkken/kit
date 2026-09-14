import { time_spans, type Span } from '#scripts/time-runtime/time-spans'
import { describe, expect, it } from 'vitest'
import {
	time_parent_timeline,
	type ParentTimeline,
	type RequestContext,
} from './time-parent-timeline'
import type { PricedRequest } from './time-region-costs'
import { time_span_fixture } from './time-span-fixture'

// joshuafolkken/kit#1940: a `backlogrun` parent's own timeline — when it first dispatched a lane, what
// it waited on in the foreground, and the work it implemented itself. The synthetic run below is the
// 2026-09-13 parent in miniature: a 10-minute foreground `followup` before the first lane, two lanes,
// and the parent editing a parked child (#1909) at ~289k carried context.

const { MINUTE_MS, outcome_span } = time_span_fixture
const { LANE_DISPATCH } = time_parent_timeline

const NO_LABEL = ''
const NO_ISSUE = -1
const FOLLOWUP_COMMAND = 'josh followup'
const SLEEP_LABEL = 'Bash: sleep'
const FOLLOWUP_MINUTES = 10
const SLEEP_MINUTES = 2
const CONTEXT_LOW = 288_000
const CONTEXT_HIGH = 290_000
const MEDIAN_CONTEXT = 289_000

function timed(end_minute: number, minutes: number, label: string, josh_command = NO_LABEL): Span {
	return {
		...outcome_span(end_minute, time_spans.UNKNOWN_OUTCOME, label, josh_command),
		...time_spans.equal_durations(minutes * MINUTE_MS),
	}
}

function think(end_minute: number): Span {
	return { ...timed(end_minute, 1, NO_LABEL), category: time_spans.MODEL_CATEGORY }
}

function dispatch(end_minute: number, issue: number): Span {
	return { ...timed(end_minute, 1, NO_LABEL, LANE_DISPATCH), issue }
}

function edit(end_minute: number, issue: number): Span {
	return { ...timed(end_minute, 1, 'Edit'), issue }
}

// The parent in miniature. Every tool span sits in its own round trip, separated by a think, so a
// dispatch reads as `other` and the edit as `implementation` the way `contributor_of_trip` names them.
const PARENT_RUN: ReadonlyArray<Span> = [
	think(1),
	timed(13, FOLLOWUP_MINUTES, NO_LABEL, FOLLOWUP_COMMAND),
	think(14),
	dispatch(19, 1904),
	think(20),
	dispatch(21, 1905),
	think(23),
	edit(25, 1909),
	think(27),
	timed(30, SLEEP_MINUTES, SLEEP_LABEL),
]

// Two requests inside the edit's round trip [24, 25]: their price is the implementation cost, their
// context the median. Nothing sits inside the foreground `followup` window, so the edit's work is what
// item three reports.
const PRICED: ReadonlyArray<PricedRequest> = [
	{ at_ms: 24 * MINUTE_MS, cost_usd: 2, is_priced: true },
	{ at_ms: 25 * MINUTE_MS, cost_usd: 3, is_priced: true },
]
const REQUESTS: ReadonlyArray<RequestContext> = [
	{ at_ms: 24 * MINUTE_MS, billed_input: CONTEXT_LOW },
	{ at_ms: 25 * MINUTE_MS, billed_input: CONTEXT_HIGH },
]

function parent_timeline(spans: ReadonlyArray<Span> = PARENT_RUN): ParentTimeline {
	return time_parent_timeline.build_parent_timeline({ spans, priced: PRICED, requests: REQUESTS })
}

describe('time_parent_timeline.build_parent_timeline — first lane dispatch', () => {
	it('times the run start to the first dispatch and lists each lane', () => {
		const { dispatch: timing } = parent_timeline()

		expect([timing.first_offset_ms, timing.dispatches.map((one) => one.issue)]).toEqual([
			18 * MINUTE_MS,
			[1904, 1905],
		])
	})

	it('reads no dispatch as no lane dispatched rather than zero minutes', () => {
		const { dispatch: timing } = parent_timeline([edit(2, NO_ISSUE)])

		expect([timing.is_measured, timing.has_dispatch]).toEqual([true, false])
	})

	it('withholds the block where no transcript was read', () => {
		expect(parent_timeline([]).dispatch.is_measured).toBe(false)
	})
})

describe('time_parent_timeline.build_parent_timeline — foreground waits', () => {
	it('lists each foreground wait with its command and totals them', () => {
		const { foreground_waits } = parent_timeline()

		expect([foreground_waits.total_ms, foreground_waits.waits.map((one) => one.command)]).toEqual([
			(FOLLOWUP_MINUTES + SLEEP_MINUTES) * MINUTE_MS,
			[FOLLOWUP_COMMAND, SLEEP_LABEL],
		])
	})

	it('reports no foreground wait where nothing blocked in the foreground', () => {
		const { foreground_waits } = parent_timeline([edit(2, 1909)])

		expect(foreground_waits.waits).toEqual([])
	})

	it('orders the waits by start time, not by span array order', () => {
		const late = timed(30, SLEEP_MINUTES, SLEEP_LABEL)
		const early = timed(15, FOLLOWUP_MINUTES, NO_LABEL, FOLLOWUP_COMMAND)
		const { foreground_waits } = parent_timeline([late, early])

		expect(foreground_waits.waits.map((one) => one.command)).toEqual([
			FOLLOWUP_COMMAND,
			SLEEP_LABEL,
		])
	})
})

describe('time_parent_timeline.build_parent_timeline — own implementation', () => {
	it('sums the implementation-turn requests, cost, median context and issue', () => {
		const { implementation } = parent_timeline()

		expect([
			implementation.request_count,
			implementation.cost_usd,
			implementation.median_context_tokens,
			implementation.issues,
		]).toEqual([2, 5, MEDIAN_CONTEXT, [1909]])
	})

	it('withholds the block where the cost corpus was not read', () => {
		const withheld = time_parent_timeline.build_parent_timeline({
			spans: PARENT_RUN,
			priced: undefined,
			requests: undefined,
		})

		expect(withheld.implementation.is_measured).toBe(false)
	})

	it('reports nothing implemented where no implementation turn ran', () => {
		const only_dispatch = time_parent_timeline.build_parent_timeline({
			spans: [dispatch(2, 1904)],
			priced: [],
			requests: [],
		})

		expect([
			only_dispatch.implementation.is_measured,
			only_dispatch.implementation.request_count,
		]).toEqual([true, 0])
	})
})

describe('time_parent_timeline.parent_timeline_lines', () => {
	it('renders the three blocks with the dispatched lane and the implemented issue', () => {
		const text = time_parent_timeline.parent_timeline_lines(parent_timeline()).join('\n')

		expect(text).toContain('dispatch #1904')
		expect(text).toContain('for #1909')
	})

	it('names no lane dispatched rather than a zero', () => {
		const text = time_parent_timeline
			.parent_timeline_lines(
				time_parent_timeline.build_parent_timeline({
					spans: [edit(2, NO_ISSUE)],
					priced: [],
					requests: [],
				}),
			)
			.join('\n')

		expect(text).toContain(time_parent_timeline.NO_DISPATCH)
	})

	it('withholds the whole block where no scope built it', () => {
		expect(time_parent_timeline.parent_timeline_lines(undefined)).toEqual([])
	})
})
