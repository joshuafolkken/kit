import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_drop_screen } from './run-board-drop-screen'
import { run_board_rain_drop } from './run-board-rain-drop'
import { run_board_spin } from './run-board-spin'
import { run_board_sweep } from './run-board-sweep'
import { run_board_type_rows } from './run-board-type-rows'

// joshuafolkken/kit#8367: the drop falls between redraws on the sweep's step, writing only the
// cells that changed since the last turn.

const { REDRAW_MS, spin_to_second } = run_board_spin
const { NO_TYPING } = run_board_type_rows
const { DROP_MS, drop_bytes } = run_board_rain_drop
const START = Date.parse('2026-10-08T09:00:00.000Z')
const SYNC_ON = '\u{1B}[?2026h'
const SYNC_OFF = '\u{1B}[?2026l'
const SIZE = { rows: 24, columns: 40 }
const SCREEN = run_board_drop_screen.screen_of(
	{ lines: Array.from({ length: SIZE.rows }, () => 'x'.repeat(SIZE.columns)), spots: [] },
	NO_TYPING,
	SIZE,
)

interface Written {
	at_ms: number
	text: string
}

// A clock each sleep moves forward and every write past the theme it saw, without its synchronized
// output, apart from the writes the theme restyles.
function drop_ports(now_ms: number): {
	ports: Parameters<typeof spin_to_second>[1]
	writes: Array<Written>
	themed: Array<string>
} {
	const clock = { now_ms }
	const writes: Array<Written> = []
	const themed: Array<string> = []
	const ports = {
		now: () => clock.now_ms,
		write: (raw: string) => {
			themed.push(raw.replace(SYNC_ON, '').replace(SYNC_OFF, ''))
		},
		write_drawn: (raw: string) => {
			writes.push({ at_ms: clock.now_ms, text: raw.replace(SYNC_ON, '').replace(SYNC_OFF, '') })
		},
		sleep: async (ms: number) => {
			clock.now_ms += ms
		},
	}

	return { ports, writes, themed }
}

beforeEach(() => {
	vi.stubEnv('FORCE_COLOR', '3')
})

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_board_spin — the drop between redraws (joshuafolkken/kit#8367)', () => {
	it('falls on the sweep’s step', () => {
		expect(DROP_MS).toBe(run_board_sweep.SWEEP_MS)
	})

	it('writes every lit cell on the second, then what changed on each step after', async () => {
		const { ports, writes } = drop_ports(START)

		await spin_to_second({ spots: [], typing: NO_TYPING, drop: SCREEN }, ports)

		expect(writes[0]).toStrictEqual({ at_ms: START, text: drop_bytes(SCREEN, START, undefined) })
		const stepped = writes.slice(1)

		expect(stepped.length).toBeGreaterThan(0)
		expect(stepped.every(({ text }) => text !== '')).toBe(true)
		expect(stepped.every(({ at_ms }) => (at_ms - START) % DROP_MS === 0)).toBe(true)
		expect(ports.now()).toBe(START + REDRAW_MS)
	})

	it('writes exactly the drop’s change from the step before', async () => {
		const { ports, writes } = drop_ports(START)

		await spin_to_second({ spots: [], typing: NO_TYPING, drop: SCREEN }, ports)
		const at_ms = START + DROP_MS * 10
		const written = writes.find((write) => write.at_ms === at_ms)

		expect(written?.text).toBe(drop_bytes(SCREEN, at_ms, at_ms - DROP_MS))
	})

	// The screen holds each cell as the theme drew it, so the theme never restyles the drop again.
	it('writes the drop past the theme, never through it', async () => {
		const { ports, themed } = drop_ports(START)

		await spin_to_second({ spots: [], typing: NO_TYPING, drop: SCREEN }, ports)

		expect(themed.every((text) => text === '')).toBe(true)
	})
})

// joshuafolkken/kit#8370: a typing row is written over the drops of its own turn, above the rain.
describe('run_board_spin — a typing row over the drop', () => {
	it('writes the typing row after the drop on the same turn', async () => {
		const order: Array<string> = []
		const { ports } = drop_ports(START)
		const keyed = [{ key: 'now:A', index: 0, row: 1, text: 'ABCDEF', prefix_columns: 0 }]
		const frame = { keyed, known: new Set(['now:A']) }
		const base = run_board_type_rows.next(
			NO_TYPING,
			{ keyed: [], known: new Set<string>() },
			START,
			true,
		)
		const typing = run_board_type_rows.next(base, frame, START, true)
		const sequenced = {
			...ports,
			write: (raw: string) => {
				order.push(raw.includes('\u{1B}[1;1HA') ? 'typed' : 'other')
			},
			write_drawn: () => {
				order.push('drop')
			},
		}

		await spin_to_second({ spots: [], typing, drop: SCREEN }, sequenced)

		expect(order.slice(0, 2)).toStrictEqual(['drop', 'typed'])
	})
})
