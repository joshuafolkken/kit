import { describe, expect, it } from 'vitest'
import { run_board_theme_defs } from './run-board-theme-defs'
import {
	run_board_type_rows,
	type KeyedLine,
	type Typing,
	type TypingFrame,
} from './run-board-type-rows'

// joshuafolkken/kit#8457: the frame the live plan lands on types every line the saved plan's frame drew
// faint over its saved text at once, the saved line carried until the row is typed through.

const { NO_TYPING, next } = run_board_type_rows
const LETTER_MS = run_board_theme_defs.THEME_DEFS.wopr.intro.letter_ms
const START = Date.parse('2026-11-21T09:00:00.000Z')
const SECOND = 1000
const LANDED = START + 2 * SECOND
const SAVED = 'queued 8436 park as needs-decision'
const LIVE = 'queued 8436 park'
const LANE = 'lanes 8352 open the board'

function line_of(key: string, index: number, text: string): KeyedLine {
	return { key, index, row: index + 1, text, prefix_columns: 0 }
}

function frame_of(keyed: ReadonlyArray<KeyedLine>, faint?: ReadonlyArray<string>): TypingFrame {
	const known = new Set(keyed.map((line) => line.key))

	return { keyed, known, faint: faint === undefined ? undefined : new Set(faint) }
}

const LANE_KEY = 'lanes:8352'
const FAINT_KEY = 'queued:8436'
const NEW_KEY = 'queued:9000'
const SAVED_FRAME = frame_of(
	[line_of(LANE_KEY, 0, LANE), line_of(FAINT_KEY, 1, SAVED)],
	[FAINT_KEY],
)

// The typing after the saved plan's base frame and a second saved frame, then a frame of `live`.
function landed_on(live: ReadonlyArray<KeyedLine>): Typing {
	const base = next(NO_TYPING, SAVED_FRAME, START, true)
	const saved = next(base, SAVED_FRAME, START + SECOND, true)

	return next(saved, frame_of(live), LANDED, true)
}

const LIVE_LINES = [line_of(LANE_KEY, 0, LANE), line_of(FAINT_KEY, 1, LIVE)]

describe('run_board_type_rows.next over a saved frame', () => {
	it('types nothing while the plan drawn is a saved one', () => {
		const base = next(NO_TYPING, SAVED_FRAME, START, true)

		expect(next(base, SAVED_FRAME, START + SECOND, true).lines).toStrictEqual([])
	})

	it('types every faint line over its saved text from the frame the live plan lands on', () => {
		const typing = landed_on([...LIVE_LINES, line_of(NEW_KEY, 2, 'queued 9000 new')])
		const starts = typing.lines.map((line) => [line.key, line.start_ms, line.under])

		expect(starts).toStrictEqual([
			[FAINT_KEY, LANDED, SAVED],
			[NEW_KEY, LANDED, undefined],
		])
	})

	it('keeps typing over the saved text on the redraws after the landing, and types it over no more', () => {
		const later = next(landed_on(LIVE_LINES), frame_of(LIVE_LINES), LANDED + LETTER_MS, true)

		expect(later.lines.map((line) => [line.start_ms, line.under])).toStrictEqual([[LANDED, SAVED]])
		expect(later.saved).toBeUndefined()
	})
})
