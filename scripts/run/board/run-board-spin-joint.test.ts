import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_drop_screen } from './run-board-drop-screen'
import { run_board_frame_fixture } from './run-board-frame-fixture'
import { run_board_frame_loop } from './run-board-frame-loop'
import { run_board_rain_drop } from './run-board-rain-drop'
import { run_board_screen } from './run-board-screen'
import { run_board_type_rows } from './run-board-type-rows'

// joshuafolkken/kit#8796: the frame drawn on the second and the rain the spin draws back over it go
// out in one synchronized write, so no terminal shows the frame without its rain; the turns after the
// spin's first wait show what the split writes did. joshuafolkken/kit#8826: the frame is the base layer
// the spin's first frame draws, so the two are one frame's write.

const { settled, spin_to_second, terminal_of } = run_board_frame_fixture
const { NO_TYPING } = run_board_type_rows
const { drop_bytes } = run_board_rain_drop
const START = Date.parse('2026-10-08T09:00:00.000Z')
const SYNC_ON = '\u{1B}[?2026h'
const SYNC_OFF = '\u{1B}[?2026l'
const SIZE = { rows: 24, columns: 40 }
const LINES = Array.from({ length: SIZE.rows }, () => 'x'.repeat(SIZE.columns))
const SCREEN = run_board_drop_screen.screen_of({ lines: LINES, spots: [] }, NO_TYPING, SIZE)
const FRAME = run_board_screen.screen_of('live').frame(LINES.join('\n'))

interface Written {
	at_ms: number
	raw: string
}

// Every write the terminal is given over the frame's second: the frame set as the base over the last
// second's screen, then the spin until the next second.
async function second_of(): Promise<Array<Written>> {
	const written: Array<Written> = []
	const clock = { now_ms: START }
	const ports = {
		now: () => clock.now_ms,
		write: (raw: string) => {
			written.push({ at_ms: clock.now_ms, raw })
		},
		sleep: async (ms: number) => {
			clock.now_ms += ms
		},
		size: () => SIZE,
	}
	const screen = settled('', SIZE)

	run_board_frame_loop.set_base(screen, FRAME)
	await spin_to_second({ spots: [], typing: NO_TYPING, drop: SCREEN }, ports, screen)

	return written
}

// The screen the split writes left at `at_ms`: the frame, then the drop's change at each step up to it.
function split_at(steps: ReadonlyArray<number>, at_ms: number): ReturnType<typeof terminal_of> {
	const upto = steps.filter((step_ms) => step_ms <= at_ms)
	const dropped = upto.map((step_ms, index) => drop_bytes(SCREEN, step_ms, upto[index - 1]))

	return terminal_of([FRAME, ...dropped], SIZE)
}

beforeEach(() => {
	vi.stubEnv('FORCE_COLOR', '3')
})

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_board_spin — the frame and its rain in one write (joshuafolkken/kit#8796)', () => {
	it('ac-44d74ade writes the cleared frame and the rain drawn back in one block, none ending between', async () => {
		const [first] = await second_of()
		const joined = first?.raw ?? ''

		expect(drop_bytes(SCREEN, START, undefined)).not.toBe('')
		expect(first?.at_ms).toBe(START)
		expect([joined.startsWith(SYNC_ON), joined.endsWith(SYNC_OFF)]).toStrictEqual([true, true])
		expect(joined.split(SYNC_OFF)).toHaveLength(2)
	})

	it('ac-d0223835 leaves the terminal with the same cells as the split writes did', async () => {
		const [first] = await second_of()

		expect(terminal_of([first?.raw ?? ''], SIZE)).toStrictEqual(split_at([START], START))
	})

	it('ac-fd08ac21 shows every turn after the first wait as it did unjoined', async () => {
		const written = await second_of()
		const steps = written.map(({ at_ms }) => at_ms)
		const shown = written.map((_, index) => terminal_of(written.slice(0, index + 1), SIZE))

		expect(written.length).toBeGreaterThan(1)
		expect(shown).toStrictEqual(steps.map((at_ms) => split_at(steps, at_ms)))
	})
})
