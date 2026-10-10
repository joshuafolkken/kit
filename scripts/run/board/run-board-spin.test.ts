import { describe, expect, it } from 'vitest'
import { run_board_labels } from './run-board-labels'
import { run_board_spin, type Spot } from './run-board-spin'

// joshuafolkken/kit#3495: where a frame's spinners are on screen, and the turns written between
// redraws — a cursor move and one frame each, on the package's interval, until the next second.

const { REDRAW_MS, SPOT, spin_bytes, spin_to_second, spun } = run_board_spin
const { SPINNER_INTERVAL_MS, spinner_of } = run_board_labels
const ESCAPE = '\u{1B}'
const GREEN = `${ESCAPE}[32m`
const START = Date.parse('2026-10-08T09:00:00.000Z')
const WIDE = { rows: 24, columns: 80 }
// eslint-disable-next-line no-control-regex -- a turn is made of control characters
const TURN = /^(?:\u{1B}\[\d+;\d+H(?:\u{1B}\[[\d;]*m)*.\u{1B}\[0m)+$/u

// A clock that each sleep moves forward, and every write and sleep it saw.
function spin_ports(now_ms: number): {
	ports: Parameters<typeof spin_to_second>[1]
	writes: Array<{ at_ms: number; text: string }>
	sleeps: Array<number>
} {
	const clock = { now_ms }
	const writes: Array<{ at_ms: number; text: string }> = []
	const sleeps: Array<number> = []
	const ports = {
		now: () => clock.now_ms,
		write: (text: string) => {
			writes.push({ at_ms: clock.now_ms, text })
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
		expect(spun(['▶ run'], '⠙', WIDE)).toStrictEqual({ lines: ['▶ run'], spots: [] })
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

describe('run_board_spin.spin_to_second', () => {
	const SPOTS = [{ row: 1, column: 1, style: '' }]

	it('turns the spinners on every interval until the next second, writing nothing but the turns', async () => {
		const { ports, writes } = spin_ports(START)

		await spin_to_second(SPOTS, ports)

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

		await spin_to_second(SPOTS, ports)

		expect(ports.now()).toBe(START + REDRAW_MS)
		expect(writes.map(({ at_ms }) => at_ms - START)).toStrictEqual([960])
	})

	it('writes nothing and sleeps once to the second when no spinner is drawn', async () => {
		const { ports, writes, sleeps } = spin_ports(START + 300)

		await spin_to_second([], ports)

		expect(writes).toHaveLength(0)
		expect(sleeps).toStrictEqual([REDRAW_MS - 300])
	})
})
