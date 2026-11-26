import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_frame_fixture } from './run-board-frame-fixture'
import { run_board_labels } from './run-board-labels'
import { run_board_row_key } from './run-board-row-key'
import { run_board_spin, type Spot } from './run-board-spin'
import { run_board_type_rows } from './run-board-type-rows'

// joshuafolkken/kit#3495: where a frame's spinners are on screen, and the turns written between
// redraws — a cursor move and one frame each, on the package's interval, until the next second.

const { REDRAW_MS, SPOT, spun } = run_board_spin
const { cell_at, screens_of, spin_ports, spin_to_second } = run_board_frame_fixture
const { SPINNER_INTERVAL_MS, spinner_of } = run_board_labels
const { NO_TYPING } = run_board_type_rows
const { keyed } = run_board_row_key
const ESCAPE = '\u{1B}'
const GREEN = `${ESCAPE}[32m`
const START = Date.parse('2026-10-08T09:00:00.000Z')
const WIDE = { rows: 24, columns: 80 }
// eslint-disable-next-line no-control-regex -- a turn is made of control characters
const TURN = /^(?:\u{1B}\[\d+;\d+H(?:\u{1B}\[[\d;]*m)*.)+(?:\u{1B}\[0m)?$/u

const SYNC_ON = `${ESCAPE}[?2026h`
const SYNC_OFF = `${ESCAPE}[?2026l`

function places(spots: ReadonlyArray<Spot>): Array<[number, number]> {
	return spots.map(({ row, column }) => [row, column])
}

const UNMARKED = {
	lines: ['▶ run'],
	spots: [],
	keyed: [],
	lamps: [],
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

afterEach(() => {
	vi.restoreAllMocks()
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

describe('run_board_frame_fixture.spin_ports — a terminal slow to take a write (joshuafolkken/kit#8936)', () => {
	it('moves the clock by the write time each write takes', () => {
		const write_ms = 15
		const { ports, writes } = spin_ports(START, write_ms)

		ports.write('a')
		ports.write('b')

		expect(writes.map(({ at_ms }) => at_ms - START)).toStrictEqual([0, write_ms])
		expect(ports.now()).toBe(START + write_ms * 2)
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
})

// joshuafolkken/kit#8125: a terminal draws each write's turns at once, never half of one.
describe('run_board_spin — synchronized output', () => {
	it('writes each wake’s spinner in synchronized output', async () => {
		const { ports, writes } = spin_ports(START)

		await spin_to_second(SPINNING, ports)

		expect(writes.length).toBeGreaterThan(0)
		expect(writes.every(({ raw, text }) => raw === `${SYNC_ON}${text}${SYNC_OFF}`)).toBe(true)
	})
})

describe('run_board_spin — the header’s now line (joshuafolkken/kit#8103)', () => {
	const PREFIX = `KIT  ${SPOT} 5″  > `
	const WORDS = '#8093 · WRITE'
	const NOW = `${PREFIX}${keyed('now', WORDS, WORDS)}`

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

	it('records no now line that wraps', () => {
		expect(spun(['a', 'b', NOW], '⠋', { size: { rows: 24, columns: 20 } }).keyed).toStrictEqual([])
	})
})
