import { describe, expect, it } from 'vitest'
import type { BoardHeader } from './run-board-header'
import { run_board_labels } from './run-board-labels'
import type { BoardRow } from './run-board-layout'
import type { BoardNote } from './run-board-notes'
import { run_board_render_fixture } from './run-board-render-fixture'

// joshuafolkken/kit#4099: a row the run filed leads its title with ✚ in place of a findings line naming
// it again, and the legend names ✚ only while a row draws it.

const { span_of } = run_board_labels
const { EMPTY_LAYOUT, MINUTE, NOW, header, lines_of } = run_board_render_fixture
const FILED_LEGEND = '✚ filed this run'
const FILED_TITLE = 'Title 4039'
const SPAN = 9 * MINUTE

function filed_as(issue: number): BoardNote {
	return { kind: 'filed', at_ms: NOW, issue: String(issue), text: `Title ${String(issue)}` }
}

function waiting(number: number): BoardRow {
	const title = `Row ${String(number)}`

	return { number, title, kind: undefined, state: 'waiting', status: undefined, waits: [] }
}

function merged(number: number, title: string): BoardRow {
	const status = {
		state: 'merged' as const,
		started_ms: NOW - SPAN - MINUTE,
		ended_ms: NOW - MINUTE,
	}

	return { number, title, kind: undefined, state: 'merged', status, waits: [] }
}

function listing(rows: ReadonlyArray<BoardRow>): BoardHeader {
	return header({ layout: { ...EMPTY_LAYOUT, active: [...rows] } })
}

function line_of(lines: ReadonlyArray<string>, text: string): string {
	return lines.find((line) => line.includes(text)) ?? ''
}

describe('run_board_render.render rows the run filed', () => {
	const lines = lines_of(listing([waiting(4039), waiting(4040)]), [filed_as(4039)])

	it('leads a filed row’s title with ✚, and an unfiled row’s with none', () => {
		expect(line_of(lines, 'Row 4039')).toContain('✚ Row 4039')
		expect(line_of(lines, 'Row 4040')).not.toContain('✚')
	})

	it('draws no findings line and no filed this run line for a filed row', () => {
		const board = lines.join('\n')

		expect(board).not.toContain(FILED_TITLE)
		expect(board).not.toContain('📌')
		expect(lines.slice(0, -1).join('\n')).not.toContain('filed this run')
	})

	it('names ✚ in the legend while a row draws it', () => {
		expect(lines.at(-1)).toContain(FILED_LEGEND)
	})

	it('draws a filing with no row as a finding, and names no ✚', () => {
		const unlisted = lines_of(listing([waiting(4040)]), [filed_as(4039)])

		expect(unlisted.join('\n')).toContain(FILED_TITLE)
		expect(unlisted.join('\n')).not.toContain('✚')
	})
})

describe('run_board_render.render a filed row’s columns', () => {
	const long = 'A title long enough to be cut at the title column on either row, marked or not'

	it('cuts a filed row’s title by the mark, so its time stays in an unfiled row’s column', () => {
		const lines = lines_of(listing([merged(4039, long), merged(4040, long)]), [filed_as(4039)])
		const time = span_of(SPAN)
		const filed = line_of(lines, '4039')
		const plain = line_of(lines, '4040')

		expect(filed).toContain('✚ A title')
		expect(filed.indexOf(time)).toBe(plain.indexOf(time))
		expect(filed.indexOf(time)).toBeGreaterThan(0)
	})
})
