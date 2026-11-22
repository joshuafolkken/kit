import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import type { KeyInput } from './run-board-keys'
import { run_board_labels } from './run-board-labels'
import { run_board_live } from './run-board-live'
import { run_board_screen } from './run-board-screen'
import type { TypingSound } from './run-board-sound-typing'

// joshuafolkken/kit#8145: the live loop enters the alternate screen, hands its leave to the exit
// handler, and leaves the screen once when the redraw stops — however many paths reach the leave.

const { LOCAL, STOPPED, harness, plan_titled } = run_board_fixture
const SCREEN = run_board_screen.screen_of('live')
const NO_LIVE = {
	sweep: false,
	types_rows: false,
	trill: false,
	codes: false,
	strip: false,
	decode: false,
	rain: false,
	drop: false,
}
const ESCAPE = '\u{1B}'
const DIM_RULE = new RegExp(`${ESCAPE}\\[2m─+${ESCAPE}\\[22m`, 'u')
const REFRESH_START = `${ESCAPE}[?2026h${ESCAPE}[H${ESCAPE}[K`
const DIM_HEADING_START = `\n${ESCAPE}[K${ESCAPE}[2m──${ESCAPE}[22m `
const { WORDS } = run_board_labels
// The keeps-running line and the line after it or before it (the keys, or the blank) end every frame.
const FOOTER_LINES = 2
const LEFT_MS = 300

afterEach(() => {
	vi.unstubAllEnvs()
})

// joshuafolkken/kit#8360: the live effects are the theme definition's, not whether a theme is given.
describe('run_board_live.live_of', () => {
	it('reads the rows typed, the trill and the rules code from the wargames definition', () => {
		expect(run_board_live.live_of('wargames')).toStrictEqual({
			...NO_LIVE,
			sweep: true,
			types_rows: true,
			trill: true,
			codes: true,
		})
	})

	// joshuafolkken/kit#8356: the matrix board's rows decode and its lamp panel runs the idle rain.
	// joshuafolkken/kit#8367: a raindrop falls down the whole matrix board in place of the sweep.
	// joshuafolkken/kit#8353: a changed character on the matrix board lands white and cools.
	it('reads the decoded rows, the idle rain and the board drop from the matrix definition', () => {
		expect(run_board_live.live_of('matrix')).toStrictEqual({
			...NO_LIVE,
			types_rows: true,
			trill: true,
			decode: true,
			rain: true,
			drop: true,
			flash: true,
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

// joshuafolkken/kit#8510: the footer under the legend is drawn at full brightness.
describe('run_board_live.watch footer', () => {
	it('draws the footer lines with no dim escape on every redraw', async () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const { ports, frames } = harness(LOCAL, [plan_titled('a')])

		await expect(run_board_live.watch(ports, undefined)).rejects.toBe(STOPPED)
		const drawn = frames.filter((frame) => frame.startsWith(REFRESH_START))
		const footers = drawn.flatMap((frame) => frame.split('\n').slice(-FOOTER_LINES))

		expect(drawn.length).toBeGreaterThan(0)
		expect(footers.some((line) => line.includes(WORDS.keeps_running))).toBe(true)
		expect(footers.join('\n')).not.toContain(`${ESCAPE}[2m`)
	})
})

// joshuafolkken/kit#8381: a tick that throws never ends the board; the failure is told and drawn.
const REASON = 'snapshot half written'

// The harness's ports with the drawn frame's write throwing once, on the `failing`th frame.
function failing_on(failing: number): ReturnType<typeof harness> {
	const board = harness(LOCAL, [plan_titled('a')])
	const { write } = board.ports
	let drawn = 0

	return {
		...board,
		ports: {
			...board.ports,
			write: (text) => {
				if (text.startsWith(REFRESH_START)) drawn += 1

				if (drawn === failing && text.startsWith(REFRESH_START)) {
					throw new Error(`${REASON}\nat somewhere`)
				}

				write(text)
			},
		},
	}
}

function drawn_of(frames: ReadonlyArray<string>): Array<string> {
	return frames.filter((frame) => frame.startsWith(REFRESH_START))
}

describe('run_board_live.watch failed tick', () => {
	it('tells the failure and draws the last frame again with it said, its first line only', async () => {
		const { ports, frames } = failing_on(1)
		const failed = vi.fn<(cause: unknown) => void>()

		await expect(run_board_live.watch(ports, undefined, failed)).rejects.toBe(STOPPED)
		const [warning] = drawn_of(frames)

		expect(failed).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ message: expect.stringContaining(REASON) }),
		)
		expect(warning).toContain(`redraw`)
		expect(warning).toContain(REASON)
		expect(warning).not.toContain('at somewhere')
	})

	it('goes on to the next tick, which draws without the failure', async () => {
		const { ports, frames } = failing_on(1)

		await expect(run_board_live.watch(ports, undefined, vi.fn())).rejects.toBe(STOPPED)
		const drawn = drawn_of(frames)

		expect(drawn.length).toBeGreaterThan(1)
		expect(drawn.at(-1)).not.toContain(REASON)
		expect(drawn.at(-1)?.split('\n')).toHaveLength(drawn[0]?.split('\n').length ?? 0)
	})
})

// joshuafolkken/kit#8250: the trill reaches the draws only in a theme, and the board stops it as it
// leaves.
// The trill's switches, and the letters' ends each `on` was handed (joshuafolkken/kit#8523).
function trill_heard(): {
	switched: Array<string>
	ends: Array<number | undefined>
	typing_sound: TypingSound
} {
	const switched: Array<string> = []
	const ends: Array<number | undefined> = []

	return {
		switched,
		ends,
		typing_sound: {
			set: (is_on, left_ms) => {
				switched.push(is_on ? 'on' : 'off')
				if (is_on) ends.push(left_ms)
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

	it('hands the draws’ letters end through to the trill', () => {
		const { ports } = harness(LOCAL, [])
		const { ends, typing_sound } = trill_heard()
		const live = run_board_live.live_of('wargames')
		const trill = run_board_live.trill_of({ ...ports, typing_sound }, { folded: undefined }, live)

		trill?.set(true, LEFT_MS)
		expect(ends).toStrictEqual([LEFT_MS])
	})

	it('stops the trill once however many paths reach the leave', async () => {
		const { ports, leaves } = harness(undefined, [])
		const { switched, typing_sound } = trill_heard()

		await expect(run_board_live.watch({ ...ports, typing_sound }, undefined)).rejects.toBe(STOPPED)
		leaves[0]?.()
		expect(switched.filter((event) => event === 'stop')).toHaveLength(1)
	})
})

// joshuafolkken/kit#8365: the matrix key click sounds through its intro and its decoding rows.
describe('run_board_live.watch matrix trill', () => {
	it('hands the matrix draws’ letters end through to the trill (ac-57e6668c)', () => {
		const { ports } = harness(LOCAL, [])
		const { ends, typing_sound } = trill_heard()
		const live = run_board_live.live_of('matrix')
		const trill = run_board_live.trill_of({ ...ports, typing_sound }, { folded: undefined }, live)

		trill?.set(true, LEFT_MS)
		expect(ends).toStrictEqual([LEFT_MS])
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

	it('switches the matrix trill off as s switches the sound off (ac-57e6668c)', async () => {
		const { ports } = harness(LOCAL, [plan_titled('a')])
		const { switched, typing_sound } = trill_heard()
		const { input, type } = sound_keys(true)
		const watching = run_board_live.watch({ ...ports, typing_sound, keys: input }, 'matrix')

		type('s')
		await expect(watching).rejects.toBe(STOPPED)
		expect(switched[0]).toBe('off')
		expect(switched).not.toContain('on')
	})

	it.each(['wargames', 'matrix'] as const)(
		'sounds no %s trill while the sound is off',
		async (theme) => {
			const { ports } = harness(LOCAL, [plan_titled('a')])
			const { switched, typing_sound } = trill_heard()
			const { input } = sound_keys(false)
			const sounding = { ...ports, typing_sound, keys: input, intro_sleep: instant }

			await expect(run_board_live.watch(sounding, theme)).rejects.toBe(STOPPED)
			expect(switched).not.toContain('on')
			expect(switched.at(-1)).toBe('stop')
		},
	)
})
