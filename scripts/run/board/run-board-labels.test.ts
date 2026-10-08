import { styleText } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_labels } from './run-board-labels'
import { run_board_phase } from './run-board-phase'

// joshuafolkken/kit#3430: the board's words follow the session language, and every time it draws is an
// `HH:MM:SS` clock or span.

const { bar_of, clock_of, elapsed_of, left_of, span_of, spinner_of, words_of } = run_board_labels
const { PHASE_ICONS, PHASE_WORDS, SPINNER_FRAME_MS } = run_board_labels
const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE

describe('run_board_labels.words_of', () => {
	it('answers Japanese for ja and English for any other language', () => {
		expect(words_of('ja').no_run).toBe('ランなし')
		expect(words_of('en').no_run).toBe('no run')
		expect(words_of('fr').no_run).toBe('no run')
	})

	it('carries the same non-empty words in both languages', () => {
		const ja = words_of('ja')
		const en = words_of('en')

		expect(Object.keys(ja)).toStrictEqual(Object.keys(en))
		expect(Object.values(ja).every((word) => word.length > 0)).toBe(true)
		expect(Object.values(en).every((word) => word.length > 0)).toBe(true)
	})
})

describe('run_board_labels.span_of', () => {
	it('draws a span as zero-padded hours, minutes and seconds', () => {
		expect(span_of(2 * HOUR + 5 * MINUTE + 7 * SECOND + 999)).toBe('02:05:07')
		expect(span_of(26 * HOUR)).toBe('26:00:00')
	})

	it('reads a negative span as zero', () => {
		expect(span_of(-MINUTE)).toBe('00:00:00')
	})
})

// joshuafolkken/kit#3444: elapsed times are a short `MM:SS`, time left is `7h38m`, and the one bar the
// board draws fills in proportion.
describe('run_board_labels.elapsed_of', () => {
	it('draws minutes and seconds whose minutes never carry into hours', () => {
		expect(elapsed_of(42 * SECOND + 999)).toBe('00:42')
		expect(elapsed_of(HOUR + MINUTE + 5 * SECOND)).toBe('61:05')
		expect(elapsed_of(2 * HOUR + 5 * MINUTE + 30 * SECOND)).toBe('125:30')
	})

	it('reads a negative elapsed time as zero', () => {
		expect(elapsed_of(-MINUTE)).toBe('00:00')
	})
})

describe('run_board_labels.left_of', () => {
	it('draws hours and zero-padded minutes, a passed deadline as zero', () => {
		expect(left_of(7 * HOUR + 38 * MINUTE + 59 * SECOND)).toBe('7h38m')
		expect(left_of(5 * MINUTE)).toBe('0h05m')
		expect(left_of(-MINUTE)).toBe('0h00m')
	})
})

describe('run_board_labels.bar_of', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('fills the bar in proportion, empty for nothing to do and full when done', () => {
		vi.stubEnv('FORCE_COLOR', '0')

		expect(bar_of(1, 4, 8)).toBe('██──────')
		expect(bar_of(0, 0, 4)).toBe('────')
		expect(bar_of(5, 4, 4)).toBe('████')
		expect(bar_of(0, 1)).toHaveLength(10)
	})

	// joshuafolkken/kit#3452: a full block done, a dimmed thin line left where the output has color.
	it('draws the done part in its color and the left part dimmed where the output is colored', () => {
		vi.stubEnv('FORCE_COLOR', '1')

		expect(bar_of(1, 4, 4)).toBe(`${styleText('cyan', '█')}${styleText('dim', '───')}`)
		expect(bar_of(4, 4, 4, 'green')).toBe(styleText('green', '████'))
	})
})

describe('run_board_labels.PHASE_ICONS', () => {
	it('draws every phase as its own two-column emoji', () => {
		const icons = run_board_phase.PHASES.map((phase) => PHASE_ICONS[phase])

		expect(new Set(icons).size).toBe(run_board_phase.PHASES.length)
		expect(icons.every((icon) => /^\p{Emoji_Presentation}$/u.test(icon))).toBe(true)
		expect(PHASE_ICONS.gate).toBe('🚦')
	})

	it('names every phase with a word of the legend in both languages', () => {
		const words = run_board_phase.PHASES.map((phase) => words_of('ja')[PHASE_WORDS[phase]])

		expect(words.every((word) => word.length > 0)).toBe(true)
		expect(words_of('ja')[PHASE_WORDS.investigate]).toBe('調査')
	})
})

describe('run_board_labels.spinner_of', () => {
	it('turns one braille frame every quarter second and wraps after the last', () => {
		expect(spinner_of(0)).toBe('⠋')
		expect(spinner_of(SPINNER_FRAME_MS - 1)).toBe('⠋')
		expect(spinner_of(SPINNER_FRAME_MS)).toBe('⠙')
		expect(spinner_of(10 * SPINNER_FRAME_MS)).toBe('⠋')
		expect(SPINNER_FRAME_MS).toBe(250)
	})
})

describe('run_board_labels.clock_of', () => {
	it('draws the local wall clock of a moment', () => {
		const moment = new Date(2026, 9, 8, 7, 4, 9).getTime()

		expect(clock_of(moment)).toBe('07:04:09')
	})
})
