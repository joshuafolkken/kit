import { describe, expect, it } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import type { KeyInput } from './run-board-keys'
import { run_board_live } from './run-board-live'
import { run_board_screen } from './run-board-screen'
import type { TypingSound } from './run-board-sound-typing'

// joshuafolkken/kit#8145: the live loop enters the alternate screen, hands its leave to the exit
// handler, and leaves the screen once when the redraw stops — however many paths reach the leave.

const { LOCAL, STOPPED, harness, plan_titled } = run_board_fixture
const SCREEN = run_board_screen.screen_of('live')

// joshuafolkken/kit#8360: the live effects are the theme definition's, not whether a theme is given.
describe('run_board_live.live_of', () => {
	it('reads the rows typed and the trill from the wargames definition', () => {
		expect(run_board_live.live_of('wargames')).toStrictEqual({ types_rows: true, trill: true })
	})

	it('chooses no live effect with no theme', () => {
		expect(run_board_live.live_of(undefined)).toStrictEqual({ types_rows: false, trill: false })
	})

	it('chooses no live effect for a theme the table has no row for', () => {
		expect(run_board_live.live_of('wargames', {})).toStrictEqual({
			types_rows: false,
			trill: false,
		})
	})

	it('chooses no live effect where the definition turns them off', () => {
		const defs = { wargames: { live: { types_rows: false, trill: false } } }

		expect(run_board_live.live_of('wargames', defs)).toStrictEqual({
			types_rows: false,
			trill: false,
		})
	})
})

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

async function instant(): Promise<void> {
	await Promise.resolve()
}

// A keyboard on a terminal whose sound switch starts as `is_on`; `type` hands it a key.
function sound_keys(is_on: boolean): { input: KeyInput; type: (chunk: string) => void } {
	const held: { on_data: ((chunk: string) => void) | undefined } = { on_data: undefined }
	const input: KeyInput = {
		is_tty: true,
		raw: () => undefined,
		listen: (on_data) => {
			held.on_data = on_data
		},
		close: () => undefined,
		interrupt: () => undefined,
		store: {
			load: () => new Set(),
			save: () => undefined,
			load_sound: () => is_on,
			save_sound: () => undefined,
		},
	}

	return { input, type: (chunk) => held.on_data?.(chunk) }
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

describe('run_board_live.watch trill and the sound switch', () => {
	it('switches the trill off as s switches the sound off', async () => {
		const { ports } = harness(undefined, [])
		const { switched, typing_sound } = trill_heard()
		const { input, type } = sound_keys(true)
		const watching = run_board_live.watch({ ...ports, typing_sound, keys: input }, undefined)

		type('s')
		await expect(watching).rejects.toBe(STOPPED)
		expect(switched).toStrictEqual(['off', 'stop'])
	})

	it('sounds no trill in the intro or the draws while the sound is off', async () => {
		const { ports } = harness(LOCAL, [plan_titled('a')])
		const { switched, typing_sound } = trill_heard()
		const { input } = sound_keys(false)
		const sounding = { ...ports, typing_sound, keys: input, intro_sleep: instant }

		await expect(run_board_live.watch(sounding, 'wargames')).rejects.toBe(STOPPED)
		expect(switched).not.toContain('on')
		expect(switched.at(-1)).toBe('stop')
	})
})
