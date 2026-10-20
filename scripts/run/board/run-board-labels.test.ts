import { styleText } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_labels } from './run-board-labels'
import { run_board_phase } from './run-board-phase'

// joshuafolkken/kit#3430: every time the board draws is an `HH:MM:SS` clock or a span.
// joshuafolkken/kit#3486: its words are English whatever the session language.

const { WORDS, bar_of, clock_of, minute_of, span_of, spinner_of } = run_board_labels
const { GAUGE_SHADES, PHASE_ICONS, PHASE_WORDS, SPINNER_INTERVAL_MS, painted } = run_board_labels
const { day_minute_of, minute_span_of } = run_board_labels
const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const JAPANESE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u

describe('run_board_labels.WORDS', () => {
	it('carries one non-empty English word per key and no Japanese', () => {
		const words: Array<string> = Object.values(WORDS)

		expect(WORDS.no_run).toBe('no run')
		expect(words.every((word) => word.length > 0)).toBe(true)
		expect(words.filter((word) => JAPANESE.test(word))).toStrictEqual([])
	})
})

// joshuafolkken/kit#4020: `15:11  🔚 21:46` did not say which was a length. Every length is
// degree-minute-second style, so `:` is a time of day alone.
describe('run_board_labels.span_of', () => {
	it('draws zero and a span of seconds as seconds alone', () => {
		expect(span_of(0)).toBe('0″')
		expect(span_of(26 * SECOND + 999)).toBe('26″')
	})

	it('drops a zero hour and pads the seconds after the minutes', () => {
		expect(span_of(3 * MINUTE + 27 * SECOND)).toBe('3′27″')
		expect(span_of(MINUTE + 2 * SECOND)).toBe('1′02″')
	})

	it('pads the minutes and seconds after the hours', () => {
		expect(span_of(HOUR + 15 * MINUTE + 57 * SECOND)).toBe('1°15′57″')
		expect(span_of(HOUR + 5 * SECOND)).toBe('1°00′05″')
	})

	it('carries sixty minutes and more into hours', () => {
		expect(span_of(HOUR + MINUTE + 5 * SECOND)).toBe('1°01′05″')
		expect(span_of(12 * HOUR)).toBe('12°00′00″')
	})

	it('reads a negative span as zero', () => {
		expect(span_of(-MINUTE)).toBe('0″')
	})
})

// joshuafolkken/kit#4044: the estimated finish, drawn to the minute.
describe('run_board_labels.minute_span_of', () => {
	it('rounds a length up to its minute and drops the seconds', () => {
		expect(minute_span_of(25 * MINUTE)).toBe('25′')
		expect(minute_span_of(24 * MINUTE + SECOND)).toBe('25′')
	})

	it('draws an hour and more with its minutes in two digits', () => {
		expect(minute_span_of(HOUR + 5 * MINUTE)).toBe('1°05′')
	})

	it('never draws less than a minute', () => {
		expect(minute_span_of(0)).toBe('1′')
		expect(minute_span_of(-MINUTE)).toBe('1′')
	})
})

describe('run_board_labels.bar_of', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('fills the bar in proportion, empty for nothing to do and full when done', () => {
		vi.stubEnv('FORCE_COLOR', '0')

		expect(bar_of(1, 4, 8)).toBe('■■──────')
		expect(bar_of(0, 0, 4)).toBe('────')
		expect(bar_of(5, 4, 4)).toBe('■■■■')
		expect(bar_of(0, 1)).toHaveLength(10)
	})

	// joshuafolkken/kit#3452: a centered square done (joshuafolkken/kit#3498), a dimmed thin line left where the output has color.
	it('draws the done part in its color and the left part dimmed where the output is colored', () => {
		vi.stubEnv('FORCE_COLOR', '1')

		expect(bar_of(1, 4, 4)).toBe(`${styleText('cyan', '■')}${styleText('dim', '───')}`)
		expect(bar_of(4, 4, 4, 'green')).toBe(styleText('green', '■■■■'))
	})
})

// joshuafolkken/kit#3464: the gauge colors are 24-bit where the output draws them, the palette's own
// where it does not, and no escape where it draws no color.
describe('run_board_labels.painted with a gauge shade', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('draws the green, yellow and red shades as 24-bit colors where the output has them', () => {
		vi.stubEnv('FORCE_COLOR', '3')

		expect(painted(GAUGE_SHADES.normal, '■')).toBe('\u{1B}[38;2;48;209;88m■\u{1B}[39m')
		expect(painted(GAUGE_SHADES.yellow, '■')).toBe('\u{1B}[38;2;255;214;10m■\u{1B}[39m')
		expect(painted(GAUGE_SHADES.red, '■')).toBe('\u{1B}[38;2;255;69;58m■\u{1B}[39m')
	})

	it('falls back to the 16 palette colors where the output has no 24-bit color', () => {
		vi.stubEnv('FORCE_COLOR', '1')

		expect(painted(GAUGE_SHADES.normal, '■')).toBe(styleText('green', '■'))
		expect(painted(GAUGE_SHADES.yellow, '■')).toBe(styleText('yellow', '■'))
		expect(painted(GAUGE_SHADES.red, '■')).toBe(styleText('red', '■'))
	})

	it('draws no escape where the output has no color', () => {
		vi.stubEnv('FORCE_COLOR', '0')

		expect(painted(GAUGE_SHADES.red, '■')).toBe('■')
		expect(bar_of(1, 2, 2, GAUGE_SHADES.normal)).toBe('■─')
	})

	it('draws no 24-bit escape into an output that is not a terminal, though the environment has 24-bit color', () => {
		vi.stubEnv('FORCE_COLOR', undefined)
		vi.stubEnv('NO_COLOR', undefined)
		vi.stubEnv('NODE_DISABLE_COLORS', undefined)
		vi.stubEnv('TERM', 'xterm-256color')
		vi.stubEnv('TMUX', '1')

		expect(styleText('green', '■')).toBe('■')
		expect(painted(GAUGE_SHADES.normal, '■')).toBe('■')
	})
})

describe('run_board_labels.PHASE_ICONS', () => {
	it('draws every phase as its own two-column emoji', () => {
		const icons = run_board_phase.PHASES.map((phase) => PHASE_ICONS[phase])

		expect(new Set(icons).size).toBe(run_board_phase.PHASES.length)
		expect(icons.every((icon) => /^\p{Emoji_Presentation}$/u.test(icon))).toBe(true)
		expect(PHASE_ICONS.gate).toBe('🚦')
	})

	it('names every phase with a word of the legend', () => {
		const words = run_board_phase.PHASES.map((phase) => WORDS[PHASE_WORDS[phase]])

		expect(words.every((word) => word.length > 0)).toBe(true)
		expect(WORDS[PHASE_WORDS.investigate]).toBe('investigate')
	})

	// joshuafolkken/kit#3526: one legend names both, so a shared icon would explain one as the other.
	it('shares no icon with a filed issue’s kind', () => {
		const phases = new Set(Object.values(PHASE_ICONS))
		const kinds: Array<string> = Object.values(run_board_labels.FILED_KIND_ICONS)

		expect(kinds.filter((icon) => phases.has(icon))).toStrictEqual([])
	})
})

describe('run_board_labels.spinner_of', () => {
	it('turns one braille frame every quarter second and wraps after the last', () => {
		expect(spinner_of(0)).toBe('⠋')
		expect(spinner_of(SPINNER_INTERVAL_MS - 1)).toBe('⠋')
		expect(spinner_of(SPINNER_INTERVAL_MS)).toBe('⠙')
		expect(spinner_of(10 * SPINNER_INTERVAL_MS)).toBe('⠋')
		expect(SPINNER_INTERVAL_MS).toBe(80)
	})
})

describe('run_board_labels.clock_of', () => {
	it('draws the local wall clock of a moment', () => {
		const moment = new Date(2026, 9, 8, 7, 4, 9).getTime()

		expect(clock_of(moment)).toBe('07:04:09')
	})
})

// joshuafolkken/kit#3489: a moment read to the minute drops its seconds.
describe('run_board_labels.minute_of', () => {
	it('draws the local wall clock of a moment to the minute', () => {
		const moment = new Date(2026, 9, 8, 7, 4, 59).getTime()

		expect(minute_of(moment)).toBe('07:04')
	})
})

// joshuafolkken/kit#4017: a waiting row's start time reads in the local zone, its day included;
// joshuafolkken/kit#4288: without the year, to fit the condition column.
describe('run_board_labels.day_minute_of', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('draws the local month, day and wall clock of a moment to the minute', () => {
		const moment = new Date(2026, 9, 8, 7, 4, 59).getTime()

		expect(day_minute_of(moment)).toBe('10-08 07:04')
	})

	it('carries a UTC evening into the next local day', () => {
		vi.stubEnv('TZ', 'Asia/Bangkok')

		expect(day_minute_of(Date.parse('2026-10-18T21:00Z'))).toBe('10-19 04:00')
		expect(day_minute_of(Date.parse('2026-12-31T20:30Z'))).toBe('01-01 03:30')
	})
})

// joshuafolkken/kit#4294: a waiting row's icon is its own two-column emoji, named in the legend once.
describe('run_board_labels.WAIT_ICONS', () => {
	const { WAIT_ICONS, WAIT_WORDS } = run_board_labels
	const icons = Object.values(WAIT_ICONS)

	it('draws every wait as its own two-column emoji, 🚧 left to a held check', () => {
		expect(new Set(icons).size).toBe(icons.length)
		expect(icons.every((icon) => /^\p{Emoji_Presentation}$/u.test(icon))).toBe(true)
		expect(icons).not.toContain('🚧')
	})

	it('names 🧍 and 🙅 with a word of the legend', () => {
		const words = new Map(WAIT_WORDS.map(([icon, word]) => [icon, WORDS[word]]))

		expect(words.get(WAIT_ICONS.solo)).toBe('runs alone')
		expect(words.get(WAIT_ICONS.solo_ahead)).toBe('behind solo')
	})
})
