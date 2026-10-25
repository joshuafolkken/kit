import { run_event_baseline } from '#scripts/run/event/run-event-baseline'
import { run_event_filed, type Filed } from '#scripts/run/event/run-event-filed'
import { run_event_overrun } from '#scripts/run/event/run-event-overrun'
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
const DECISION_PARK_13 = '#13 parked (needs-decision)'
const WAITING_PARK_13 = '#13 waiting on #7'
const ELSEWHERE = 'joshuafolkken/app-kit#12'
const FILED: Filed = {
	reference: '#3438',
	kind: 'enhancement',
	title: TITLE,
	found_during: FOUND_DURING,
	is_run: true,
}

function event(kind: string, text: string, pos = 1): RunEvent {
	return { pos, at: AT, kind, text }
}

function filed_event(filed: Partial<Filed>, pos = 1): RunEvent {
	return event(KIND.FILED, run_event_filed.text_of({ ...FILED, ...filed }), pos)
}

function park_texts(texts: ReadonlyArray<string>): Array<string> {
	const titles = new Map([[13, PARKED_TITLE]])
	const events = texts.map((text) => event(KIND.PARK, text))

	return run_board_notes
		.notes_of(events, titles)
		.toReversed()
		.map((note) => note.text)
}

// joshuafolkken/kit#3531: a park names the parked issue by the board's title, its reason after it.
describe('run_board_notes.notes_of park titles', () => {
	it('names a bare park by its title', () => {
		expect(park_texts([BARE_PARK])).toStrictEqual([PARKED_TITLE])
	})

	it('puts the reason after the title', () => {
		expect(park_texts([WAITING_PARK_13])).toStrictEqual([`${PARKED_TITLE} (waiting on #7)`])
	})

	// joshuafolkken/kit#4045, #4127: only the parks of the children the board lists are said — not one
	// its row draws the reason of, nor one a person released or closed.
	it('keeps only the parks of the listed children', () => {
		const events = [WAITING_PARK_13, '#14 parked (cap)'].map((text) => event(KIND.PARK, text))
		const notes = run_board_notes.notes_of(events, NO_TITLES, new Set([14]))

		expect(notes.map((note) => note.issue)).toStrictEqual(['14'])
	})

	it('keeps the reason alone for an issue the board has no title for', () => {
		expect(park_texts(['#14 waiting on #7', '#14 parked'])).toStrictEqual(['waiting on #7', ''])
	})
})

// joshuafolkken/kit#4099: a decision park is no finding — its row is in the 🙋 decision section while
// it stays parked, and once the child resumes the decision is made.
describe('run_board_notes.notes_of decision parks', () => {
	it('leaves out a park waiting on a decision, drawn row or not', () => {
		const events = [
			event(KIND.PARK, DECISION_PARK_13),
			event(KIND.PARK, '#12 parked (needs-decision)'),
		]

		expect(run_board_notes.notes_of(events, NO_TITLES, new Set([13]))).toStrictEqual([])
		expect(run_board_notes.notes_of(events, NO_TITLES)).toStrictEqual([])
	})
})

describe('run_board_notes.notes_of filings', () => {
	it('reads a filing with the child that found it', () => {
		expect(run_board_notes.notes_of([filed_event({})], NO_TITLES)).toStrictEqual([
			{
				kind: 'filed',
				at_ms: AT_MS,
				issue: '3438',
				text: TITLE,
				found_during: FOUND_DURING,
				filed_kind: 'enhancement',
			},
		])
	})

	// joshuafolkken/kit#4099: a session outside the run writes to the same stream.
	it('leaves out a filing no run session marked, and one written before the mark', () => {
		const events = [
			filed_event({ is_run: false }, 1),
			event(KIND.FILED, '#3439 Count the seats again (found during #3415)', 2),
		]

		expect(run_board_notes.notes_of(events, NO_TITLES)).toStrictEqual([])
	})
})

describe('run_board_notes.filed_numbers', () => {
	it('names the issues the run filed in this repository, and none filed elsewhere', () => {
		const events = [
			filed_event({}, 1),
			filed_event({ reference: ELSEWHERE }, 2),
			filed_event({ reference: '#3440', is_run: false }, 3),
			event(KIND.NOTE, '#3441 note', 4),
		]
		const notes = run_board_notes.notes_of(events, NO_TITLES)

		expect(run_board_notes.filed_numbers(notes)).toStrictEqual(new Set([3438]))
	})
})

describe('run_board_notes.notes_of order', () => {
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

	it('lists filings, parks and notes newest first', () => {
		const events = [
			filed_event({}, 1),
			event(KIND.PARK, '#3433 parked (cap)', 2),
			event(KIND.NOTE, '#3415 gate took 40% longer', 3),
			event(KIND.PARK, '#3409 parked', 4),
			event(KIND.MERGE, '#3420 merged', 5),
		]
		const notes = run_board_notes.notes_of(events, NO_TITLES)

		expect(notes.map((note) => [note.kind, note.issue])).toStrictEqual([
			['park', '3409'],
			['note', '3415'],
			['park', '3433'],
			['filed', '3438'],
		])
	})
})

describe('run_board_notes.notes_of texts', () => {
	// joshuafolkken/kit#4097: the line leads with the number already.
	it('drops the number a note opens with, and keeps a text that names another', () => {
		const other = 'saw #4073 again'
		const notes = run_board_notes.notes_of(
			[event(KIND.NOTE, '#4073 auto-ok applied', 1), event(KIND.NOTE, other, 2)],
			NO_TITLES,
		)

		expect(notes.map((note) => note.text)).toStrictEqual([other, 'auto-ok applied'])
	})

	// joshuafolkken/kit#4818: an overrun note is the done row's, not a finding.
	it('drops every overrun note and keeps a plain one', () => {
		const texts = [
			run_event_overrun.within_text(4711, 18),
			run_event_overrun.skipped_text(4711, 'no ledger'),
			run_event_overrun.ended_text(4711, 'filed'),
			'#4711 saw it twice',
		]
		const notes = run_board_notes.notes_of(
			texts.map((text, index) => event(KIND.NOTE, text, index + 1)),
			NO_TITLES,
		)

		expect(notes.map((note) => note.text)).toStrictEqual(['saw it twice'])
	})

	it('keeps an Issue filed elsewhere qualified', () => {
		const [note] = run_board_notes.notes_of([filed_event({ reference: ELSEWHERE })], NO_TITLES)

		expect(note?.issue).toBe(ELSEWHERE)
	})
})

describe('run_board_notes.notes_of — the baseline investigation', () => {
	// joshuafolkken/kit#4887: its launch and result are findings on the board.
	it('keeps its launch and result notes, newest first', () => {
		const texts = [
			run_event_baseline.started_text(30, 'investigating in pid 42'),
			run_event_baseline.ended_text(30, 'filed'),
		]
		const notes = run_board_notes.notes_of(
			texts.map((text, index) => event(KIND.NOTE, text, index + 1)),
			NO_TITLES,
		)

		expect(notes.map((note) => note.text)).toStrictEqual(texts.toReversed())
	})
})
