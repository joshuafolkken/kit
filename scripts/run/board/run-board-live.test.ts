import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import { run_board_frame_fixture } from './run-board-frame-fixture'
import { run_board_header_trace } from './run-board-header-trace'
import type { KeyInput } from './run-board-keys'
import { run_board_labels, type Paint } from './run-board-labels'
import { run_board_live } from './run-board-live'
import { run_board_screen } from './run-board-screen'
import type { TypingSound } from './run-board-sound-typing'
import { run_board_theme_defs, type LiveDefinition } from './run-board-theme-defs'

// joshuafolkken/kit#8145: the live loop enters the alternate screen, hands its leave to the exit
// handler, and leaves the screen once when the redraw stops — however many paths reach the leave.

const { LOCAL, STOPPED, harness, plan_titled } = run_board_fixture
const { THEME_DEFS } = run_board_theme_defs
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
const { WORDS } = run_board_labels
const { attributes_of, cell_at, is_synced_once, lines_of, rule_cells, terminal_of } =
	run_board_frame_fixture
const LEFT_MS = 300

// joshuafolkken/kit#8745: the notice blinks three times and holds lit in the theme's look.
function notice_of(lit: Paint, is_rain: boolean): Pick<LiveDefinition, 'notice_trace' | 'notice'> {
	return { notice_trace: true, notice: { lit, is_rain } }
}

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
			...notice_of(THEME_DEFS.wargames.paint, false),
		})
	})

	// joshuafolkken/kit#8356: the matrix board's rows decode and its lamp panel runs the idle rain.
	// joshuafolkken/kit#8367: a raindrop falls down the whole matrix board in place of the sweep.
	// joshuafolkken/kit#8353: a changed character on the matrix board lands white and cools.
	// joshuafolkken/kit#8657: a new header notice on the matrix board traces in.
	it('reads the decoded rows, the idle rain and the board drop from the matrix definition', () => {
		expect(run_board_live.live_of('matrix')).toStrictEqual({
			...NO_LIVE,
			types_rows: true,
			trill: true,
			decode: true,
			rain: true,
			drop: true,
			flash: true,
			...notice_of(run_board_header_trace.SHADES.bright, true),
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

// joshuafolkken/kit#8683: the bttf board types its notices, operations and rows, with no sound and no
// other live effect.
describe('run_board_live.live_of bttf', () => {
	it('reads only the rows typed from the bttf definition', () => {
		// joshuafolkken/kit#8731: its trill sounds over every typing row.
		// joshuafolkken/kit#8745: its notice blinks three times and holds lit in its body color.
		expect(run_board_live.live_of('bttf')).toStrictEqual({
			...NO_LIVE,
			types_rows: true,
			trill: true,
			...notice_of(THEME_DEFS.bttf.paint, false),
		})
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
