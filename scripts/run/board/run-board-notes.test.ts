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
const NO_TITLES = new Map<number, string>()
const PARKED_TITLE = 'Read the lanes'
const BARE_PARK = '#13 parked'

function event(kind: string, text: string, pos = 1): RunEvent {
	return { pos, at: AT, kind, text }
}

function park_texts(texts: ReadonlyArray<string>): Array<[string, boolean]> {
	const titles = new Map([[13, PARKED_TITLE]])
	const events = texts.map((text) => event(KIND.PARK, text))

	return run_board_notes
		.notes_of(events, titles)
		.toReversed()
		.map((note) => [note.text, note.is_decision])
}

// joshuafolkken/kit#3531: a park names the parked issue by the board's title, its reason after it.
describe('run_board_notes.notes_of park titles', () => {
	it('names a bare park by its title', () => {
		expect(park_texts([BARE_PARK])).toStrictEqual([[PARKED_TITLE, false]])
	})

	it('puts the reason after the title, a decision still told apart', () => {
		expect(park_texts(['#13 parked (needs-decision)', '#13 waiting on #7'])).toStrictEqual([
			[`${PARKED_TITLE} (needs-decision)`, true],
			[`${PARKED_TITLE} (waiting on #7)`, false],
		])
	})

	it('keeps the reason alone for an issue the board has no title for', () => {
		expect(park_texts(['#14 waiting on #7', '#14 parked'])).toStrictEqual([
			['waiting on #7', false],
			['', false],
		])
	})
})

describe('run_board_notes.notes_of filings', () => {
	it('reads a filing with the child that found it', () => {
		const text = run_event_filed.text_of({
			reference: '#3438',
			kind: 'enhancement',
			title: TITLE,
			found_during: FOUND_DURING,
		})

		expect(run_board_notes.notes_of([event(KIND.FILED, text)], NO_TITLES)).toStrictEqual([
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
		const notes = run_board_notes.notes_of(
			[event(KIND.PARK, '#12 parked (needs-decision)'), event(KIND.PARK, BARE_PARK)],
			NO_TITLES,
		)

		expect(notes.map((note) => [note.issue, note.text, note.is_decision])).toStrictEqual([
			['13', '', false],
			['12', 'needs-decision', true],
		])
	})

	it('keeps notes newest first and leaves out every other event and an unreadable filing', () => {
		const notes = run_board_notes.notes_of(
			[
				event(KIND.NOTE, 'first #7', 1),
				event(KIND.STOP, 'stopped', 2),
				event(KIND.FILED, 'filed something', 3),
				event(KIND.NOTE, 'second', 4),
			],
			NO_TITLES,
		)

		expect(notes.map((note) => [note.text, note.issue])).toStrictEqual([
			['second', undefined],
			['first #7', '7'],
		])
	})
})

describe('run_board_notes.notes_of', () => {
	it('lists filings, parks and notes newest first, telling a needs-decision park apart', () => {
		const events = [
			event(KIND.FILED, '#3438 Count the seats again (found during #3415)', 1),
			event(KIND.PARK, '#3433 parked (needs-decision)', 2),
			event(KIND.NOTE, '#3415 gate took 40% longer', 3),
			event(KIND.PARK, '#3409 parked', 4),
			event(KIND.MERGE, '#3420 merged', 5),
		]
		const notes = run_board_notes.notes_of(events, NO_TITLES)

		expect(notes.map((note) => [note.kind, note.issue, note.is_decision])).toStrictEqual([
			['park', '3409', false],
			['note', '3415', false],
			['park', '3433', true],
			['filed', '3438', false],
		])
		expect(notes.at(-1)).toMatchObject({ text: 'Count the seats again', found_during: '3415' })
	})

	it('keeps an Issue filed elsewhere qualified', () => {
		const [note] = run_board_notes.notes_of(
			[event(KIND.FILED, 'joshuafolkken/app-kit#12 Fix the port')],
			NO_TITLES,
		)

		expect(note?.issue).toBe('joshuafolkken/app-kit#12')
	})
})
