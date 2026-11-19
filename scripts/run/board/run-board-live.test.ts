import { describe, expect, it } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import { run_board_live } from './run-board-live'
import { run_board_screen } from './run-board-screen'
import type { TypingSound } from './run-board-sound-typing'

// joshuafolkken/kit#8145: the live loop enters the alternate screen, hands its leave to the exit
// handler, and leaves the screen once when the redraw stops — however many paths reach the leave.

const { LOCAL, STOPPED, harness, plan_titled } = run_board_fixture
const SCREEN = run_board_screen.screen_of('live')

describe('run_board_live.watch', () => {
	it('enters the alternate screen first and leaves it last when the redraw stops', async () => {
		const { ports, frames, leaves } = harness(undefined, [])

		await expect(run_board_live.watch(ports, undefined)).rejects.toBe(STOPPED)
		expect(frames[0]).toBe(SCREEN.enter)
		expect(frames.at(-1)).toBe(SCREEN.leave)
		expect(leaves).toHaveLength(1)
	})

	it('leaves the screen only once when the exit handler runs after the redraw stopped', async () => {
		const { ports, frames, leaves } = harness(undefined, [])

		await expect(run_board_live.watch(ports, undefined)).rejects.toBe(STOPPED)
		leaves[0]?.()
		expect(frames.filter((frame) => frame === SCREEN.leave)).toHaveLength(1)
	})
})

// joshuafolkken/kit#8250: the trill reaches the draws only in a theme, and the board stops it as it
// leaves.
function trill_heard(): { switched: Array<string>; typing_sound: TypingSound } {
	const switched: Array<string> = []

	return {
		switched,
		typing_sound: {
			set: (is_on) => {
				switched.push(is_on ? 'on' : 'off')
			},
			stop: () => {
				switched.push('stop')
			},
		},
	}
}

describe('run_board_live.watch trill', () => {
	it('sounds no trill with no theme, and stops it as the board leaves', async () => {
		const { ports } = harness(undefined, [])
		const { switched, typing_sound } = trill_heard()

		await expect(run_board_live.watch({ ...ports, typing_sound }, undefined)).rejects.toBe(STOPPED)
		expect(switched).toStrictEqual(['stop'])
	})

	it('hands the trill to the draws in a theme', async () => {
		const { ports } = harness(LOCAL, [plan_titled('a')])
		const { switched, typing_sound } = trill_heard()

		await expect(run_board_live.watch({ ...ports, typing_sound }, 'wargames')).rejects.toBe(STOPPED)
		expect(switched.length).toBeGreaterThan(1)
		expect(switched.at(-1)).toBe('stop')
	})

	it('stops the trill once however many paths reach the leave', async () => {
		const { ports, leaves } = harness(undefined, [])
		const { switched, typing_sound } = trill_heard()

		await expect(run_board_live.watch({ ...ports, typing_sound }, undefined)).rejects.toBe(STOPPED)
		leaves[0]?.()
		expect(switched.filter((event) => event === 'stop')).toHaveLength(1)
	})
})
