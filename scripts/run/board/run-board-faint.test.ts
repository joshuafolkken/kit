import { describe, expect, it } from 'vitest'
import { run_board_faint } from './run-board-faint'

const { faint_in } = run_board_faint

const OPEN = '\u{1B}[2m'
const CLOSE = '\u{1B}[22m'
const PAIR = { open: OPEN, close: CLOSE }
const BOLD_END = '\u{1B}[22m'
const RESET = '\u{1B}[0m'
const BARE_RESET = '\u{1B}[m'
const ROW = '#12 queued'

describe('run_board_faint.faint_in', () => {
	it('wraps a plain line in faint', () => {
		expect(faint_in(ROW, PAIR)).toBe(`${OPEN}${ROW}${CLOSE}`)
	})

	it('opens faint again after a bold close inside the line', () => {
		const line = `\u{1B}[1m#12${BOLD_END} queued`

		expect(faint_in(line, PAIR)).toBe(`${OPEN}\u{1B}[1m#12${BOLD_END}${OPEN} queued${CLOSE}`)
	})

	it('opens faint again after a full reset, numbered or bare', () => {
		const line = `\u{1B}[33ma${RESET} b\u{1B}[36mc${BARE_RESET} d`

		expect(faint_in(line, PAIR)).toBe(
			`${OPEN}\u{1B}[33ma${RESET}${OPEN} b\u{1B}[36mc${BARE_RESET}${OPEN} d${CLOSE}`,
		)
	})

	it('leaves a color close alone, so the color is untouched', () => {
		const line = '\u{1B}[33ma\u{1B}[39m b'

		expect(faint_in(line, PAIR)).toBe(`${OPEN}${line}${CLOSE}`)
	})

	it('returns the line unchanged where the stream has no color', () => {
		expect(faint_in(ROW, { open: '', close: '' })).toBe(ROW)
	})
})
