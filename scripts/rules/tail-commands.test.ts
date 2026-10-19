import { run_cut_report } from '#scripts/run/cut/run-cut-report'
import { time_transcript_fixture } from '#tools/time/time-transcript-fixture'
import { describe, expect, it } from 'vitest'
import { pre_gate_cut } from './pre-gate-cut'
import { tail_commands } from './tail-commands'

// joshuafolkken/kit#3936: the `Stop` hook reads a relaunched cut off the turn as a `run:cut` call
// answered by the marker, since the successor's resume may already have cleared the cut record.
const { BRANCH } = time_transcript_fixture
const { RELAUNCHED_CUT_MARKER } = run_cut_report
const RELAUNCHED = `${RELAUNCHED_CUT_MARKER}\ncut`

function call(command: string, answer: string): string {
	return [
		time_transcript_fixture.josh_call_line(1, BRANCH, command, 'call-1'),
		time_transcript_fixture.result_line(2, BRANCH, 'call-1', answer),
	].join('\n')
}

function relaunched(text: string): boolean {
	return tail_commands.answered(text, pre_gate_cut.takes_the_cut, RELAUNCHED_CUT_MARKER)
}

describe('tail_commands.answered — a relaunched cut', () => {
	it('reads a cut of either phase whose own result printed the marker', () => {
		expect(
			relaunched(call('pnpm josh run:cut --impl 3223 --handoff /tmp/h.json', RELAUNCHED)),
		).toBe(true)
		expect(relaunched(call('pnpm josh run:cut 3223', RELAUNCHED))).toBe(true)
	})

	it('does not read the held cut, which prints no marker', () => {
		expect(relaunched(call('pnpm josh run:cut --impl 3223', 'cut'))).toBe(false)
	})

	it('does not read the marker printed by any other call', () => {
		expect(relaunched(call(`grep -rn ${RELAUNCHED_CUT_MARKER} scripts`, RELAUNCHED))).toBe(false)
		expect(relaunched(call('pnpm josh run:cut --resume 3223', RELAUNCHED))).toBe(false)
	})

	it('reads an empty or unparsable text as no answer', () => {
		expect(relaunched('')).toBe(false)
		expect(relaunched('not json')).toBe(false)
	})
})
