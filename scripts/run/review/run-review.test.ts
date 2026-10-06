import { describe, expect, it } from 'vitest'
import { GATE_GREEN, GATE_RED, GATE_RUNNING, run_review, type ReviewTiming } from './run-review'

// joshuafolkken/kit#2179: the pure decisions `josh run:review` makes over the stamps a gate leaves —
// pinned here without a gate ever running. The acceptance criterion the suite exists for is the third:
// a red gate must not let the review verdict be adopted, which before this command the serial order
// guaranteed for free.

describe('adopt_verdict', () => {
	it('adopts the review verdict over a green gate', () => {
		expect(run_review.adopt_verdict(true)).toBe(run_review.ADOPT)
	})

	it('blocks the review verdict over a red gate', () => {
		expect(run_review.adopt_verdict(false)).toBe(run_review.BLOCKED)
	})
})

describe('gate_state', () => {
	it('reads a green stamp as green whatever the marker says', () => {
		expect(run_review.gate_state(true, true)).toBe(run_review.GATE_GREEN)
		expect(run_review.gate_state(true, false)).toBe(run_review.GATE_GREEN)
	})

	it('reads a live marker with no green stamp as still running', () => {
		expect(run_review.gate_state(false, true)).toBe(run_review.GATE_RUNNING)
	})

	it('reads no green stamp and no live marker as red', () => {
		expect(run_review.gate_state(false, false)).toBe(run_review.GATE_RED)
	})
})

describe('is_gate_settled', () => {
	it('settles on green and on red, not while running', () => {
		expect(run_review.is_gate_settled(GATE_GREEN)).toBe(true)
		expect(run_review.is_gate_settled(GATE_RED)).toBe(true)
		expect(run_review.is_gate_settled(GATE_RUNNING)).toBe(false)
	})
})

const GATE_START = '2026-09-20T10:00:00.000Z'
const REVIEW_START = '2026-09-20T10:00:02.000Z'
const GATE_END = '2026-09-20T10:00:30.000Z'
const REVIEW_END = '2026-09-20T10:02:12.000Z'

function timing_of(over: Partial<ReviewTiming> = {}): ReviewTiming {
	return {
		gate_started_at: GATE_START,
		review_started_at: REVIEW_START,
		gate_ended_at: GATE_END,
		review_ended_at: REVIEW_END,
		...over,
	}
}

describe('overlap_seconds', () => {
	it('measures from the later start to the earlier end', () => {
		// review starts at +2s, gate ends at +30s: the two ran together for 28 seconds.
		expect(run_review.overlap_seconds(timing_of())).toBe(28)
	})

	it('reports two windows that never met as no overlap', () => {
		// gate ends at +30s, review starts at +40s: a serial run, the shape this command moves off zero.
		const serial = timing_of({
			review_started_at: '2026-09-20T10:00:40.000Z',
			review_ended_at: '2026-09-20T10:02:00.000Z',
		})

		expect(run_review.overlap_seconds(serial)).toBe(0)
	})
})

describe('format_timing', () => {
	it('names the gate span, the review span and the overlap', () => {
		const report = run_review.format_timing(timing_of())

		expect(report).toContain('gate:')
		expect(report).toContain('review:')
		expect(report).toContain('overlap: 28.0s')
	})

	it('clamps a backwards span at zero rather than printing a negative duration', () => {
		// A green stamp left by an earlier run on an identical tree can end before this run started.
		const stale = timing_of({ gate_ended_at: '2026-09-20T09:59:00.000Z' })

		expect(run_review.format_timing(stale)).toContain(
			'gate:    2026-09-20T10:00:00.000Z → 2026-09-20T09:59:00.000Z (0.0s)',
		)
	})
})
