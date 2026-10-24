import { describe, expect, it } from 'vitest'
import { run_event_overrun } from './run-event-overrun'

// joshuafolkken/kit#4772: the overrun investigation's notes are written and read through one module.

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
			pid: PID,
			start: undefined,
		})
	})

	it('reads a launched session’s pid and start time back', () => {
		const text = launch_note(START)

		expect(text).toBe(`#4711 overran: 55 min net — investigating in pid 3616 started ${START}`)
		expect(run_event_overrun.parse(text)).toStrictEqual({
			kind: 'started',
			issue: ISSUE,
			pid: PID,
			start: START,
		})
	})

	it('reads a launch that started no session as neither a start nor an end', () => {
		const text = run_event_overrun.started_text(ISSUE, MINUTES, NOT_LAUNCHED)

		expect(run_event_overrun.parse(text)).toBeUndefined()
	})

	it('opens every start note with the prefix a merge collected again looks for', () => {
		const text = run_event_overrun.started_text(ISSUE, MINUTES, NOT_LAUNCHED)

		expect(text.startsWith(run_event_overrun.started_prefix(ISSUE))).toBe(true)
	})
})

describe('run_event_overrun — the end note', () => {
	it('reads the session’s result note back as an end', () => {
		const text = run_event_overrun.ended_text(ISSUE, 'filed #4768, #4769')

		expect(text).toBe('#4711 overrun: filed #4768, #4769')
		expect(run_event_overrun.parse(text)).toStrictEqual({ kind: 'ended', issue: ISSUE })
	})

	it('reads a failed launch back as an end', () => {
		const text = run_event_overrun.failed_text(ISSUE, 'no profile')

		expect(text).toBe('#4711 overrun investigation failed: no profile')
		expect(run_event_overrun.parse(text)).toStrictEqual({ kind: 'ended', issue: ISSUE })
	})

	it('reads any other note as neither', () => {
		expect(run_event_overrun.parse('#4711 merged after one round')).toBeUndefined()
	})
})
