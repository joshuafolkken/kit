import { time_span_fixture } from '#tools/time/time-span-fixture'
import { describe, expect, it } from 'vitest'
import { time_bundles } from './time-bundles'
import { time_spans, type Span } from './time-spans'

const MODEL = time_span_fixture.span(time_spans.MODEL_CATEGORY)
const launch = time_span_fixture.launch_span

function call(target: string): Span {
	return {
		...time_span_fixture.span(time_spans.TOOL_CATEGORY),
		is_bundleable: true,
		targets: [target],
	}
}

function single_call_turns(targets: ReadonlyArray<string>): Array<Span> {
	return targets.flatMap((target) => [MODEL, call(target)])
}

describe('time_bundles.build_bundles — the single-call split', () => {
	it('counts each single-call turn that shared a target with the open sequence', () => {
		const { single_call } = time_bundles.build_bundles(
			single_call_turns(['a.ts', 'a.ts', 'b.ts', 'scripts/b.ts']),
		)

		expect(single_call.dependent_round_trips).toBe(2)
		expect(single_call.independent_round_trips).toBe(1)
	})

	it('counts no dependent turn where every call names its own target', () => {
		const { single_call } = time_bundles.build_bundles(single_call_turns(['a.ts', 'b.ts', 'c.ts']))

		expect(single_call.dependent_round_trips).toBe(0)
		expect(single_call.independent_round_trips).toBe(2)
	})

	// The spread-apart launch series is never walked, so it enters neither side of the split — only the
	// run's own recoverable total.
	it('leaves the Agent launch series out of the split', () => {
		const launches = [MODEL, launch('m1'), MODEL, launch('m2'), MODEL, launch('m3')]
		const totals = time_bundles.build_bundles([...single_call_turns(['a.ts', 'b.ts']), ...launches])

		expect(totals.recoverable_round_trips).toBe(3)
		expect(totals.single_call.independent_round_trips).toBe(1)
		expect(totals.single_call.by_tool.map((row) => row.label)).not.toContain('Agent')
	})

	it('leaves the split at zero for a run never read', () => {
		expect(time_bundles.NO_BUNDLES.single_call.dependent_round_trips).toBe(0)
	})
})
