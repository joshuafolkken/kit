import { describe, expect, it } from 'vitest'
import { time_lead, type Cover } from './time-lead'
import type { Interval } from './time-overlap'
import { time_phase_fixture } from './time-phase-fixture'
import { time_phases, type PhaseName } from './time-phases'

const { span } = time_phase_fixture

const SECOND_MS = 1000
const GATE_OVERLAP_S = 30
const REVIEW_OVERLAP_S = 60
const WINDOW_LENGTH_S = 100

function cover(start_s: number, length_s: number, phase: PhaseName, label: string): Cover {
	return {
		interval: { started_ms: start_s * SECOND_MS, ended_ms: (start_s + length_s) * SECOND_MS },
		phase,
		label,
	}
}

const WINDOW: Interval = { started_ms: 0, ended_ms: WINDOW_LENGTH_S * SECOND_MS }
const GATE = cover(0, GATE_OVERLAP_S, time_phases.GATE_PHASE, 'gate')
const REVIEW = cover(GATE_OVERLAP_S, REVIEW_OVERLAP_S, time_phases.REVIEW_PHASE, 'review')

describe('time_lead.weighted', () => {
	it('weights each key by how much of the window it overlapped, not by its own length', () => {
		const totals = time_lead.weighted(WINDOW, [GATE, REVIEW], (one) => one.label)

		expect(totals.get('gate')).toBe(GATE_OVERLAP_S * SECOND_MS)
		expect(totals.get('review')).toBe(REVIEW_OVERLAP_S * SECOND_MS)
	})

	it('leaves out a cover whose key is the empty label', () => {
		const blank = cover(0, GATE_OVERLAP_S, time_phases.GATE_PHASE, time_lead.NO_LEAD)
		const totals = time_lead.weighted(WINDOW, [blank], (one) => one.label)

		expect(totals.size).toBe(0)
	})
})

describe('time_lead.lead', () => {
	it('names the phase and label that overlapped the window longest', () => {
		const lead = time_lead.lead(WINDOW, [GATE, REVIEW])

		expect(lead.phase).toBe(time_phases.REVIEW_PHASE)
		expect(lead.label).toBe('review')
	})

	it('reports the empty lead where nothing overlapped', () => {
		const lead = time_lead.lead(WINDOW, [])

		expect(lead.phase).toBe(time_lead.NO_LEAD)
		expect(lead.label).toBe(time_lead.NO_LEAD)
	})
})

describe('time_lead.covers_of', () => {
	it('classifies each span and drops the ones the predicate excludes', () => {
		const spans = [span(0, 1, { label: 'a' }), span(2, 1, { label: 'b' })]

		const kept = time_lead.covers_of(spans, (one) => one.label === 'a')

		expect(kept.map((one) => one.label)).toEqual(['b'])
	})

	it('keeps every span when the predicate excludes nothing', () => {
		const spans = [span(0, 1, { label: 'a' }), span(2, 1, { label: 'b' })]

		expect(time_lead.covers_of(spans, () => false)).toHaveLength(spans.length)
	})
})
