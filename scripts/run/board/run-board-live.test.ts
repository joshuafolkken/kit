import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import type { KeyInput } from './run-board-keys'
import { run_board_live } from './run-board-live'
import { run_board_screen } from './run-board-screen'
import type { TypingSound } from './run-board-sound-typing'

// joshuafolkken/kit#8145: the live loop enters the alternate screen, hands its leave to the exit
// handler, and leaves the screen once when the redraw stops — however many paths reach the leave.

const { LOCAL, STOPPED, harness, plan_titled } = run_board_fixture
const SCREEN = run_board_screen.screen_of('live')
const NO_LIVE = { types_rows: false, trill: false, codes: false, strip: false }
const ESCAPE = '\u{1B}'
const DIM_RULE = new RegExp(`${ESCAPE}\\[2m─+${ESCAPE}\\[22m`, 'u')
const REFRESH_START = `${ESCAPE}[?2026h${ESCAPE}[H${ESCAPE}[K`
const DIM_HEADING_START = `\n${ESCAPE}[K${ESCAPE}[2m──${ESCAPE}[22m `

afterEach(() => {
	vi.unstubAllEnvs()
})

// joshuafolkken/kit#8360: the live effects are the theme definition's, not whether a theme is given.
describe('run_board_live.live_of', () => {
	it('reads the rows typed, the trill and the rules code from the wargames definition', () => {
		expect(run_board_live.live_of('wargames')).toStrictEqual({
			types_rows: true,
			trill: true,
			codes: true,
			strip: false,
		})
	})

	it('chooses no live effect with no theme', () => {
		expect(run_board_live.live_of(undefined)).toStrictEqual(NO_LIVE)
	})

	it('chooses no live effect for a theme the table has no row for', () => {
		expect(run_board_live.live_of('wargames', {})).toStrictEqual(NO_LIVE)
	})

	it('chooses no live effect where the definition turns them off', () => {
		expect(run_board_live.live_of('wargames', { wargames: { live: NO_LIVE } })).toStrictEqual(
			NO_LIVE,
		)
	})
})

describe('run_board_live.watch', () => {
	it('dims default rules once before the screen control bytes on every redraw', async () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const { ports, frames } = harness(LOCAL, [plan_titled('a')])

		await expect(run_board_live.watch(ports, undefined)).rejects.toBe(STOPPED)
		const drawn = frames.filter((frame) => frame.startsWith(REFRESH_START))

		expect(drawn.length).toBeGreaterThan(0)

		for (const frame of drawn) {
			expect(frame.endsWith(`${ESCAPE}[?2026l`)).toBe(true)
			expect(frame).toContain(DIM_HEADING_START)
			expect(frame).toMatch(DIM_RULE)
			expect(frame).not.toContain(`${ESCAPE}[2m${ESCAPE}[2m`)
		}
	})

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
