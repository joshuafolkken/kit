import { time_transcript_fixture } from '#tools/time/time-transcript-fixture'
import { describe, expect, it } from 'vitest'
import { cost_run_cut } from './cost-run-cut'

const { BRANCH } = time_transcript_fixture
const CUT_COMMAND = 'pnpm josh run:cut --impl 3223 --handoff /tmp/3223-handoff.md'
const RESUME_COMMAND = 'pnpm josh run:cut --resume 3223'
const REFUSAL =
	'PreToolUse:Edit hook error: ⛔ implementation-phase cut: take the cut before this edit'

function text_of(lines: ReadonlyArray<string>): string {
	return lines.join('\n')
}

function cut_call(answer: string, command = CUT_COMMAND): string {
	return text_of([
		time_transcript_fixture.josh_call_line(1, BRANCH, command, 'call-1'),
		time_transcript_fixture.result_line(2, BRANCH, 'call-1', answer),
	])
}

describe('cost_run_cut.took_cut_text', () => {
	it('reads a session whose implementation cut answered cut as cut', () => {
		expect(cost_run_cut.took_cut_text(cut_call('Relaunched the lane child.\ncut'))).toBe(true)
	})

	it('does not read a guard refusal the session carried on past as cut', () => {
		const text = text_of([
			time_transcript_fixture.error_result_line(1, BRANCH, 'call-0', REFUSAL),
			time_transcript_fixture.josh_call_line(2, BRANCH, CUT_COMMAND, 'call-1'),
			time_transcript_fixture.error_result_line(3, BRANCH, 'call-1', 'busy'),
		])

		expect(cost_run_cut.took_cut_text(text)).toBe(false)
	})

	it('does not read a cut call that answered a non-cut verdict as cut', () => {
		expect(cost_run_cut.took_cut_text(cut_call('not-a-lane'))).toBe(false)
		expect(cost_run_cut.took_cut_text(cut_call('under-threshold'))).toBe(false)
	})

	it('does not read a pre-gate cut or a quoted cut command as cut', () => {
		expect(cost_run_cut.took_cut_text(cut_call('cut', 'pnpm josh run:cut 3223'))).toBe(false)
		expect(cost_run_cut.took_cut_text(cut_call('cut', `echo "${CUT_COMMAND}"`))).toBe(false)
	})

	it('reads an empty or unparsable transcript as not cut', () => {
		expect(cost_run_cut.took_cut_text('')).toBe(false)
		expect(cost_run_cut.took_cut_text('not json')).toBe(false)
	})
})

describe('cost_run_cut.is_ship_text', () => {
	it('reads a session whose cut resume answered resume as the ship phase', () => {
		expect(cost_run_cut.is_ship_text(cut_call('resume', RESUME_COMMAND))).toBe(true)
	})

	it('does not read an implementation resume or a fresh run as the ship phase', () => {
		expect(cost_run_cut.is_ship_text(cut_call('resume-impl', RESUME_COMMAND))).toBe(false)
		expect(cost_run_cut.is_ship_text(cut_call('fresh', RESUME_COMMAND))).toBe(false)
	})

	it('does not read a resume verdict answered to another call as the ship phase', () => {
		expect(cost_run_cut.is_ship_text(cut_call('resume'))).toBe(false)
		expect(cost_run_cut.is_ship_text(cut_call('resume', `echo "${RESUME_COMMAND}"`))).toBe(false)
	})
})
