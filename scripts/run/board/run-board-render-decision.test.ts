import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import type { BoardRow } from './run-board-layout'
import { run_board_render } from './run-board-render'
import { run_board_render_fixture } from './run-board-render-fixture'

const { EMPTY_LAYOUT, header } = run_board_render_fixture
const ISSUE = 6253
const COLUMNS = 65
const ROWS = 100
const TITLE = 'A long title that gives its room to the decision needed to resume'
const QUESTION = '→ decide: Choose the account that should run the probe and confirm its credits'
const WAITING = '→ decide #6113: Confirm the promotional credits (外部アカウント)'

function row_of(is_waiting: boolean): BoardRow {
	return {
		number: ISSUE,
		title: TITLE,
		kind: undefined,
		state: is_waiting ? 'waiting' : 'human',
		status: undefined,
		waits: [],
		reason: {
			tail: is_waiting ? WAITING : QUESTION,
			...(is_waiting && { icon: '🙋', issues: ['6113'] }),
		},
	}
}

function line_of(is_waiting: boolean, form: 'screen' | 'chat'): string {
	const row = row_of(is_waiting)
	const layout = {
		...EMPTY_LAYOUT,
		people: is_waiting ? [] : [row],
		unreached: is_waiting ? [row] : [],
	}
	const lines = run_board_render.render({
		header: header({ layout, form }),
		notes: [],
		size: { rows: ROWS, columns: COLUMNS },
	})

	return (
		lines
			.map((line) => stripVTControlCharacters(line))
			.find((line) => line.includes(String(ISSUE))) ?? ''
	)
}

describe('run board decision tails', () => {
	it.each(['screen', 'chat'] as const)(
		'keeps the complete decision tail in %s (ac-0d2131cc)',
		(form) => {
			expect(line_of(false, form)).toContain(QUESTION)
			expect(line_of(true, form)).toContain(WAITING)
		},
	)

	it.each([true, false])(
		'shortens the title before preserving the complete tail: waiting=%s (ac-aefea1f5)',
		(is_waiting) => {
			const line = line_of(is_waiting, 'screen')

			expect(line).toContain('…')
			expect(line).not.toContain(TITLE)
			expect(line.endsWith(is_waiting ? WAITING : QUESTION)).toBe(true)
		},
	)
})
