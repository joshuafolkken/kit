import { describe, expect, it } from 'vitest'
import { run_event_resume } from './run-event-resume'
import type { RunEvent } from './run-event-stream'

// joshuafolkken/kit#8583: both resumes append a `resume`; the text tells a gate resume apart.

const ISSUE = '8583'
const RESUME_KIND = 'resume'

function resume(is_gate: boolean, issue = ISSUE): RunEvent {
	return {
		pos: 0,
		at: '2026-11-22T00:00:00.000Z',
		kind: RESUME_KIND,
		text: is_gate ? run_event_resume.gate_resume_text(issue) : run_event_resume.resume_text(issue),
	}
}

describe('run_event_resume texts', () => {
	it('marks a gate resume and leaves an implementation resume as it was', () => {
		expect(run_event_resume.resume_text(ISSUE)).toBe(`#${ISSUE} resumed`)
		expect(run_event_resume.gate_resume_text(ISSUE)).toBe(`#${ISSUE} resumed (gate)`)
	})
})

describe('run_event_resume.is_gate_resume', () => {
	it('answers for a gate resume only', () => {
		expect(run_event_resume.is_gate_resume(resume(true))).toBe(true)
		expect(run_event_resume.is_gate_resume(resume(false))).toBe(false)
	})

	it('answers false for another kind ending the same way', () => {
		const note = { ...resume(true), kind: 'note' }

		expect(run_event_resume.is_gate_resume(note)).toBe(false)
	})
})

describe('run_event_resume.is_resume_of', () => {
	it('matches either resume of the issue and no other issue', () => {
		expect(run_event_resume.is_resume_of(resume(false), ISSUE)).toBe(true)
		expect(run_event_resume.is_resume_of(resume(true), ISSUE)).toBe(true)
		expect(run_event_resume.is_resume_of(resume(false, '85830'), ISSUE)).toBe(false)
	})
})
