import { describe, expect, it } from 'vitest'
import { run_board_labels } from './run-board-labels'
import { run_board_row_key } from './run-board-row-key'
import { run_board_spin, type Spot } from './run-board-spin'
import { run_board_theme_defs } from './run-board-theme-defs'
import { run_board_type_rows, type Typing, type TypingLine } from './run-board-type-rows'

// joshuafolkken/kit#3495: where a frame's spinners are on screen, and the turns written between
// redraws — a cursor move and one frame each, on the package's interval, until the next second.

const { REDRAW_MS, SPOT, spin_bytes, spin_to_second, spun } = run_board_spin
const { SPINNER_INTERVAL_MS, spinner_of } = run_board_labels
const { NO_TYPING, type_bytes } = run_board_type_rows
const LETTER_MS = run_board_theme_defs.THEME_DEFS.wargames.intro.letter_ms
const { keyed } = run_board_row_key
const ESCAPE = '\u{1B}'
const GREEN = `${ESCAPE}[32m`
const START = Date.parse('2026-10-08T09:00:00.000Z')
const WIDE = { rows: 24, columns: 80 }
// eslint-disable-next-line no-control-regex -- a turn is made of control characters
const TURN = /^(?:\u{1B}\[\d+;\d+H(?:\u{1B}\[[\d;]*m)*.\u{1B}\[0m)+$/u

const SYNC_ON = `${ESCAPE}[?2026h`
const SYNC_OFF = `${ESCAPE}[?2026l`

// A write's bytes inside its synchronized output (joshuafolkken/kit#8125); a write outside it is kept
// whole, so it matches none of the turns it should have been.
function unsynced(text: string): string {
	if (!text.startsWith(SYNC_ON) || !text.endsWith(SYNC_OFF)) return text

	return text.slice(SYNC_ON.length, -SYNC_OFF.length)
}

// A clock that each sleep moves forward, and every write and sleep it saw, each write's `text` the
// bytes inside its synchronized output and `raw` the write as it was.
function spin_ports(now_ms: number): {
	ports: Parameters<typeof spin_to_second>[1]
	writes: Array<{ at_ms: number; text: string; raw: string }>
	sleeps: Array<number>
} {
	const clock = { now_ms }
	const writes: Array<{ at_ms: number; text: string; raw: string }> = []
	const sleeps: Array<number> = []
	const ports = {
		now: () => clock.now_ms,
		write: (raw: string) => {
			writes.push({ at_ms: clock.now_ms, text: unsynced(raw), raw })
		},
		sleep: async (ms: number) => {
			sleeps.push(ms)
			clock.now_ms += ms
		},
	}

	return { ports, writes, sleeps }
}

function places(spots: ReadonlyArray<Spot>): Array<[number, number]> {
	return spots.map(({ row, column }) => [row, column])
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
	rules: [],
}

describe('run_board_spin.spun', () => {
	it('records the title’s, a running row’s and a loading spinner’s spots by display width', () => {
		const lines = [`${SPOT} backlogrun  ✅ 0/1  ⏳ ${SPOT}`, '', `${SPOT} 🔍 1  a`]
		const { spots } = spun(lines, '⠋', WIDE)

		// `⠋ backlogrun  ` is 14 columns, `✅ 0/1  ` 8 with its two-column ✅, `⏳ ` 3 with its ⏳.
		expect(places(spots)).toStrictEqual([
			[1, 1],
			[1, 26],
			[3, 1],
		])
	})

	it('draws every placeholder as the frame and leaves a frame with none as it was', () => {
		const lines = [`${SPOT} run`, 'still']

		expect(spun(lines, '⠙', WIDE).lines).toStrictEqual(['⠙ run', 'still'])
		expect(spun(['▶ run'], '⠙', WIDE)).toStrictEqual(UNMARKED)
	})

	it('counts the rows a wrapped line takes and keeps the colors in effect at the spot', () => {
		const lines = ['x'.repeat(25), `${GREEN}ab${SPOT}${ESCAPE}[39m`, `${'y'.repeat(12)}${SPOT}`]
		const { spots } = spun(lines, '⠋', { rows: 24, columns: 10 })

		expect(spots).toStrictEqual([
			{ row: 4, column: 3, style: GREEN },
			{ row: 6, column: 3, style: '' },
		])
	})

	it('records no spot below the rows the frame is kept within', () => {
		const lines = [`${SPOT} run`, 'a', `${SPOT} row`]

		expect(places(spun(lines, '⠋', { rows: 2, columns: 80 }).spots)).toStrictEqual([[1, 1]])
		expect(places(spun(lines, '⠋').spots)).toStrictEqual([
			[1, 1],
			[3, 1],
		])
	})
})

describe('run_board_spin.spin_bytes', () => {
	it('moves the cursor to each spot and draws the frame in its colors, then resets', () => {
		const spots = [
			{ row: 1, column: 1, style: GREEN },
			{ row: 4, column: 3, style: '' },
		]

		expect(spin_bytes(spots, '⠹')).toBe(
			`${ESCAPE}[1;1H${GREEN}⠹${ESCAPE}[0m${ESCAPE}[4;3H⠹${ESCAPE}[0m`,
		)
	})
})

const SPOTS = [{ row: 1, column: 1, style: '' }]
const SPINNING = { spots: SPOTS, typing: NO_TYPING }

describe('run_board_spin.spin_to_second', () => {
	it('turns the spinners on every interval until the next second, writing nothing but the turns', async () => {
		const { ports, writes } = spin_ports(START)

		await spin_to_second(SPINNING, ports)

		const turns = Math.ceil(REDRAW_MS / SPINNER_INTERVAL_MS) - 1

		expect(writes.map(({ at_ms }) => at_ms - START)).toStrictEqual(
			Array.from({ length: turns }, (_, index) => (index + 1) * SPINNER_INTERVAL_MS),
		)
		expect(writes.every(({ text }) => TURN.test(text))).toBe(true)
		expect(writes[0]?.text).toBe(spin_bytes(SPOTS, spinner_of(START + SPINNER_INTERVAL_MS)))
		expect(ports.now()).toBe(START + REDRAW_MS)
	})

	it('waits for the second boundary, not a second from now, however late the redraw ended', async () => {
		const late = START + 937
		const { ports, writes } = spin_ports(late)

		await spin_to_second(SPINNING, ports)

		expect(ports.now()).toBe(START + REDRAW_MS)
		expect(writes.map(({ at_ms }) => at_ms - START)).toStrictEqual([960])
	})

	it('writes nothing and sleeps once to the second when no spinner is drawn', async () => {
		const { ports, writes, sleeps } = spin_ports(START + 300)

		await spin_to_second({ spots: [], typing: NO_TYPING }, ports)

		expect(writes).toHaveLength(0)
		expect(sleeps).toStrictEqual([REDRAW_MS - 300])
	})
})

describe('run_board_spin — the rows a theme types (joshuafolkken/kit#8003)', () => {
	it('takes each row’s key out of the frame and records the row it starts on, its spinner kept a placeholder', () => {
		const lines = ['x'.repeat(25), keyed('done', 7, `${SPOT} ✅ 7`), keyed('lanes', 8, 'off')]
		const { lines: written, keyed: rows } = spun(lines, '⠋', { rows: 4, columns: 10 })

		expect(written).toStrictEqual(['x'.repeat(25), '⠋ ✅ 7', 'off'])
		expect(rows).toStrictEqual([
			{ key: 'done:7', index: 1, row: 4, text: `${SPOT} ✅ 7`, prefix_columns: 0 },
		])
	})

	it('records no keyed row that wraps, so a row typed shorter never moves the lines below it', () => {
		const lines = [keyed('done', 7, 'x'.repeat(25)), keyed('lanes', 8, 'short')]
		const { keyed: rows } = spun(lines, '⠋', { rows: 24, columns: 10 })

		expect(rows).toStrictEqual([
			{ key: 'lanes:8', index: 1, row: 4, text: 'short', prefix_columns: 0 },
		])
	})

	it('writes a typing row on every letter, at its row, until the next second', async () => {
		const { ports, writes } = spin_ports(START)
		const typing = typing_with({ key: 'done:7', row: 3, text: 'x'.repeat(40), start_ms: START })

		await spin_to_second({ spots: SPOTS, typing }, ports)

		const first_ms = START + LETTER_MS
		const letters = Array.from({ length: REDRAW_MS / LETTER_MS - 1 }, (_, index) => index + 1)

		expect(
			letters.every((letter) => writes.some(({ at_ms }) => at_ms === START + letter * LETTER_MS)),
		).toBe(true)
		expect(writes[0]?.text).toBe(type_bytes(typing, first_ms))
		expect(writes[0]?.text).toContain(`${ESCAPE}[3;1Hxx${ESCAPE}[0m█`)
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
		const turned = writes.filter(({ text }) => text.startsWith(`${ESCAPE}[1;5H`))
		const turns = Math.ceil(REDRAW_MS / SPINNER_INTERVAL_MS) - 1

		expect(turned.map(({ at_ms }) => at_ms - START)).toStrictEqual(
			Array.from({ length: turns }, (_, index) => (index + 1) * SPINNER_INTERVAL_MS),
		)
		expect(
			turned.every(({ at_ms, text }) => text.startsWith(spin_bytes(SPOT_ROW, spinner_of(at_ms)))),
		).toBe(true)
	})

	it('writes the typing row on every wake, each letter on its own time', async () => {
		const writes = await written()

		expect(writes.every(({ at_ms, text }) => text.endsWith(type_bytes(ROW_TYPING, at_ms)))).toBe(
			true,
		)
		expect(writes.filter(({ at_ms }) => (at_ms - START) % LETTER_MS === 0)).toHaveLength(
			REDRAW_MS / LETTER_MS - 1,
		)
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
		const { spots, keyed: rows } = spun(['a', 'b', NOW], '⠋', WIDE)

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
		const [row] = spun(['a', 'b', NOW], '⠋', WIDE).keyed
		const typing = { seen: new Set<string>(), lines: row ? [{ ...row, start_ms: START }] : [] }
		const at_ms = START + LETTER_MS
		const bytes = type_bytes(typing, at_ms)

		expect(bytes).toBe(`${THIRD_ROW}KIT  ${spinner_of(at_ms)} 5″  > #8${ESCAPE}[0m█${ESCAPE}[K`)
	})

	it('records no now line that wraps', () => {
		expect(spun(['a', 'b', NOW], '⠋', { rows: 24, columns: 20 }).keyed).toStrictEqual([])
	})
})
