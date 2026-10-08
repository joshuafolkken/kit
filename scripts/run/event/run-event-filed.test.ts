import { describe, expect, it } from 'vitest'
import { run_event_filed, type Filed } from './run-event-filed'

// joshuafolkken/kit#3430: `issue:file` writes the filed event and `run:board` reads it back through one
// format, so a filing written is a filing read.

const FROM_LANE: Filed = {
	reference: '#3438',
	title: 'Count the seats again',
	found_during: '3415',
}
const ELSEWHERE: Filed = {
	reference: 'joshuafolkken/app-kit#12',
	title: 'Fix (the) port',
	found_during: undefined,
}

describe('run_event_filed', () => {
	it('writes the reference, the title and the child that found it', () => {
		expect(run_event_filed.text_of(FROM_LANE)).toBe(
			'#3438 Count the seats again (found during #3415)',
		)
	})

	it('reads back what it writes, from a lane or not', () => {
		expect(run_event_filed.parse(run_event_filed.text_of(FROM_LANE))).toStrictEqual(FROM_LANE)
		expect(run_event_filed.parse(run_event_filed.text_of(ELSEWHERE))).toStrictEqual(ELSEWHERE)
	})

	it('reads a text with no reference as nothing', () => {
		expect(run_event_filed.parse('filed something')).toBeUndefined()
	})
})
