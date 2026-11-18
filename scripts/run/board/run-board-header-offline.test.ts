import { stripVTControlCharacters } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_header, type BoardHeader } from './run-board-header'
import type { BoardRow } from './run-board-layout'
import { run_board_render_drawn } from './run-board-render-drawn'
import { run_board_render_fixture } from './run-board-render-fixture'

// joshuafolkken/kit#7895: while the run's stream leaves an outage open, the `💓` gives way to the `📴`
// and the outage's age, in yellow; the legend names it.

const { EMPTY_LAYOUT, MINUTE, NOW, header } = run_board_render_fixture
const SECOND = 1000
const OUTAGE_MS = 12 * MINUTE + 34 * SECOND
const YELLOW = '\u{1B}[33m'
const ROW: BoardRow = {
	number: 1,
	title: undefined,
	kind: undefined,
	state: 'running',
	status: undefined,
	waits: [],
}
const LAYOUT = { ...EMPTY_LAYOUT, active: [ROW] }
const OFFLINE_LEGEND = '📴 offline'

function board(
	offline_since_ms: number | undefined,
	extra: Partial<BoardHeader> = {},
): BoardHeader {
	const activity = { last_event_ms: NOW - MINUTE, offline_since_ms, is_stopped: false }

	return header({ layout: LAYOUT, activity, ...extra })
}

function raw_lines(board_header: BoardHeader): Array<string> {
	return run_board_header.header_lines(board_header)
}

function plain_lines(board_header: BoardHeader): Array<string> {
	return raw_lines(board_header).map((line) => stripVTControlCharacters(line))
}

function named(board_header: BoardHeader): ReadonlyArray<string> {
	return run_board_render_drawn.drawn_of(board_header, [ROW], new Set()).named
}

describe('run_board_header.header_lines -- offline', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('draws 📴 and the outage’s age in yellow in place of the 💓', () => {
		vi.stubEnv('FORCE_COLOR', '1')
		const offline = board(NOW - OUTAGE_MS)
		const line = plain_lines(offline)[1] ?? ''

		// Right-aligned under the run's age, as the 💓's digits are.
		expect(line).toMatch(/📴 +12′34″/u)
		expect(line).not.toContain('💓')
		expect(raw_lines(offline)[1]).toContain(`${YELLOW}📴`)
	})

	it('draws the 💓 and the newest event’s age while online', () => {
		const line = plain_lines(board(undefined))[1] ?? ''

		expect(line).toContain('💓')
		expect(line).not.toContain('📴')
	})

	it('keeps an ended run’s end mark over an outage left open', () => {
		const offline = board(NOW - OUTAGE_MS, { ended_ms: NOW - SECOND })
		const line = plain_lines(offline)[1] ?? ''

		expect(line).toContain('🔚')
		expect(line).not.toContain('📴')
	})

	it('leaves the third line as it is online', () => {
		expect(plain_lines(board(NOW - OUTAGE_MS))[2]).toBe(plain_lines(board(undefined))[2])
	})
})

describe('run_board_render_drawn.drawn_of -- offline', () => {
	it('names 📴 only while it is drawn', () => {
		expect(named(board(NOW - OUTAGE_MS))).toContain(OFFLINE_LEGEND)
		expect(named(board(undefined))).not.toContain(OFFLINE_LEGEND)
		expect(named(board(NOW - OUTAGE_MS, { ended_ms: NOW - SECOND }))).not.toContain(OFFLINE_LEGEND)
	})
})
