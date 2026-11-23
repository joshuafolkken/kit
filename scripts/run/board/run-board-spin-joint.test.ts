import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_drop_screen } from './run-board-drop-screen'
import { run_board_rain_drop } from './run-board-rain-drop'
import { run_board_reveal_rain_fixture } from './run-board-reveal-rain-fixture'
import { run_board_screen } from './run-board-screen'
import { run_board_spin } from './run-board-spin'
import { run_board_type_rows } from './run-board-type-rows'

// joshuafolkken/kit#8796: the frame drawn on the second and the rain the spin draws back over it go
// out in one synchronized write, so no terminal shows the frame without its rain; the turns after the
// spin's first wait are written as before.

const { spin_to_second } = run_board_spin
const { NO_TYPING } = run_board_type_rows
const { drop_bytes } = run_board_rain_drop
const { screens } = run_board_reveal_rain_fixture
const START = Date.parse('2026-10-08T09:00:00.000Z')
const SYNC_ON = '\u{1B}[?2026h'
const SYNC_OFF = '\u{1B}[?2026l'
const ERASE_BELOW = '\u{1B}[J'
const SIZE = { rows: 24, columns: 40 }
const LINES = Array.from({ length: SIZE.rows }, () => 'x'.repeat(SIZE.columns))
const SCREEN = run_board_drop_screen.screen_of({ lines: LINES, spots: [] }, NO_TYPING, SIZE)
const FRAME = run_board_screen.screen_of('live').frame(LINES.join('\n'))

// Every write the terminal is given over the frame's second: the frame, then the spin until the next
// second, through a joint held on the frame where `is_held` says so, as the live board's is.
async function second_of(is_held: boolean): Promise<Array<string>> {
	const written: Array<string> = []
	const clock = { now_ms: START }
	const joint = run_board_screen.joint_of((bytes) => {
		written.push(bytes)
	})
	const terminal = {
		now: () => clock.now_ms,
		write: joint.write,
		sleep: async (ms: number) => {
			clock.now_ms += ms
		},
	}
	const ports = run_board_screen.jointed(terminal, joint)

	if (is_held) joint.hold()
	ports.write(FRAME)
	await spin_to_second(
		{ spots: [], typing: NO_TYPING, drop: SCREEN },
		{ ...ports, write_drawn: ports.write },
	)

	return written
}

// The split writes the held one joins: all but the turns written after the first wait.
function opening_of(split: ReadonlyArray<string>, held: ReadonlyArray<string>): Array<string> {
	return split.slice(0, split.length - held.length + 1)
}

beforeEach(() => {
	vi.stubEnv('FORCE_COLOR', '3')
})

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_board_spin — the frame and its rain in one write (joshuafolkken/kit#8796)', () => {
	it('ac-44d74ade writes the cleared frame and the rain drawn back in one block, none ending between', async () => {
		const [joined = ''] = await second_of(true)
		const rain = drop_bytes(SCREEN, START, undefined)

		expect(rain).not.toBe('')
		expect([joined.startsWith(SYNC_ON), joined.endsWith(SYNC_OFF)]).toStrictEqual([true, true])
		expect(joined.split(SYNC_OFF)).toHaveLength(2)
		expect(joined.indexOf(ERASE_BELOW)).toBeLessThan(joined.indexOf(rain))
	})

	it('ac-d0223835 leaves the terminal with the same cells as the split writes did', async () => {
		const held = await second_of(true)
		const split = await second_of(false)
		const [joined = ''] = held

		expect(opening_of(split, held).length).toBeGreaterThan(1)
		expect(screens([joined]).at(-1)).toStrictEqual(screens(opening_of(split, held)).at(-1))
	})

	it('ac-fd08ac21 writes every turn after the first wait as it did unjoined', async () => {
		const held = await second_of(true)
		const split = await second_of(false)

		expect(held.length).toBeGreaterThan(1)
		expect(held.slice(1)).toStrictEqual(split.slice(opening_of(split, held).length))
	})
})
