import { stripVTControlCharacters } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_cut_styled } from './run-board-cut-styled'
import { run_board_header_notice, type Notice, type NoticeFields } from './run-board-header-notice'
import { run_board_notice_trace } from './run-board-notice-trace'
import { run_board_notice_turn, type NoticePlace, type NoticeTurn } from './run-board-notice-turn'
import { run_board_theme_defs, type Theme } from './run-board-theme-defs'
import type { KeyedLine } from './run-board-type-rows'

const { covers, is_placed, notice_bytes, turn_of, wake_after } = run_board_notice_turn
const { LETTER_MS, PAIR_MS } = run_board_notice_trace
const START = Date.parse('2026-10-08T09:00:00.000Z')
const PREFIX = 'v1  12:00  🔊 '
// The prefix's columns: the speaker is two wide.
const PREFIX_COLUMNS = 14
const ROW = 2
const COLUMNS = 80
const WORDS = 'ab cd'
const BTTF_LOOK = { lit: { rgb: '190;198;206', named: 'white' }, is_rain: false } as const
const PLACED = { row: ROW, column: PREFIX_COLUMNS, text: ` ${WORDS} `, look: BTTF_LOOK }
const MINUTE_MS = 60_000
const BLINKS = 3
// The notice's letters have landed, and its three bars have blinked past.
const LANDED_MS = WORDS.length * LETTER_MS
const HELD_MS = LANDED_MS + BLINKS * PAIR_MS
const INVERSE = '\u{1B}[7m'

beforeEach(() => {
	vi.stubEnv('FORCE_COLOR', '3')
})

afterEach(() => {
	vi.unstubAllEnvs()
})

// The place as its text reads, its colors dropped.
function plain(place: NoticePlace | undefined): NoticePlace | undefined {
	return place === undefined ? undefined : { ...place, text: stripVTControlCharacters(place.text) }
}

function zero(): number {
	return 0
}

function notice_of(word: string): Notice {
	return { cause: { cue: 'alert', word }, is_repeat: false, at_ms: START }
}

function header_of(notice: Notice | undefined, now_ms = START): NoticeFields {
	return {
		now_ms,
		ended_ms: now_ms,
		activity: { last_event_ms: undefined, outage: undefined, is_stopped: false },
		link: (raw) => raw,
		is_keyed: true,
		notice,
	}
}

function line_of(header: NoticeFields, words = WORDS, suffix?: string): KeyedLine {
	const key = run_board_header_notice.key_of(header) ?? ''

	return {
		key,
		index: 0,
		row: ROW,
		text: `${PREFIX}${words}`,
		prefix_columns: PREFIX_COLUMNS,
		suffix,
	}
}

const STOPPED = header_of(notice_of('stopped'))

interface Framing {
	header: NoticeFields
	keyed: ReadonlyArray<KeyedLine>
	is_base: boolean
	now_ms: number
	columns: number
	theme: Theme | undefined
}

function turn_at(
	last: NoticeTurn | undefined,
	framing: Partial<Framing> = {},
): NoticeTurn | undefined {
	const header = framing.header ?? STOPPED
	const { theme, ...rest } = { theme: 'bttf' as const, ...framing }
	const frame = {
		keyed: [line_of(header)],
		header,
		is_base: false,
		now_ms: START,
		columns: COLUMNS,
	}

	return turn_of(last, { ...frame, ...rest, look: { theme } })
}

describe('turn_of', () => {
	it('starts a new notice now and places it with a blank each side, in the theme’s look', () => {
		const turn = turn_at(undefined)

		expect(turn?.trace).toStrictEqual({
			key: run_board_header_notice.key_of(STOPPED),
			start_ms: START,
		})
		expect(plain(turn?.place)).toStrictEqual(PLACED)
	})

	it('takes the suffix first column as the right margin', () => {
		const keyed = [line_of(STOPPED, WORDS, '|  rest')]

		expect(plain(turn_at(undefined, { keyed })?.place)).toStrictEqual({
			...PLACED,
			text: ` ${WORDS}|`,
		})
	})

	it('never runs a notice already there on the base frame', () => {
		const turn = turn_at(undefined, { is_base: true })

		expect(turn?.trace.start_ms).toBe(-Infinity)
		expect(turn?.place).toBeUndefined()
	})

	it('carries the trace while the key holds', () => {
		const later = turn_at(turn_at(undefined), { now_ms: START + LETTER_MS * 2 })

		expect(later?.trace).toStrictEqual(turn_at(undefined)?.trace)
		expect(plain(later?.place)).toStrictEqual(PLACED)
	})

	it('restarts the trace on a new notice mid-trace', () => {
		const later_ms = START + LETTER_MS * 2
		const header = header_of(notice_of('merged'), later_ms)

		expect(turn_at(turn_at(undefined), { header, now_ms: later_ms })?.trace.start_ms).toBe(later_ms)
	})
})

describe('turn_of — the theme’s notice look', () => {
	it('places none in a theme with no notice look', () => {
		expect(turn_at(undefined, { theme: undefined })?.place).toBeUndefined()
	})

	it.each(['matrix', 'wargames', 'bttf'] as const)('places the %s notice in its look', (theme) => {
		expect(turn_at(undefined, { theme })?.place?.look).toBe(
			run_board_theme_defs.live_of(theme).notice,
		)
	})

	it('restarts the stages on a new notice while one holds lit', () => {
		const held_ms = START + HELD_MS + MINUTE_MS
		const header = header_of(notice_of('merged'), held_ms)
		const next = turn_at(turn_at(undefined), { header, now_ms: held_ms })

		expect(next?.trace.start_ms).toBe(held_ms)
		expect(wake_after(next, held_ms)).toBe(held_ms + LANDED_MS)
	})
})

describe('turn_of — slots and pane edges', () => {
	it.each<[string, NoticeFields]>([
		['the empty slot', header_of(undefined)],
		[
			'a standing state',
			{
				...header_of(undefined),
				ended_ms: undefined,
				read_failed_ms: START - MINUTE_MS,
				read_error: 'boom',
			},
		],
	])('starts none for %s', (_, header) => {
		expect(turn_at(undefined, { header })).toBeUndefined()
	})

	it('places none where no keyed line carries the notice', () => {
		const turn = turn_at(undefined, { keyed: [{ ...line_of(STOPPED), key: 'other' }] })

		expect(turn?.trace.start_ms).toBe(START)
		expect(turn?.place).toBeUndefined()
	})

	it('places none past the pane columns', () => {
		const turn = turn_at(undefined, { columns: PREFIX_COLUMNS + WORDS.length })

		expect(turn?.trace.start_ms).toBe(START)
		expect(is_placed(turn)).toBe(false)
	})

	it('keeps the place while the notice holds lit, so a full redraw is lit again', () => {
		const turn = turn_at(turn_at(undefined), { now_ms: START + HELD_MS + MINUTE_MS })

		expect(turn?.trace.start_ms).toBe(START)
		expect(plain(turn?.place)).toStrictEqual(PLACED)
	})
})

describe('turn_of — widths', () => {
	it('keeps the drawn width of a wide notice', () => {
		const place = turn_at(undefined, { keyed: [line_of(STOPPED, '全角')] })?.place

		expect(plain(place)).toStrictEqual({ ...PLACED, text: ' 全角 ' })
		expect(covers(place, { row: ROW, column: PREFIX_COLUMNS + 5 })).toBe(true)
		expect(covers(place, { row: ROW, column: PREFIX_COLUMNS + 6 })).toBe(false)
	})
})

describe('wake_after', () => {
	it('wakes on the next letter step while the matrix rain locks', () => {
		expect(wake_after(turn_at(undefined, { theme: 'matrix' }), START + 1)).toBe(START + LETTER_MS)
	})

	it('wakes a typed notice once, when its letters have typed, then on each stage', () => {
		const turn = turn_at(undefined)

		expect(wake_after(turn, START + 1)).toBe(START + LANDED_MS)
		expect(wake_after(turn, START + LANDED_MS)).toBe(START + LANDED_MS + PAIR_MS / 2)
	})

	it('never wakes without a place or while the notice holds lit', () => {
		expect(wake_after(undefined, START)).toBe(Infinity)
		expect(wake_after(turn_at(undefined, { is_base: true }), START)).toBe(Infinity)
		expect(wake_after(turn_at(undefined), START + HELD_MS - PAIR_MS / 2)).toBe(Infinity)
	})
})

describe('notice_bytes', () => {
	it('moves to the place and writes the traced notice', () => {
		const turn = turn_at(undefined, { theme: 'matrix' })
		const { text = '', look = BTTF_LOOK } = turn?.place ?? {}
		const traced = run_board_notice_trace.traced(text, LETTER_MS, look, zero)

		expect(notice_bytes(turn, START + LETTER_MS, zero)).toBe(
			`\u{1B}[${String(ROW)};${String(PREFIX_COLUMNS)}H${traced}${run_board_cut_styled.RESET}`,
		)
	})

	it('leaves a typed notice to the theme while it types, then bars it on the turn it lands', () => {
		const turn = turn_at(undefined)

		expect(notice_bytes(turn, START + LANDED_MS - 1, zero)).toBe('')
		expect(notice_bytes(turn, START + LANDED_MS, zero)).toContain(INVERSE)
	})

	it('writes the notice lit at every turn while it holds, until it changes', () => {
		const turn = turn_at(undefined)
		const held_ms = START + HELD_MS + MINUTE_MS
		const lit = notice_bytes(turn, held_ms, zero)

		expect(stripVTControlCharacters(lit)).toContain(PLACED.text)
		expect(lit).toContain(BTTF_LOOK.lit.rgb)
		expect(lit).not.toContain(INVERSE)
		expect(notice_bytes(undefined, START, zero)).toBe('')
	})
})

describe('covers', () => {
	it.each<[string, { row: number; column: number }, boolean]>([
		['the margin before', { row: ROW, column: PREFIX_COLUMNS }, true],
		['the margin after', { row: ROW, column: PREFIX_COLUMNS + WORDS.length + 1 }, true],
		['past the margin', { row: ROW, column: PREFIX_COLUMNS + WORDS.length + 2 }, false],
		['before the margin', { row: ROW, column: PREFIX_COLUMNS - 1 }, false],
		['another row', { row: ROW + 1, column: PREFIX_COLUMNS }, false],
	])('%s → %s', (_, cell, expected) => {
		expect(covers(PLACED, cell)).toBe(expected)
	})

	it('covers nothing without a place', () => {
		expect(covers(undefined, { row: ROW, column: PREFIX_COLUMNS })).toBe(false)
	})
})
