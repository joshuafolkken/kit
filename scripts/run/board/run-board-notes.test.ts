import { run_event_filed } from '#scripts/run/event/run-event-filed'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { run_board_notes } from './run-board-notes'

// joshuafolkken/kit#3430: the findings section is read off the stream alone — filings, parks and notes,
// newest first, with every other event left out.

const KIND = run_event_stream.EVENT_KIND
const AT = '2026-10-08T09:00:00.000Z'
const AT_MS = Date.parse(AT)
const TITLE = 'Count the seats'
const FOUND_DURING = '3415'

function event(kind: string, text: string, pos = 1): RunEvent {
	return { pos, at: AT, kind, text }
}

describe('run_board_notes.notes_of filings', () => {
	it('reads a filing with the child that found it', () => {
		const text = run_event_filed.text_of({
			reference: '#3438',
			kind: 'enhancement',
			title: TITLE,
			found_during: FOUND_DURING,
		})

		expect(run_board_notes.notes_of([event(KIND.FILED, text)])).toStrictEqual([
			{
				kind: 'filed',
				at_ms: AT_MS,
				issue: '3438',
				text: TITLE,
				found_during: FOUND_DURING,
				filed_kind: 'enhancement',
				is_decision: false,
			},
		])
	})
})

describe('run_board_notes.notes_of parks and order', () => {
	it('reads a park waiting on a decision apart from a bare park', () => {
		const notes = run_board_notes.notes_of([
			event(KIND.PARK, '#12 parked (needs-decision)'),
			event(KIND.PARK, '#13 parked'),
		])

		expect(notes.map((note) => [note.issue, note.text, note.is_decision])).toStrictEqual([
			['13', '', false],
			['12', 'needs-decision', true],
		])
	})

	it('keeps notes newest first and leaves out every other event and an unreadable filing', () => {
		const notes = run_board_notes.notes_of([
			event(KIND.NOTE, 'first #7', 1),
			event(KIND.STOP, 'stopped', 2),
			event(KIND.FILED, 'filed something', 3),
			event(KIND.NOTE, 'second', 4),
		])

		expect(notes.map((note) => [note.text, note.issue])).toStrictEqual([
			['second', undefined],
			['first #7', '7'],
		])
	})
})
