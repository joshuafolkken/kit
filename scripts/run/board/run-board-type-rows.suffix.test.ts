import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import { run_board_fit } from './run-board-fit'
import { run_board_row_key } from './run-board-row-key'
import { run_board_spin } from './run-board-spin'
import { run_board_theme_defs } from './run-board-theme-defs'
import {
	run_board_type_rows,
	type KeyedLine,
	type Typing,
	type TypingFrame,
} from './run-board-type-rows'
import { run_board_watch_panel } from './run-board-watch-panel'

// joshuafolkken/kit#8607: a typing header row types its own words; the watch panel after its end mark
// stays whole in its columns while it types.

const { NO_TYPING, left_ms, next, typed_lines } = run_board_type_rows
const LETTER_MS = run_board_theme_defs.THEME_DEFS.wargames.intro.letter_ms
const START = Date.parse('2026-11-19T09:00:00.000Z')
const SECOND = 1000
const RULE_WIDTH = 80
const PREFIX = 'KIT > '
const ROWS = ['✅ 8505 10:18']
const PIN = ROWS[0] ?? ''
const WAS = '#8093 · WRITE'
const IS = '#8093 · GATE'

// The header's now line typing `words`, the pin row beside it.
function now_line(words: string): string {
	const [line = ''] = run_board_watch_panel.composed(
		[`${PREFIX}${run_board_row_key.keyed('now', words, words)}`],
		ROWS,
		RULE_WIDTH,
	)

	return line
}

function spun_of(line: string): Pick<ReturnType<typeof run_board_spin.spun>, 'lines' | 'keyed'> {
	return run_board_spin.spun([line], '⠋', { size: { rows: 2, columns: RULE_WIDTH } })
}

function frame_of(keyed: ReadonlyArray<KeyedLine>): TypingFrame {
	return { keyed, known: new Set(keyed.map((line) => line.key)) }
}

// The typing after a base frame of the now line at `from`, then one at `to`.
function typing_of(from: string, to: string): { lines: Array<string>; typing: Typing } {
	const base = spun_of(now_line(from)).keyed
	const first = next(NO_TYPING, frame_of(base), START, true)
	const { lines, keyed } = spun_of(now_line(to))

	return { lines, typing: next(first, frame_of(keyed), START + SECOND, true) }
}

describe('run_board_type_rows with a suffix', () => {
	it('keeps the pin row whole at its column while the now line types', () => {
		const { lines, typing } = typing_of(WAS, IS)
		const [typed = ''] = typed_lines(lines, typing, START + SECOND + LETTER_MS)
		const plain = stripVTControlCharacters(typed)

		expect(plain.endsWith(PIN)).toBe(true)
		expect(run_board_fit.width_of(plain)).toBe(RULE_WIDTH)
	})

	it('draws the frame line with the pin row after the words, the end mark taken out', () => {
		const [drawn = ''] = spun_of(now_line(IS)).lines

		expect(drawn.endsWith(PIN)).toBe(true)
		expect(run_board_fit.width_of(drawn)).toBe(RULE_WIDTH)
	})

	it('types the words alone, not the panel or its padding', () => {
		const { typing } = typing_of(WAS, IS)

		expect(typing.lines.map((line) => line.text)).toEqual([`${PREFIX}${IS}`])
		expect(left_ms(typing, START + SECOND)).toBe((IS.length - 1) * LETTER_MS)
	})
})
