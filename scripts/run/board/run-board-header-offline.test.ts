import { stripVTControlCharacters } from 'node:util'
import type { Outage } from '#scripts/lane/lane-offline-spans'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_header, type BoardHeader } from './run-board-header'
import type { BoardRow } from './run-board-layout'
import { run_board_render_drawn } from './run-board-render-drawn'
import { run_board_render_fixture } from './run-board-render-fixture'

// joshuafolkken/kit#7895, #8475: while the run's stream leaves an outage open, the notice slot says the
// `📴` and the outage's age, in yellow, ahead of any notice; the legend names it.

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
const OFFLINE_MARK = '📴'
const HOUR = 60 * MINUTE
// An outage its sampler saw half a minute ago.
const SEEN: Outage = { from_ms: NOW - OUTAGE_MS, down_ms: NOW - 30 * SECOND }

function board(outage: Outage | undefined, extra: Partial<BoardHeader> = {}): BoardHeader {
	const activity = { last_event_ms: NOW - MINUTE, outage, is_stopped: false }

	return header({ layout: LAYOUT, activity, ...extra })
}

function raw_lines(board_header: BoardHeader): Array<string> {
	return run_board_header.header_lines(board_header)
}

function plain_lines(board_header: BoardHeader): Array<string> {
	return raw_lines(board_header).map((line) => stripVTControlCharacters(line))
}

function beat_line(board_header: BoardHeader): string {
	return plain_lines(board_header)[1] ?? ''
}

function named(board_header: BoardHeader): ReadonlyArray<string> {
	return run_board_render_drawn.drawn_of(board_header, [ROW], new Set()).named
}

describe('run_board_header.header_lines -- offline', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('draws 📴 and the outage’s age in yellow in the notice slot', () => {
		vi.stubEnv('FORCE_COLOR', '1')
		const offline = board(SEEN)

		expect(beat_line(offline)).toMatch(/ {2}📴 12′34″$/u)
		expect(raw_lines(offline)[1]).toContain(`${YELLOW}${OFFLINE_MARK}`)
	})

	it('draws no 📴 while online', () => {
		expect(beat_line(board(undefined))).not.toContain(OFFLINE_MARK)
	})

	it('leaves the run’s age as it is under an outage longer than the run', () => {
		const long = { from_ms: NOW - 10 * HOUR, down_ms: SEEN.down_ms }

		expect(plain_lines(board(long))[0]).toBe(plain_lines(board(undefined))[0])
	})

	it('leaves the third line as it is online', () => {
		expect(plain_lines(board(SEEN))[2]).toBe(plain_lines(board(undefined))[2])
	})
})

describe('run_board_header.header_lines -- an outage not drawn', () => {
	// joshuafolkken/kit#8478: an ended run's third time cell is `—`, the finish its end.
	it('keeps an ended run’s end over an outage left open', () => {
		const lines = plain_lines(board(SEEN, { ended_ms: NOW - SECOND }))

		expect(lines[2]).toMatch(/🚀 \d{2}:\d{2} +— {2}/u)
		expect(lines.join('\n')).not.toContain(OFFLINE_MARK)
	})

	it('draws no 📴 over an outage its sampler no longer sees, or a stopped run', () => {
		const stale = board({ ...SEEN, down_ms: NOW - 3 * MINUTE })
		const stopped = header({
			layout: LAYOUT,
			activity: { last_event_ms: NOW - MINUTE, outage: SEEN, is_stopped: true },
		})

		expect(beat_line(stale)).not.toContain(OFFLINE_MARK)
		expect(beat_line(stopped)).not.toContain(OFFLINE_MARK)
	})
})

describe('run_board_render_drawn.drawn_of -- offline', () => {
	it('names 📴 only while it is drawn', () => {
		expect(named(board(SEEN))).toContain(OFFLINE_LEGEND)
		expect(named(board(undefined))).not.toContain(OFFLINE_LEGEND)
		expect(named(board(SEEN, { ended_ms: NOW - SECOND }))).not.toContain(OFFLINE_LEGEND)
	})
})
