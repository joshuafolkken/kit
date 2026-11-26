import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import type { BoardRow } from './run-board-layout'
import { run_board_render } from './run-board-render'
import { run_board_render_fixture } from './run-board-render-fixture'
import { run_board_render_row } from './run-board-render-row'
import { run_board_row_key } from './run-board-row-key'

const { EMPTY_LAYOUT, MINUTE, NOW, header, unfinished } = run_board_render_fixture
const { GAP } = run_board_render_row
const ISSUE = 6253
const COLUMNS = 65
const ROWS = 100
const TITLE_START = 'A long title'
const TITLE = `${TITLE_START} that gives its room to the decision needed to resume`
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

function drawn_line(is_waiting: boolean, form: 'screen' | 'chat', is_keyed = false): string {
	const row = row_of(is_waiting)
	const layout = {
		...EMPTY_LAYOUT,
		people: is_waiting ? [] : [row],
		unreached: is_waiting ? [row] : [],
	}
	const lines = run_board_render.render({
		header: header({ layout, form, is_keyed }),
		notes: [],
		size: { rows: ROWS, columns: COLUMNS },
	})

	return lines.find((line) => stripVTControlCharacters(line).includes(String(ISSUE))) ?? ''
}

function line_of(is_waiting: boolean, form: 'screen' | 'chat'): string {
	return stripVTControlCharacters(drawn_line(is_waiting, form))
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
		'gives up the title, to nothing, before the complete tail: waiting=%s (ac-aefea1f5)',
		(is_waiting) => {
			const line = line_of(is_waiting, 'screen')

			// joshuafolkken/kit#8990: the title floor is none, so not even the title's first word is left.
			expect(line).not.toContain(TITLE_START)
			expect(unfinished(line).endsWith(is_waiting ? WAITING : QUESTION)).toBe(true)
		},
	)

	it.each([
		[false, 'decision'],
		[true, 'waiting'],
	])(
		'keys the row by its section, so a theme types it once there: waiting=%s',
		(is_waiting, section) => {
			const { key } = run_board_row_key.split_key(drawn_line(is_waiting, 'screen', true))

			expect(key).toBe(`${section}:${String(ISSUE)}`)
		},
	)
})

// joshuafolkken/kit#8590: a decision row's action starts right after the section's widest title.
const SHORT = { number: 8432, title: 'Shorten board notice text' }
const LONG = { number: 5272, title: 'Upgrade TypeScript to 7 and fix forward' }
const PARKED = { number: 7002, title: 'Parked child' }
const LANE = 7001
const WIDE_COLUMNS = 200
const SLEEP = { from_ms: NOW - 40 * MINUTE, to_ms: NOW - 10 * MINUTE }

function decision_row(issue: { number: number; title: string }): BoardRow {
	return { ...row_of(false), ...issue, reason: { tail: '→ decide' } }
}

// A running lane row with a time and a stop, so the frame's time and stops columns are wide.
function lane_row(): BoardRow {
	const status = { state: 'running' as const, started_ms: NOW - MINUTE, gaps: [SLEEP] }

	return { ...row_of(false), number: LANE, state: 'running', status, reason: undefined }
}

// A child parked on a decision, whose recorded time a decision row does not draw.
function parked_row(): BoardRow {
	const status = { state: 'parked' as const, started_ms: NOW - 40 * MINUTE }

	return { ...decision_row(PARKED), state: 'parked', status }
}

function decision_lines(): Array<string> {
	const layout = {
		...EMPTY_LAYOUT,
		active: [lane_row()],
		people: [decision_row(SHORT), decision_row(LONG), parked_row()],
	}
	const lines = run_board_render.render({
		header: header({ layout }),
		notes: [],
		size: { rows: ROWS, columns: WIDE_COLUMNS },
	})

	return lines.map((line) => stripVTControlCharacters(line))
}

function line_with(lines: ReadonlyArray<string>, number: number): string {
	return lines.find((line) => line.includes(String(number))) ?? ''
}

describe('run board decision columns', () => {
	it('starts the action two columns after the widest title, no time column between (ac-fb1412e6, ac-138a93d6)', () => {
		const lines = decision_lines()
		const long = line_with(lines, LONG.number)
		const short = line_with(lines, SHORT.number)
		const action = long.indexOf(LONG.title) + LONG.title.length + GAP.length

		expect(long.indexOf('→')).toBe(action)
		expect(short.indexOf('→')).toBe(action)
		expect(line_with(lines, PARKED.number).indexOf('→')).toBe(action)
	})
})
