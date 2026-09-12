import { describe, expect, it } from 'vitest'
import { time_agent_bundles } from './time-agent-bundles'
import { time_bundles } from './time-bundles'
import { time_span_fixture } from './time-span-fixture'
import { time_spans, type Span } from './time-spans'

const MODEL = time_span_fixture.span(time_spans.MODEL_CATEGORY)
const launch = time_span_fixture.launch_span

// A write, which is what separates a launch that reads produced code from one that could have fanned
// out with the launches before it.
function write(): Span {
	return { ...time_span_fixture.span(time_spans.TOOL_CATEGORY), label: 'Write', is_writing: true }
}

// The detector returns the fan-out group sizes, each of two turns or more — the shape `time-bundles.ts`
// prices a sequence list in.
describe('time_agent_bundles.agent_bundles — counting a fan-out', () => {
	it('recovers nothing from a run with no launch', () => {
		expect(time_agent_bundles.agent_bundles([MODEL, write()])).toEqual([])
	})

	// Run #1839's investigation trio: three launches, three turns, nothing written between them.
	it('reads serial independent launches as one fan-out of the count of turns', () => {
		const spans = [MODEL, launch('m1'), MODEL, launch('m2'), MODEL, launch('m3')]

		expect(time_agent_bundles.agent_bundles(spans)).toEqual([3])
	})

	// The review finders: three launches sharing one message id are one turn, so the group is one turn
	// and dropped.
	it('collapses launches that share a turn', () => {
		const spans = [MODEL, launch('m1'), launch('m1'), launch('m1')]

		expect(time_agent_bundles.agent_bundles(spans)).toEqual([])
	})
})

describe('time_agent_bundles.agent_bundles — what breaks a fan-out', () => {
	// A certain write between two launches is the read-after-write dependency the review launch has on
	// the implementation it names, so neither one-turn group survives.
	it('breaks a fan-out at a write between two launches', () => {
		const spans = [MODEL, launch('m1'), write(), MODEL, launch('m2')]

		expect(time_agent_bundles.agent_bundles(spans)).toEqual([])
	})

	// The read-only chain a write cannot mark (joshuafolkken/kit#1847).
	it('breaks a fan-out at a launch that references a prior finding', () => {
		const spans = [MODEL, launch('m1'), MODEL, launch('m2', true)]

		expect(time_agent_bundles.agent_bundles(spans)).toEqual([])
	})

	// A launch carrying no message id cannot claim to share a turn, so each opens one of its own.
	it('reads launches with no message id as separate turns', () => {
		const spans = [MODEL, launch(time_spans.NO_MESSAGE_ID), MODEL, launch(time_spans.NO_MESSAGE_ID)]

		expect(time_agent_bundles.agent_bundles(spans)).toEqual([2])
	})

	// A dependent launch starts a new group rather than ending the count, so a run holds several
	// fan-outs, biggest first in run order.
	it('reads two fan-outs split by a write', () => {
		const first = [MODEL, launch('m1'), MODEL, launch('m2'), MODEL, launch('m3')]
		const second = [write(), MODEL, launch('m4'), MODEL, launch('m5')]

		expect(time_agent_bundles.agent_bundles([...first, ...second])).toEqual([3, 2])
	})
})

// The series as it reaches build_bundles — run #1839 end to end (joshuafolkken/kit#1854). Three serial
// investigation launches, then the implementation, then three review launches in one turn, then a
// round-2 launch after the fixes. Only the investigation trio is recoverable: the review turn and the
// round-2 launch each sit behind a write.
describe('time_bundles.build_bundles — the launch series folded in', () => {
	it('reads run #1839 as two recoverable investigation trips and nothing from review', () => {
		const investigation = [MODEL, launch('i1'), MODEL, launch('i2'), MODEL, launch('i3')]
		const review = [MODEL, write(), MODEL, launch('r1'), launch('r1'), launch('r1')]
		const round_two = [MODEL, write(), MODEL, launch('r2')]
		const totals = time_bundles.build_bundles([...investigation, ...review, ...round_two])

		expect(totals.recoverable_round_trips).toBe(2)
		expect(totals.longest_sequence).toBe(3)
		expect(totals.by_tool).toEqual([
			{ label: 'Agent', sequence_count: 1, recoverable_round_trips: 2 },
		])
		expect(totals.unattributed_round_trips).toBe(0)
	})
})
