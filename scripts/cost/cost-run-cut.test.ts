import { time_transcript_fixture } from '#scripts/time/time-transcript-fixture'
import { describe, expect, it } from 'vitest'
import { cost_run_cut } from './cost-run-cut'

const { BRANCH } = time_transcript_fixture
const CUT_BODY = `⛔ ${cost_run_cut.IMPLEMENTATION_CUT_GUARD}: take the cut before this edit`

function text_of(lines: ReadonlyArray<string>): string {
	return lines.join('\n')
}

describe('cost_run_cut.took_cut_text', () => {
	it('reads a session the implementation-phase cut refused as cut', () => {
		const text = text_of([
			time_transcript_fixture.prompt_line(0, BRANCH),
			time_transcript_fixture.error_result_line(1, BRANCH, 'call-1', CUT_BODY),
		])

		expect(cost_run_cut.took_cut_text(text)).toBe(true)
	})

	it('reads the refusal behind the label the harness writes in front of it', () => {
		const body = `PreToolUse:Edit hook error: ${CUT_BODY}`
		const text = text_of([time_transcript_fixture.error_result_line(1, BRANCH, 'call-1', body)])

		expect(cost_run_cut.took_cut_text(text)).toBe(true)
	})

	it('does not read a result that merely quotes the refusal as cut', () => {
		const text = text_of([time_transcript_fixture.result_line(1, BRANCH, 'call-1', CUT_BODY)])

		expect(cost_run_cut.took_cut_text(text)).toBe(false)
	})

	it('does not read another guard refusal as cut', () => {
		const body = '⛔ pre-gate cut: take the cut before the gate'
		const text = text_of([time_transcript_fixture.error_result_line(1, BRANCH, 'call-1', body)])

		expect(cost_run_cut.took_cut_text(text)).toBe(false)
	})

	it('reads an empty or unparsable transcript as not cut', () => {
		expect(cost_run_cut.took_cut_text('')).toBe(false)
		expect(cost_run_cut.took_cut_text('not json')).toBe(false)
	})
})
