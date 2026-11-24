import { WriteStream } from 'node:tty'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_change_flash } from './run-board-change-flash'
import { run_board_frame_fixture } from './run-board-frame-fixture'
import { run_board_labels } from './run-board-labels'
import { run_board_notice_trace } from './run-board-notice-trace'
import { run_board_row_key } from './run-board-row-key'
import { run_board_spin, type Spot } from './run-board-spin'
import { run_board_spot } from './run-board-spot'
import { run_board_theme_defs } from './run-board-theme-defs'
import { run_board_type_rows, type Typing, type TypingLine } from './run-board-type-rows'

// joshuafolkken/kit#3495: where a frame's spinners are on screen, and the turns written between
// redraws — a cursor move and one frame each, on the package's interval, until the next second.

const { REDRAW_MS, SPOT, spun } = run_board_spin
const { cell_at, is_near, row_text, screens_of, spin_ports, spin_to_second, terminal_of } =
	run_board_frame_fixture
const { SPINNER_INTERVAL_MS, spinner_of } = run_board_labels
const { NO_TYPING, type_bytes } = run_board_type_rows
const LETTER_MS = run_board_theme_defs.THEME_DEFS.wargames.intro.letter_ms
const { keyed } = run_board_row_key
const ESCAPE = '\u{1B}'
const GREEN = `${ESCAPE}[32m`
const START = Date.parse('2026-10-08T09:00:00.000Z')
const WIDE = { rows: 24, columns: 80 }
const { RGB_COLOR_DEPTH: RGB_DEPTH } = run_board_labels
// eslint-disable-next-line no-control-regex -- a turn is made of control characters
const TURN = /^(?:\u{1B}\[\d+;\d+H(?:\u{1B}\[[\d;]*m)*.)+(?:\u{1B}\[0m)?$/u

const SYNC_ON = `${ESCAPE}[?2026h`
const SYNC_OFF = `${ESCAPE}[?2026l`

function places(spots: ReadonlyArray<Spot>): Array<[number, number]> {
	return spots.map(({ row, column }) => [row, column])
}

// The typed row 3 as each write left it on screen, and as the typing draws it at that write's moment.
function typed_rows(
	writes: ReadonlyArray<{ at_ms: number; raw: string }>,
	typing: Typing,
): [Array<string>, Array<string>] {
	const shown = screens_of(writes).map((screen) => row_text(screen, 3))

	return [shown, writes.map(({ at_ms }) => row_text(terminal_of([type_bytes(typing, at_ms)]), 3))]
}

// A typing of the one row `line` names, typed from its first column.
function typing_with(line: Pick<TypingLine, 'key' | 'row' | 'text' | 'start_ms'>): Typing {
	return { seen: new Set(), lines: [{ index: line.row - 1, prefix_columns: 0, ...line }] }
}

const UNMARKED = {
	lines: ['▶ run'],
	spots: [],
	keyed: [],
	sweep: undefined,
	lamps: [],
	traces: [],
	rules: [],
	strips: [],
	area: undefined,
}

describe('run_board_spin.spun', () => {
	it('records the title’s, a running row’s and a loading spinner’s spots by display width', () => {
		const lines = [`${SPOT} backlogrun  ✅ 0/1  ⏳ ${SPOT}`, '', `${SPOT} 🔍 1  a`]
		const { spots } = spun(lines, '⠋', { size: WIDE })

		// `⠋ backlogrun  ` is 14 columns, `✅ 0/1  ` 8 with its two-column ✅, `⏳ ` 3 with its ⏳.
		expect(places(spots)).toStrictEqual([
			[1, 1],
			[1, 26],
			[3, 1],
		])
	})

	it('draws every placeholder as the frame and leaves a frame with none as it was', () => {
		const lines = [`${SPOT} run`, 'still']

		expect(spun(lines, '⠙', { size: WIDE }).lines).toStrictEqual(['⠙ run', 'still'])
		expect(spun(['▶ run'], '⠙', { size: WIDE })).toStrictEqual(UNMARKED)
	})

	it('counts the rows a wrapped line takes and keeps the colors in effect at the spot', () => {
		const lines = ['x'.repeat(25), `${GREEN}ab${SPOT}${ESCAPE}[39m`, `${'y'.repeat(12)}${SPOT}`]
		const { spots } = spun(lines, '⠋', { size: { rows: 24, columns: 10 } })

		expect(spots).toStrictEqual([
			{ row: 4, column: 3, style: GREEN },
			{ row: 6, column: 3, style: '' },
		])
	})

	it('records no spot below the rows the frame is kept within', () => {
		const lines = [`${SPOT} run`, 'a', `${SPOT} row`]

		expect(places(spun(lines, '⠋', { size: { rows: 2, columns: 80 } }).spots)).toStrictEqual([
			[1, 1],
		])
		expect(places(spun(lines, '⠋').spots)).toStrictEqual([
			[1, 1],
			[3, 1],
		])
	})
})

const SPOTS = [{ row: 1, column: 1, style: '' }]
const SPINNING = { spots: SPOTS, typing: NO_TYPING }
// A two-letter notice's trace writes: one per letter step, then the lit bar.
const NOTICE_STEPS = [0, 50, 100]

// Every tick a flash steps its color on, through the one that writes the cell back.
function flash_ticks(): Array<number> {
	const { FADE_TICKS, TICK_MS } = run_board_change_flash

	return Array.from({ length: FADE_TICKS }, (_, index) => (index + 1) * TICK_MS)
}

afterEach(() => {
	vi.restoreAllMocks()
})

it('ac-57779c96 cools and restores a flash on its own ticks even without spinner spots', async () => {
	// joshuafolkken/kit#8826: a frame writes only changed cells, and below 24-bit color the fade holds one
	// named color, so the tick-by-tick writes this pins need the 24-bit fade whatever the worker's env.
	vi.spyOn(WriteStream.prototype, 'getColorDepth').mockReturnValue(RGB_DEPTH)
	const { ports, writes } = spin_ports(START)
	const line = { key: 'a', row: 1, index: 0, prefix_columns: 0, text: 'a' }
	const base = run_board_change_flash.next(undefined, [line], START)
	const flash = run_board_change_flash.next(base, [{ ...line, text: 'b' }], START)

	await spin_to_second(
		{ spots: [], typing: NO_TYPING, flash },
		{ ...ports, write_drawn: ports.write },
	)
	const at = writes.map(({ at_ms }) => at_ms - START)

	expect(flash_ticks().every((tick) => at.includes(tick))).toBe(true)
	expect(at.at(-1)).toBe(Math.max(...flash_ticks()))
	expect(cell_at(terminal_of(writes), 1, 1)).toStrictEqual({ char: 'b', sgr: '' })
})

it('writes a placed notice trace on its letter steps until the bar is lit', async () => {
	const { ports, writes } = spin_ports(START)
	const place = { row: 2, column: 5, text: ' ab ', look: { lit: 'green', is_rain: true } as const }
	const notice_trace = { trace: { key: 'notice', start_ms: START }, place }

	await spin_to_second(
		{ spots: [], typing: NO_TYPING, notice_trace },
		{ ...ports, write_drawn: ports.write },
	)
	const lit_ms = NOTICE_STEPS.at(-1) ?? 0
	const shown = terminal_of(writes.filter(({ at_ms }) => at_ms <= START + lit_ms))
	const expected = terminal_of([
		`${ESCAPE}[2;5H${run_board_notice_trace.traced(place.text, lit_ms, place.look, Math.random)}`,
	])

	expect(writes.map(({ at_ms }) => at_ms - START)).toStrictEqual(
		expect.arrayContaining(NOTICE_STEPS),
	)
	expect([row_text(shown, 2), cell_at(shown, 2, 6)]).toStrictEqual([
		row_text(expected, 2),
		cell_at(expected, 2, 6),
	])
})

describe('run_board_spin.spin_to_second', () => {
	it('turns the spinners on every interval until the next second, writing nothing but the turns', async () => {
		const { ports, writes } = spin_ports(START)

		await spin_to_second(SPINNING, ports)

		const turns = Math.ceil(REDRAW_MS / SPINNER_INTERVAL_MS)
		const shown = screens_of(writes).map((screen) => cell_at(screen, 1, 1).char)

		// joshuafolkken/kit#8826: the first frame draws the spinner as it is on the second.
		expect(writes.map(({ at_ms }) => at_ms - START)).toStrictEqual(
			Array.from({ length: turns }, (_, index) => index * SPINNER_INTERVAL_MS),
		)
		expect(writes.every(({ text }) => TURN.test(text))).toBe(true)
		expect(shown).toStrictEqual(writes.map(({ at_ms }) => spinner_of(at_ms)))
		expect(ports.now()).toBe(START + REDRAW_MS)
	})

	it('waits for the second boundary, not a second from now, however late the redraw ended', async () => {
		const late = START + 937
		const { ports, writes } = spin_ports(late)

		await spin_to_second(SPINNING, ports)

		expect(ports.now()).toBe(START + REDRAW_MS)
		expect(writes.map(({ at_ms }) => at_ms - START)).toStrictEqual([937, 960])
	})

	it('writes nothing and sleeps once to the second when no spinner is drawn', async () => {
		const { ports, writes, sleeps } = spin_ports(START + 300)

		await spin_to_second({ spots: [], typing: NO_TYPING }, ports)

		expect(writes).toHaveLength(0)
		expect(sleeps).toStrictEqual([REDRAW_MS - 300])
	})
})

// joshuafolkken/kit#8376: a lamp strip on the blank line above a rule, in the panel's columns.
const PANEL_LAMPS = Array.from({ length: 8 }, () => run_board_spot.LAMP).join(' ')
const STRIP_FRAME = [
	'',
	`── THROUGHPUT ${'─'.repeat(40)}`,
	`  24H  ${PANEL_LAMPS}`,
	`       ${PANEL_LAMPS}`,
	`── USAGE ${'─'.repeat(40)}`,
]

describe('run_board_spin — the lamp strips (joshuafolkken/kit#8376)', () => {
	const drawn = spun(STRIP_FRAME, '⠋', { size: WIDE })

	it('records a strip above the throughput rule only, in the panel’s first row’s columns', () => {
		const panel = drawn.lamps.filter((lamp) => lamp.panel_row === 0).map((lamp) => lamp.column)

		expect(new Set(drawn.strips.map((cell) => cell.row))).toStrictEqual(new Set([1]))
		expect(drawn.strips.map((cell) => cell.column)).toStrictEqual(panel)
	})

	it('writes the strip between redraws while a row types', async () => {
		const { ports, writes } = spin_ports(START)
		const typing = typing_with({ key: 'a', row: 3, text: 'x'.repeat(40), start_ms: START })

		await spin_to_second({ ...drawn, typing }, ports)

		const [strip] = drawn.strips

		expect(writes.some(({ text }) => text.includes(`[1;${String(strip?.column)}H`))).toBe(true)
	})
})

describe('run_board_spin — the rows a theme types (joshuafolkken/kit#8003)', () => {
	it('takes each row’s key out of the frame and records the row it starts on, its spinner kept a placeholder', () => {
		const lines = ['x'.repeat(25), keyed('done', 7, `${SPOT} ✅ 7`), keyed('lanes', 8, 'off')]
		const { lines: written, keyed: rows } = spun(lines, '⠋', { size: { rows: 4, columns: 10 } })

		expect(written).toStrictEqual(['x'.repeat(25), '⠋ ✅ 7', 'off'])
		expect(rows).toStrictEqual([
			{ key: 'done:7', index: 1, row: 4, text: `${SPOT} ✅ 7`, prefix_columns: 0 },
		])
	})

	it('records no keyed row that wraps, so a row typed shorter never moves the lines below it', () => {
		const lines = [keyed('done', 7, 'x'.repeat(25)), keyed('lanes', 8, 'short')]
		const { keyed: rows } = spun(lines, '⠋', { size: { rows: 24, columns: 10 } })

		expect(rows).toStrictEqual([
			{ key: 'lanes:8', index: 1, row: 4, text: 'short', prefix_columns: 0 },
		])
	})

	it('writes a typing row on every letter, at its row, until the next second', async () => {
		const { ports, writes } = spin_ports(START)
		const typing = typing_with({ key: 'done:7', row: 3, text: 'x'.repeat(40), start_ms: START })

		await spin_to_second({ spots: SPOTS, typing }, ports)

		const at = writes.map(({ at_ms }) => at_ms - START)
		const letters = Array.from({ length: REDRAW_MS / LETTER_MS - 1 }, (_, index) => index + 1)
		const [shown, typed] = typed_rows(writes, typing)

		expect(letters.every((letter) => is_near(at, letter * LETTER_MS))).toBe(true)
		expect(shown).toStrictEqual(typed)
		expect(type_bytes(typing, START + LETTER_MS)).toContain(`${ESCAPE}[3;1Hxx█`)
	})
})

describe('run_board_spin — the spinner while rows type (joshuafolkken/kit#8123)', () => {
	const SPOT_ROW = [{ row: 1, column: 5, style: '' }]
	const ROW_TYPING = typing_with({ key: 'done:7', row: 3, text: 'x'.repeat(40), start_ms: START })

	async function written(): Promise<Array<{ at_ms: number; text: string; raw: string }>> {
		const { ports, writes } = spin_ports(START)

		await spin_to_second({ spots: SPOT_ROW, typing: ROW_TYPING }, ports)

		return writes
	}

	it('turns the spinner once on each frame boundary, skipping none', async () => {
		const writes = await written()
		const at = writes.map(({ at_ms }) => at_ms - START)
		const boundaries = Array.from({ length: REDRAW_MS / SPINNER_INTERVAL_MS }, (_, index) => index)
		const shown = screens_of(writes).map((screen) => cell_at(screen, 1, 5).char)

		expect(boundaries.every((turn) => is_near(at, turn * SPINNER_INTERVAL_MS))).toBe(true)
		expect(shown).toStrictEqual(writes.map(({ at_ms }) => spinner_of(at_ms)))
	})

	it('writes the typing row on every wake, each letter on its own time', async () => {
		const writes = await written()
		const at = writes.map(({ at_ms }) => at_ms - START)
		const letters = Array.from({ length: REDRAW_MS / LETTER_MS }, (_, index) => index)
		const [shown, typed] = typed_rows(writes, ROW_TYPING)

		expect(shown).toStrictEqual(typed)
		expect(letters.every((letter) => is_near(at, letter * LETTER_MS))).toBe(true)
	})

	// joshuafolkken/kit#8125: a terminal draws each write's turns and letters at once, never half of one.
	it('writes each wake’s spinner and letters in synchronized output', async () => {
		const writes = await written()

		expect(writes.length).toBeGreaterThan(0)
		expect(writes.every(({ raw, text }) => raw === `${SYNC_ON}${text}${SYNC_OFF}`)).toBe(true)
	})
})

describe('run_board_spin — a typing row’s spinner (joshuafolkken/kit#8003)', () => {
	it('turns on each write, as the turns between redraws do', () => {
		const text = `${SPOT} ${'x'.repeat(40)}`
		const typing = typing_with({ key: 'lanes:8', row: 1, text, start_ms: START - 5 * LETTER_MS })
		const first_ms = START + SPINNER_INTERVAL_MS
		const second_ms = first_ms + SPINNER_INTERVAL_MS

		expect(type_bytes(typing, first_ms)).toContain(`H${spinner_of(first_ms)} x`)
		expect(type_bytes(typing, second_ms)).toContain(`H${spinner_of(second_ms)} x`)
		expect(spinner_of(first_ms)).not.toBe(spinner_of(second_ms))
	})
})

describe('run_board_spin — the header’s now line (joshuafolkken/kit#8103)', () => {
	const PREFIX = `KIT  ${SPOT} 5″  > `
	const WORDS = '#8093 · WRITE'
	const NOW = `${PREFIX}${keyed('now', WORDS, WORDS)}`
	const THIRD_ROW = `${ESCAPE}[3;1H`

	it('records the columns before the key, its spinner a spot that still turns', () => {
		const { spots, keyed: rows } = spun(['a', 'b', NOW], '⠋', { size: WIDE })

		expect(places(spots)).toStrictEqual([[3, 6]])
		expect(rows).toStrictEqual([
			{
				key: `now:${WORDS}`,
				index: 2,
				row: 3,
				text: `${PREFIX}${WORDS}`,
				prefix_columns: 13,
			},
		])
	})

	it('writes the spinner’s turn and the typed words together, the spinner redrawn in the prefix', () => {
		const [row] = spun(['a', 'b', NOW], '⠋', { size: WIDE }).keyed
		const typing = { seen: new Set<string>(), lines: row ? [{ ...row, start_ms: START }] : [] }
		const at_ms = START + LETTER_MS
		const bytes = type_bytes(typing, at_ms)

		expect(bytes).toBe(`${THIRD_ROW}KIT  ${spinner_of(at_ms)} 5″  > #8█${ESCAPE}[K`)
	})

	it('records no now line that wraps', () => {
		expect(spun(['a', 'b', NOW], '⠋', { size: { rows: 24, columns: 20 } }).keyed).toStrictEqual([])
	})
})
