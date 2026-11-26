import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_cli } from './run-board-cli'
import { run_board_output_hold } from './run-board-output-hold'
import { run_board_sound_player } from './run-board-sound-player'

// joshuafolkken/kit#9008: the screen's leave says what was held meanwhile, and the board's own writes
// (its frames and its bell) still reach the terminal while the rest is held.

afterEach(() => {
	vi.restoreAllMocks()
})

type Leaving = Parameters<typeof run_board_cli.leaving>

// The exit guard registers the leave; the test runs it as the process would on its way out.
function leave_run(): { release: ReturnType<typeof vi.fn>; order: Array<string> } {
	const order: Array<string> = []
	const release = vi.fn(() => {
		order.push('release')
	})
	const registered: Array<() => void> = []
	const exits = {
		on_exit: (leave: () => void) => {
			registered.push(leave)
		},
	} as unknown as NonNullable<Leaving[0]>
	const live = { on_exit: vi.fn() } as unknown as Leaving[1]

	run_board_cli.leaving(
		exits,
		live,
		release,
	)((): void => {
		order.push('leave')
	})
	for (const leave of registered) leave()

	return { release, order }
}

describe('run_board_cli.leaving', () => {
	it('releases the hold after the screen is left', () => {
		const { release, order } = leave_run()

		expect(release).toHaveBeenCalledOnce()
		expect(order).toStrictEqual(['leave', 'release'])
	})

	it('leaves the registration to the live ports when there are no exits', () => {
		const live = { on_exit: vi.fn() } as unknown as Leaving[1]

		expect(run_board_cli.leaving(undefined, live, vi.fn())).toBe(live.on_exit)
	})
})

describe('run_board_output_hold.terminal', () => {
	it('writes to the stdout the hold found while everything else is held', () => {
		const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
		const release = run_board_output_hold.hold()

		try {
			run_board_output_hold.terminal.write('frame')
			process.stdout.write('stray')

			expect(out.mock.calls.map(([chunk]) => String(chunk))).toStrictEqual(['frame'])
		} finally {
			release()
		}
	})

	it('is the port the live board draws its frames through while held', () => {
		const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
		const release = run_board_output_hold.hold()

		try {
			run_board_cli.LIVE_PORTS.write('frame')
			process.stdout.write('stray')

			expect(out.mock.calls.map(([chunk]) => String(chunk))).toStrictEqual(['frame'])
		} finally {
			release()
		}
	})

	it('lets the bell of the sound player through while held', () => {
		const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
		const release = run_board_output_hold.hold()

		try {
			run_board_sound_player.play('x.wav', { platform: 'aix' })

			expect(out).toHaveBeenCalledExactlyOnceWith(run_board_sound_player.BEL)
		} finally {
			release()
		}
	})
})
