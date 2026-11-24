import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_drop_screen } from './run-board-drop-screen'
import { run_board_frame_fixture } from './run-board-frame-fixture'
import { run_board_frame_loop } from './run-board-frame-loop'
import { run_board_labels } from './run-board-labels'
import { run_board_rain_drop } from './run-board-rain-drop'
import { run_board_spin } from './run-board-spin'
import { run_board_sweep } from './run-board-sweep'
import { run_board_type_rows } from './run-board-type-rows'

// joshuafolkken/kit#8367: the drop falls between redraws on the sweep's step, writing only the
// cells that changed since the last turn.

const { REDRAW_MS } = run_board_spin
const { cell_at, row_text, screens_of, spin_to_second, terminal_of } = run_board_frame_fixture
const { NO_TYPING } = run_board_type_rows
const { SPINNER_INTERVAL_MS, spinner_of } = run_board_labels
const { DROP_MS, drop_bytes } = run_board_rain_drop
const { MIN_FRAME_MS } = run_board_frame_loop
const START = Date.parse('2026-10-08T09:00:00.000Z')
const SPINNER_FRAMES = new Set(
	Array.from({ length: REDRAW_MS / SPINNER_INTERVAL_MS }, (_, turn) =>
		spinner_of(START + turn * SPINNER_INTERVAL_MS),
	),
)
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

// The screen `writes` leave, as its characters and styles.
function picture(writes: Parameters<typeof terminal_of>[0]): {
	chars: Uint32Array
	styles: Uint16Array
} {
	const { chars, styles } = terminal_of(writes)

	return { chars, styles }
}

// Whether a spinner frame shows at the top-left after any of `writes`.
function spinner_shown(writes: ReadonlyArray<Written>): boolean {
	return screens_of(writes).some((screen) => SPINNER_FRAMES.has(cell_at(screen, 1, 1).char))
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

		expect(writes[0]?.at_ms).toBe(START)
		expect(picture(writes.slice(0, 1))).toStrictEqual(
			picture([drop_bytes(SCREEN, START, undefined)]),
		)
		const stepped = writes.slice(1)

		expect(stepped.length).toBeGreaterThan(0)
		expect(stepped.every(({ text }) => text !== '')).toBe(true)
		// joshuafolkken/kit#8826: a step may be held back by at most one refresh after the last frame.
		expect(stepped.every(({ at_ms }) => (at_ms - START) % DROP_MS < MIN_FRAME_MS)).toBe(true)
		expect(ports.now()).toBe(START + REDRAW_MS)
	})

	it('writes exactly the drop’s change from the step before', async () => {
		const { ports, writes } = drop_ports(START)

		await spin_to_second({ spots: [], typing: NO_TYPING, drop: SCREEN }, ports)
		const at_ms = START + DROP_MS * 10
		const steps = writes.filter((write) => write.at_ms <= at_ms).map((write) => write.at_ms)
		const dropped = steps.map((step_ms, index) => drop_bytes(SCREEN, step_ms, steps[index - 1]))

		expect(steps.at(-1)).toBe(at_ms)
		expect(picture(writes.filter((write) => write.at_ms <= at_ms))).toStrictEqual(picture(dropped))
	})

	// The screen holds each cell as the theme drew it, so the theme never restyles the drop again.
	it('writes the drop past the theme, never through it', async () => {
		const { ports, themed } = drop_ports(START)

		await spin_to_second({ spots: [], typing: NO_TYPING, drop: SCREEN }, ports)

		expect(themed.every((text) => text === '')).toBe(true)
	})
})

// joshuafolkken/kit#8782: the bttf jump lights the spinners' places, so they hold while it runs rather
// than turn back to the dark over its light.
describe('run_board_spin — the spinners through the bttf jump', () => {
	const SPOTS = [{ row: 1, column: 1, style: '' }]
	const SPINNER_AT = '\u{1B}[1;1H'
	const JUMP = {
		run: { start_ms: START, letters: 4 },
		screen: { ...SCREEN, skips: new Set(['1;1']) },
		scene: { rows: SIZE.rows, panel: undefined },
	}

	it('turns the spinners with no jump', async () => {
		const { ports, writes } = drop_ports(START)

		await spin_to_second({ spots: SPOTS, typing: NO_TYPING }, ports)

		expect(spinner_shown(writes)).toBe(true)
	})

	it('ac-9a24befb holds the spinners while the jump runs and lights their places', async () => {
		const { ports, writes } = drop_ports(START)

		await spin_to_second({ spots: SPOTS, typing: NO_TYPING, jump: JUMP }, ports)

		expect(spinner_shown(writes)).toBe(false)
		expect(writes.some(({ text }) => text.includes(SPINNER_AT))).toBe(true)
	})
})

// joshuafolkken/kit#8370: a typing row is written over the drops of its own turn, above the rain.
describe('run_board_spin — a typing row over the drop', () => {
	it('writes the typing row after the drop on the same turn', async () => {
		const { ports, writes } = drop_ports(START)
		const keyed = [{ key: 'now:A', index: 0, row: 1, text: 'ABCDEF', prefix_columns: 0 }]
		const frame = { keyed, known: new Set(['now:A']) }
		const base = run_board_type_rows.next(
			NO_TYPING,
			{ keyed: [], known: new Set<string>() },
			START,
			true,
		)
		const typing = run_board_type_rows.next(base, frame, START, true)

		await spin_to_second({ spots: [], typing, drop: SCREEN }, ports)
		const rows = screens_of(writes).map((screen) => row_text(screen, 1))
		const first = rows.findIndex((row) => row.startsWith('A'))

		// joshuafolkken/kit#8826: the typing row, erased to its end, is drawn above the drop in every
		// frame, so no drop cell shows on its row once it types.
		expect(first).toBeGreaterThanOrEqual(0)
		expect(rows.slice(first).every((row) => !row.includes('x'))).toBe(true)
	})
})
