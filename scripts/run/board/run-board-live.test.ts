import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import { run_board_frame_fixture } from './run-board-frame-fixture'
import type { KeyInput } from './run-board-keys'
import { run_board_labels } from './run-board-labels'
import { run_board_live } from './run-board-live'
import { run_board_paint } from './run-board-paint'
import { run_board_screen } from './run-board-screen'
import { run_board_sound_quiet } from './run-board-sound-quiet-fixture'
import type { TypingSound } from './run-board-sound-typing'
import type { Theme } from './run-board-theme'

// joshuafolkken/kit#8145: the live loop enters the alternate screen, hands its leave to the exit
// handler, and leaves the screen once when the redraw stops — however many paths reach the leave.

const { LOCAL, STOPPED, harness, plan_titled } = run_board_fixture
const SCREEN = run_board_screen.screen_of('live')
const ESCAPE = '\u{1B}'
const { WORDS } = run_board_labels
const { attributes_of, cell_at, is_synced_once, lines_of, rule_cells, terminal_of } =
	run_board_frame_fixture
const LEFT_MS = 300
// joshuafolkken/kit#8917: a theme is drawn by its run only in 24-bit color.
const RGB = { color_depth: () => run_board_paint.RGB_COLOR_DEPTH }

run_board_sound_quiet.each()
afterEach(() => {
	vi.unstubAllEnvs()
})

// joshuafolkken/kit#9027: a leave queued behind a frame's tail is dropped by `process.exit`.
describe('run_board_live.watch settles', () => {
	it('settles its writes once, before it writes the leave', async () => {
		const { ports, frames, leaves } = harness(undefined, [])
		const settled_at: Array<number> = []

		ports.settle = () => {
			settled_at.push(frames.length)
		}

		await expect(run_board_live.watch(ports, undefined)).rejects.toBe(STOPPED)
		leaves[0]?.()
		expect(settled_at).toHaveLength(1)
		expect(frames.indexOf(SCREEN.leave)).toBeGreaterThanOrEqual(settled_at[0] ?? NaN)
	})
})

describe('run_board_live.watch', () => {
	// joshuafolkken/kit#8826: a redraw is the base the frame loop paints, so the rules are read off the
	// screen its writes leave.
	it('dims default rules once, in a synchronized write, on the screen a redraw draws', async () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const { ports, frames } = harness(LOCAL, [plan_titled('a')])

		await expect(run_board_live.watch(ports, undefined)).rejects.toBe(STOPPED)
		const drawn = frames.slice(1, -1)
		const rules = rule_cells(terminal_of(frames))

		expect(drawn.length).toBeGreaterThan(0)
		expect(drawn.every((frame) => is_synced_once(frame))).toBe(true)
		expect(rules.length).toBeGreaterThan(0)
		expect(rules.every(({ sgr }) => attributes_of(sgr).is_dim)).toBe(true)
		expect(rules.filter(({ sgr }) => sgr.includes(`${ESCAPE}[2m${ESCAPE}[2m`))).toStrictEqual([])
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
	it('draws the footer lines with no dim on the screen a redraw draws', async () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const { ports, frames } = harness(LOCAL, [plan_titled('a')])

		await expect(run_board_live.watch(ports, undefined)).rejects.toBe(STOPPED)
		const screen = terminal_of(frames)
		const lines = lines_of(screen)
		const footer_row = lines.findIndex((line) => line.includes(WORDS.keeps_running)) + 1
		const footer = Array.from({ length: screen.columns }, (_, index) =>
			cell_at(screen, footer_row, index + 1),
		)

		expect(footer_row).toBe(lines.length)
		expect(footer.some(({ sgr }) => attributes_of(sgr).is_dim)).toBe(false)
	})
})

// joshuafolkken/kit#8381: a tick that throws never ends the board; the failure is told and drawn.
const REASON = 'snapshot half written'

// The redraws a test waits for: the first, the failing one whose warning is drawn, and the one after it.
const REDRAWS_THROUGH = 3

// The harness's ports with the second redraw's tick throwing once, as it lays the frame out, and every
// wait let through with the clock moved until the third redraw is drawn; the screen as each redraw
// began, read off the writes made before it.
function failing_second(): ReturnType<typeof harness> & { begun: Array<Array<string>> } {
	const board = harness(LOCAL, [plan_titled('a')])
	const { link, sleep } = board.ports
	const failing = { has_failed: false }
	const begun: Array<Array<string>> = []

	return {
		...board,
		begun,
		ports: {
			...board.ports,
			enter_stage: (stage) => {
				if (stage === 'redraw') begun.push(lines_of(terminal_of(board.frames)))
			},
			link: (text, url) => {
				if (failing.has_failed || begun.length !== 2) return link(text, url)
				failing.has_failed = true
				throw new Error(`${REASON}\nat somewhere`)
			},
			sleep: async (ms) => {
				board.clock.now_ms += ms
				if (begun.length >= REDRAWS_THROUGH) await sleep(ms)
			},
		},
	}
}

// The lanes rule of a screen, whose tallies a theme words as its own.
function lanes_of(lines: ReadonlyArray<string>): string | undefined {
	return lines.find((line) => / lanes /iu.test(line))
}

describe('run_board_live.watch failed tick', () => {
	it('tells the failure and draws the last frame again with it said, its first line only', async () => {
		const { ports, begun } = failing_second()
		const failed = vi.fn<(cause: unknown) => void>()

		await expect(run_board_live.watch(ports, undefined, failed)).rejects.toBe(STOPPED)
		const warning = (begun[REDRAWS_THROUGH - 1] ?? []).join('\n')

		expect(failed).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ message: expect.stringContaining(REASON) }),
		)
		expect(warning).toContain(`redraw`)
		expect(warning).toContain(REASON)
		expect(warning).not.toContain('at somewhere')
	})

	it('goes on to the next tick, which draws without the failure', async () => {
		const { ports, frames, begun } = failing_second()

		await expect(run_board_live.watch(ports, undefined, vi.fn())).rejects.toBe(STOPPED)
		const [, first] = begun
		const last = lines_of(terminal_of(frames))

		expect(begun).toHaveLength(REDRAWS_THROUGH)
		expect(last.join('\n')).not.toContain(REASON)
		expect(last).toHaveLength(first?.length ?? 0)
	})

	// joshuafolkken/kit#8917: a 24-bit board in no theme has a theme run showing none, so its warning
	// is drawn in the look the second was drawn in, not the run's theme.
	it('draws the warning in no theme on a 24-bit board shown in none', async () => {
		const { ports, begun } = failing_second()

		await expect(run_board_live.watch({ ...ports, ...RGB }, undefined, vi.fn())).rejects.toBe(
			STOPPED,
		)
		const [, first = [], warning = []] = begun

		expect(lanes_of(first)).toBeDefined()
		expect(lanes_of(warning)).toBe(lanes_of(first))
	})
})

// joshuafolkken/kit#8250: the trill reaches the draws only on a themed board, and the board stops it as
// it leaves.
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

		await expect(run_board_live.watch({ ...ports, ...RGB, typing_sound }, 'wopr')).rejects.toBe(
			STOPPED,
		)
		expect(switched.length).toBeGreaterThan(1)
		expect(switched.at(-1)).toBe('stop')
	})

	it('hands the draws’ letters end through to the trill', () => {
		const { ports } = harness(LOCAL, [])
		const { ends, typing_sound } = trill_heard()
		const trill = run_board_live.trill_of(
			{ ...ports, typing_sound },
			{ folded: undefined },
			() => 'wopr',
		)

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

// joshuafolkken/kit#8917: no trill reaches the draws of a board in no theme.
describe('run_board_live.trill_of', () => {
	it('hands no trill to the draws of a board in no theme', () => {
		const { ports } = harness(LOCAL, [])
		const { typing_sound } = trill_heard()

		expect(
			run_board_live.trill_of({ ...ports, typing_sound }, { folded: undefined }, undefined),
		).toBeUndefined()
	})

	// Issue 4-4: demo mode's switch changes the theme shown, and the trill follows it.
	it('sounds the trill in the voice of the theme shown, silent while none is', () => {
		const shown: { theme: Theme | undefined } = { theme: 'wopr' }
		const { switched, typing_sound } = trill_heard()
		const revoice = vi.fn<(file: () => string | undefined) => void>()
		const trill = run_board_live.trill_of(
			{ typing_sound: { ...typing_sound, revoice } },
			{ folded: undefined },
			() => shown.theme,
		)

		for (const theme of ['wopr', 'trace', undefined] as const) {
			shown.theme = theme
			trill?.set(true, LEFT_MS)
		}

		expect(revoice).toHaveBeenCalledOnce()
		expect(switched).toStrictEqual(['on', 'on', 'off'])
	})
})

// Issue 4-4: `/` enters demo mode on a live board launched in no theme too, in 24-bit color, where it
// takes the sound key; without 24-bit color there is no demo mode, and `s` switches the sound.
describe('run_board_live.watch demo mode in no theme', () => {
	it.each([
		['enters demo mode in 24-bit color', RGB, false],
		['has none without it', { color_depth: () => 0 }, true],
	])('%s', async (_name, depth, is_switched) => {
		const { ports } = harness(LOCAL, [plan_titled('a')])
		const { input, type } = sound_keys(true)
		const save_sound = vi.fn()
		const keys = { ...input, store: input.store && { ...input.store, save_sound } }
		const watching = run_board_live.watch({ ...ports, ...depth, keys }, undefined)

		type('/')
		type('s')
		await expect(watching).rejects.toBe(STOPPED)
		expect(save_sound.mock.calls.length > 0).toBe(is_switched)
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

	it('switches the trace trill off as s switches the sound off (ac-57e6668c)', async () => {
		const { ports } = harness(LOCAL, [plan_titled('a')])
		const { switched, typing_sound } = trill_heard()
		const { input, type } = sound_keys(true)
		const watching = run_board_live.watch({ ...ports, ...RGB, typing_sound, keys: input }, 'trace')

		type('s')
		await expect(watching).rejects.toBe(STOPPED)
		expect(switched[0]).toBe('off')
		expect(switched).not.toContain('on')
	})

	it.each(['wopr', 'trace'] as const)(
		'sounds no %s trill while the sound is off',
		async (theme) => {
			const { ports } = harness(LOCAL, [plan_titled('a')])
			const { switched, typing_sound } = trill_heard()
			const { input } = sound_keys(false)
			const sounding = { ...ports, ...RGB, typing_sound, keys: input }

			await expect(run_board_live.watch(sounding, theme)).rejects.toBe(STOPPED)
			expect(switched).not.toContain('on')
			expect(switched.at(-1)).toBe('stop')
		},
	)
})
