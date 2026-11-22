import { describe, expect, it } from 'vitest'
import { run_board_cut_styled } from './run-board-cut-styled'
import { run_board_header_notice, type Notice, type NoticeFields } from './run-board-header-notice'
import { run_board_notice_trace } from './run-board-notice-trace'
import { run_board_notice_turn, type NoticeTurn } from './run-board-notice-turn'
import type { KeyedLine } from './run-board-type-rows'

const { covers, is_placed, notice_bytes, turn_of, wake_after } = run_board_notice_turn
const { LETTER_MS, TRACE_BRIGHT_MS } = run_board_notice_trace
const START = Date.parse('2026-10-08T09:00:00.000Z')
const PREFIX = 'v1  12:00  🔊 '
// The prefix's columns: the speaker is two wide.
const PREFIX_COLUMNS = 14
const ROW = 2
const COLUMNS = 80
const WORDS = 'ab cd'
const PLACED = { row: ROW, column: PREFIX_COLUMNS, text: ` ${WORDS} ` }
const MINUTE_MS = 60_000
const PAST_TRACE_MS = WORDS.length * LETTER_MS + TRACE_BRIGHT_MS

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
}

function turn_at(
	last: NoticeTurn | undefined,
	framing: Partial<Framing> = {},
): NoticeTurn | undefined {
	const header = framing.header ?? STOPPED
	const frame = {
		keyed: [line_of(header)],
		header,
		is_base: false,
		now_ms: START,
		columns: COLUMNS,
	}

	return turn_of(last, { ...frame, ...framing, look: { theme: undefined } })
}

describe('turn_of', () => {
	it('starts a new notice now and places it with a blank each side', () => {
		expect(turn_at(undefined)).toStrictEqual({
			trace: { key: run_board_header_notice.key_of(STOPPED), start_ms: START },
			place: PLACED,
		})
	})

	it('takes the suffix first column as the right margin', () => {
		const keyed = [line_of(STOPPED, WORDS, '|  rest')]

		expect(turn_at(undefined, { keyed })?.place).toStrictEqual({ ...PLACED, text: ` ${WORDS}|` })
	})

	it('never runs a notice already there on the base frame', () => {
		const turn = turn_at(undefined, { is_base: true })

		expect(turn?.trace.start_ms).toBe(-Infinity)
		expect(turn?.place).toBeUndefined()
	})

	it('carries the trace while the key holds', () => {
		const later_ms = START + LETTER_MS * 2

		expect(turn_at(turn_at(undefined), { now_ms: later_ms })).toStrictEqual({
			trace: turn_at(undefined)?.trace,
			place: PLACED,
		})
	})

	it('restarts the trace on a new notice mid-trace', () => {
		const later_ms = START + LETTER_MS * 2
		const header = header_of(notice_of('merged'), later_ms)

		expect(turn_at(turn_at(undefined), { header, now_ms: later_ms })?.trace.start_ms).toBe(later_ms)
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

	it('places none once the trace is over', () => {
		const turn = turn_at(turn_at(undefined), { now_ms: START + PAST_TRACE_MS })

		expect(turn?.trace.start_ms).toBe(START)
		expect(turn?.place).toBeUndefined()
	})
})

describe('turn_of — widths', () => {
	it('keeps the drawn width of a wide notice', () => {
		const place = turn_at(undefined, { keyed: [line_of(STOPPED, '全角')] })?.place

		expect(place).toStrictEqual({ ...PLACED, text: ' 全角 ' })
		expect(covers(place, { row: ROW, column: PREFIX_COLUMNS + 5 })).toBe(true)
		expect(covers(place, { row: ROW, column: PREFIX_COLUMNS + 6 })).toBe(false)
	})
})

describe('wake_after', () => {
	it('wakes on the next letter step while the notice is placed', () => {
		expect(wake_after(turn_at(undefined), START + 1)).toBe(START + LETTER_MS)
	})

	it('never wakes without a place', () => {
		expect(wake_after(undefined, START)).toBe(Infinity)
		expect(wake_after(turn_at(undefined, { is_base: true }), START)).toBe(Infinity)
	})
})

describe('notice_bytes', () => {
	it('moves to the place and writes the traced notice', () => {
		const at_ms = START + LETTER_MS
		const traced = run_board_notice_trace.traced(PLACED.text, LETTER_MS, zero)

		expect(notice_bytes(turn_at(undefined), at_ms, START, zero)).toBe(
			`\u{1B}[${String(ROW)};${String(PREFIX_COLUMNS)}H${traced}${run_board_cut_styled.RESET}`,
		)
	})

	it('writes the end of the trace once, then nothing', () => {
		const turn = turn_at(undefined)
		const over_ms = START + PAST_TRACE_MS

		expect(notice_bytes(turn, over_ms, over_ms - 1, zero)).toContain(PLACED.text)
		expect(notice_bytes(turn, over_ms + LETTER_MS, over_ms, zero)).toBe('')
		expect(notice_bytes(undefined, START, undefined, zero)).toBe('')
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
