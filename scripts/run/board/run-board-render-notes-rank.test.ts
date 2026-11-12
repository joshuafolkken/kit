import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import type { BoardHeader } from './run-board-header'
import { run_board_labels } from './run-board-labels'
import type { BoardRow } from './run-board-layout'
import { run_board_notes, type BoardNote } from './run-board-notes'
import { run_board_render } from './run-board-render'
import { run_board_render_fixture } from './run-board-render-fixture'

// joshuafolkken/kit#4097: the findings section says nothing twice, and a full one keeps the lines a
// person has to act on.

const { minute_of } = run_board_labels
const { EMPTY_LAYOUT, MINUTE, NOW, header, lines_of, note } = run_board_render_fixture
const KIND = run_event_stream.EVENT_KIND
const REPO = 'joshuafolkken/kit'
const GUARD = 'Stop the guard'
const TITLES = new Map([[4091, GUARD]])
const NOTES_HEADING = '📌 findings'

function event(kind: string, text: string): RunEvent {
	return { pos: 1, at: new Date(NOW).toISOString(), kind, text }
}

function notes_of(events: ReadonlyArray<RunEvent>): ReadonlyArray<BoardNote> {
	return run_board_notes.notes_of(events, TITLES)
}

function waiting(number: number): BoardRow {
	return { number, title: 'Row', kind: undefined, state: 'waiting', status: undefined, waits: [] }
}

function listing(numbers: ReadonlyArray<number>): BoardHeader {
	return header({ layout: { ...EMPTY_LAYOUT, active: numbers.map((number) => waiting(number)) } })
}

describe('run_board_render.render findings without repeated words', () => {
	it('draws a note that opens with its own number once', () => {
		const lines = lines_of(header(), notes_of([event(KIND.NOTE, '#4073 auto-ok applied')]))

		expect(lines).toContain(`    💬 ${minute_of(NOW)} 4073  auto-ok applied`)
	})

	// joshuafolkken/kit#4099: the child is a 🙋 decision row while it stays parked, and once it resumes
	// the decision is made.
	it('draws no finding for a park waiting on a decision, with a legend or without one', () => {
		const notes = notes_of([event(KIND.PARK, '#4091 parked (needs-decision)')])

		expect(lines_of(header(), notes).join('\n')).not.toContain(GUARD)
		expect(lines_of(header({ layout: undefined }), notes).join('\n')).not.toContain(GUARD)
	})

	it('draws a reference to the board’s own repository as #N and keeps another one’s name', () => {
		const text = `#4095 waiting on ${REPO}#4085 and joshuafolkken/app-kit#12`
		const lines = lines_of(header({ repo: REPO }), notes_of([event(KIND.NOTE, text)]))

		expect(lines).toContain(
			`    💬 ${minute_of(NOW)} 4095  waiting on #4085 and joshuafolkken/app-kit#12`,
		)
	})
})

const park: BoardNote = { kind: 'park', at_ms: NOW - 2 * MINUTE, issue: '4095', text: 'Measure' }
const filed: BoardNote = { ...park, kind: 'filed', issue: '4096', text: 'Fix' }
const listed: BoardNote = { ...filed, issue: '4100', at_ms: NOW }

describe('run_board_render.render a full findings section', () => {
	const seen = Array.from({ length: run_board_render.NOTE_LIMIT }, (_, index) =>
		note(NOW - index * MINUTE, `seen ${String(index)}`),
	)
	const lines = lines_of(listing([4100]), [listed, ...seen, park, filed])
	const drawn = lines
		.slice(lines.findIndex((line) => line.startsWith(`── ${NOTES_HEADING} `)) + 1)
		.filter((line) => line.startsWith(' '.repeat(4)))

	it('keeps 💤, then a filed Issue with no row, then notes, and draws no line for a filed row', () => {
		expect(drawn.slice(0, 2)).toStrictEqual([
			`    💤 ${minute_of(park.at_ms)} 4095  Measure`,
			`    🆕 ${minute_of(filed.at_ms)} 4096  Fix`,
		])
		expect(drawn.slice(2)).toStrictEqual(
			[0, 1, 2, 3].map(
				(index) => `    💬 ${minute_of(NOW - index * MINUTE)} 3415  seen ${String(index)}`,
			),
		)
		expect(lines).toContain('  more 2')
	})

	it('names ✚ for the filed row, and in the findings only the kinds drawn', () => {
		expect(lines.at(-1)).toBe('⏰ elapsed  ✚ filed this run  🆕 filed  💤 parked  💬 note')
	})
})
