import { describe, expect, it } from 'vitest'
import { run_event_baseline } from './run-event-baseline'

// joshuafolkken/kit#4887: the baseline investigation's notes are written and read back by one wording.

const OUTCOME = 'investigating in pid 42'
const FAILURE = 'spawn failed'

describe('run_event_baseline — the texts read back', () => {
	it('reads the launch with its merge count and outcome', () => {
		const text = run_event_baseline.started_text(30, OUTCOME)

		expect(text).toBe(`baseline @30 merges: started — ${OUTCOME}`)
		expect(run_event_baseline.parse(text)).toStrictEqual({
			kind: 'started',
			merges: 30,
			outcome: OUTCOME,
		})
	})

	it("reads the session's result with its merge count", () => {
		const text = run_event_baseline.ended_text(60, 'filed')

		expect(run_event_baseline.parse(text)).toStrictEqual({
			kind: 'ended',
			merges: 60,
			result: 'filed',
		})
	})

	it('reads a failure, which names no merge count', () => {
		const text = run_event_baseline.failed_text(FAILURE)

		expect(run_event_baseline.parse(text)).toStrictEqual({ kind: 'failed', note: FAILURE })
	})

	it('reads no other note as a baseline note', () => {
		expect(run_event_baseline.parse('#4887 overrun: filed')).toBeUndefined()
	})
})
