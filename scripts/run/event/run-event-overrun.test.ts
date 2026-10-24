import { describe, expect, it } from 'vitest'
import { run_event_overrun } from './run-event-overrun'

// joshuafolkken/kit#4772, joshuafolkken/kit#4818: the overrun notes are written and read through one
// module.

const ISSUE = 4711
const MINUTES = 55
const PID = 3616
// A `ps` start token: spaced, so the pattern reads the rest of the note.
const START = 'Sat Oct 24 09:00:00 2026'
const NOT_LAUNCHED = 'not investigated: no pid'

function launch_note(start: string | undefined): string {
	return run_event_overrun.started_text(ISSUE, MINUTES, run_event_overrun.investigating(PID, start))
}

describe('run_event_overrun — the start note', () => {
	it('writes the launch note `lane-overrun.ts` has always written when no start time was read', () => {
		const text = launch_note(undefined)

		expect(text).toBe('#4711 overran: 55 min net — investigating in pid 3616')
		expect(run_event_overrun.parse(text)).toStrictEqual({
			kind: 'started',
			issue: ISSUE,
			minutes: MINUTES,
			pid: PID,
			start: undefined,
		})
	})

	it('reads a launched session’s pid and start time back', () => {
		const text = launch_note(START)

		expect(text).toBe(`#4711 overran: 55 min net — investigating in pid 3616 started ${START}`)
		expect(run_event_overrun.parse(text)).toMatchObject({ kind: 'started', pid: PID, start: START })
	})

	it('reads a launch that started no session as a failure with its minutes', () => {
		const text = run_event_overrun.started_text(ISSUE, MINUTES, NOT_LAUNCHED)

		expect(run_event_overrun.parse(text)).toStrictEqual({
			kind: 'failed',
			issue: ISSUE,
			minutes: MINUTES,
		})
	})
})

describe('run_event_overrun — the note of a lane not investigated', () => {
	it('reads a lane at or under the threshold back with its minutes', () => {
		const text = run_event_overrun.within_text(ISSUE, MINUTES)

		expect(text).toBe('#4711 net: 55 min')
		expect(run_event_overrun.parse(text)).toStrictEqual({
			kind: 'within',
			issue: ISSUE,
			minutes: MINUTES,
		})
	})

	it('reads a skipped lane back with its reason', () => {
		const reason = 'no dispatch'
		const text = run_event_overrun.skipped_text(ISSUE, reason)

		expect(text).toBe('#4711 overrun skipped: no dispatch')
		expect(run_event_overrun.parse(text)).toStrictEqual({ kind: 'skipped', issue: ISSUE, reason })
	})
})

describe('run_event_overrun — the end note', () => {
	it('reads the session’s result note back as an end with its result', () => {
		const text = run_event_overrun.ended_text(ISSUE, run_event_overrun.FILED_RESULT)

		expect(text).toBe('#4711 overrun: filed')
		expect(run_event_overrun.parse(text)).toStrictEqual({
			kind: 'ended',
			issue: ISSUE,
			result: 'filed',
		})
	})

	it('reads a failed launch back as a failure', () => {
		const text = run_event_overrun.failed_text(ISSUE, 'no profile')

		expect(text).toBe('#4711 overrun investigation failed: no profile')
		expect(run_event_overrun.parse(text)).toStrictEqual({
			kind: 'failed',
			issue: ISSUE,
			minutes: undefined,
		})
	})

	it('reads any other note as neither', () => {
		expect(run_event_overrun.parse('#4711 merged after one round')).toBeUndefined()
	})
})

describe('run_event_overrun — the result', () => {
	it('reads the recurrence a result commented on', () => {
		const recurred = 4790
		const result = run_event_overrun.recurred_result(recurred)

		expect(result).toBe('recurred #4790')
		expect(run_event_overrun.recurred_of(result)).toBe(recurred)
		expect(run_event_overrun.recurred_of(run_event_overrun.FILED_RESULT)).toBeUndefined()
	})

	it('reads the reason a result gives for filing nothing', () => {
		const reason = 'CI wait'
		const bare = 'nothing to fix'

		expect(run_event_overrun.reason_of(run_event_overrun.none_result(reason))).toBe(reason)
		expect(run_event_overrun.reason_of(bare)).toBe(bare)
	})
})
