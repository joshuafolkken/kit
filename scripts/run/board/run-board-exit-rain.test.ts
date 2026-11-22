import { stripVTControlCharacters } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_exit_rain } from './run-board-exit-rain'
import { run_board_fixture } from './run-board-fixture'
import type { IntroPorts } from './run-board-intro'
import type { KeyInput, KeyReading } from './run-board-keys'
import { run_board_live } from './run-board-live'
import { run_board_reveal_rain_fixture } from './run-board-reveal-rain-fixture'
import { run_board_screen } from './run-board-screen'
import type { Theme } from './run-board-theme'

// joshuafolkken/kit#8355: the matrix board wiped by the rain as Ctrl-C closes it — the cells the rain
// has passed blank, the screen erased before it is left, a key leaving at once, and a signal leaving
// without the wipe.

const { beats_of, gated, wipe } = run_board_exit_rain
const { harness, plan_titled } = run_board_fixture
const { drawn_rows } = run_board_reveal_rain_fixture
const SCREEN = run_board_screen.screen_of('live')
const ESC = '\u{1B}'
const CLEARED = `${ESC}[H${ESC}[J`
const CTRL_C = '\u{3}'
const HALF = 0.5
const FRAME = 'ONE\nTWO'
const RAIN = { random: (): number => HALF, is_colored: (): boolean => true }
const FULL_COLOR = '3'
// The keys line ends every frame drawn whole.
const KEYS_LINE = /ctrl-c: quit$/iu

type Sleep = (ms: number) => Promise<void>

async function instant(): Promise<void> {
	await Promise.resolve()
}

async function never(): Promise<void> {
	await new Promise<void>(() => undefined)
}

function released(): void {
	// The key goes back to folding; nothing to undo here.
}

// Keys whose next press the wipe intercepts, pressed by the test.
function skippable(): { keys: KeyReading; press: () => void } {
	const taker = { on_key: released }

	return {
		keys: {
			folded: undefined,
			intercept: (on_key) => {
				taker.on_key = on_key

				return released
			},
		},
		press: () => {
			taker.on_key()
		},
	}
}

// Ports that record each write, pausing with `intro_sleep`, their rain pinned.
function recorded(intro_sleep: Sleep): { written: Array<string>; ports: IntroPorts } {
	const written: Array<string> = []

	return {
		written,
		ports: {
			write: (text) => {
				written.push(text)
			},
			intro_sleep,
			rain: RAIN,
		},
	}
}

// A keyboard whose keys a test types, Ctrl-C told to `interrupt`.
function keyboard(interrupt: () => void): { input: KeyInput; type: (chunk: string) => void } {
	const listener = { on_data: (_chunk: string): void => undefined }

	return {
		input: {
			is_tty: true,
			raw: () => undefined,
			listen: (on_data) => {
				listener.on_data = on_data
			},
			close: () => undefined,
			interrupt,
		},
		type: (chunk) => {
			listener.on_data(chunk)
		},
	}
}

// A live board whose redraws stop after the first frame, its pauses `pace.sleep`, and whose Ctrl-C
// quits the way the process exit does: `interrupts` counts it, then the exit handler leaves.
function live_board(theme: Theme): {
	frames: Array<string>
	leaves: Array<() => void>
	pace: { sleep: Sleep }
	interrupts: Array<number>
	type: (chunk: string) => void
} {
	const board = harness(undefined, [plan_titled('Matrix')])
	const pace = { sleep: instant as Sleep }
	const interrupts: Array<number> = []
	const { input, type } = keyboard(() => {
		interrupts.push(board.frames.length)
		board.leaves[0]?.()
	})
	const ports = {
		...board.ports,
		keys: input,
		sleep: never,
		intro_sleep: async (ms: number) => {
			await pace.sleep(ms)
		},
	}

	void run_board_live.watch(ports, theme)

	return { frames: board.frames, leaves: board.leaves, pace, interrupts, type }
}

// Waits until the first frame is drawn whole, its redraws then held by the never-ending sleep.
async function opened(frames: ReadonlyArray<string>): Promise<number> {
	await vi.waitFor(() => {
		expect(stripVTControlCharacters(frames.at(-1) ?? '')).toMatch(KEYS_LINE)
	})

	return frames.length
}

describe('run_board_exit_rain.beats_of — the rain takes the frame away', () => {
	it('shows the frame where the rain has not reached it', () => {
		const [first = { text: '' }] = beats_of(FRAME, RAIN.random)

		expect(drawn_rows(first.text)).toEqual(['ONE', 'TWO'])
	})

	it('blanks the cells the rain has passed and erases the screen last', () => {
		const beats = [...beats_of(FRAME, RAIN.random)]
		const last_pass = beats.at(-2)?.text ?? ''

		expect(drawn_rows(last_pass)[0]?.trim()).toBe('')
		expect(beats.at(-1)?.text).toBe(CLEARED)
	})

	it('wipes every row and column of the terminal, a line wider than it wrapped', () => {
		const size = { columns: 4, rows: 5 }
		const texts = [...beats_of(`${FRAME}\n12345`, RAIN.random, size)].map((beat) => beat.text)
		const rows = texts.slice(0, -1).map((text) => drawn_rows(text))

		expect(drawn_rows(texts[0] ?? '')).toEqual(['ONE ', 'TWO ', '1234', '5   ', ' '.repeat(4)])
		expect(rows.every((drawn) => drawn.length === size.rows)).toBe(true)
		expect(rows.flat().every((row) => row.length === size.columns)).toBe(true)
	})
})

describe('run_board_exit_rain.wipe — what plays and what ends it', () => {
	it('plays nothing outside a rain theme', async () => {
		const { written, ports } = recorded(instant)

		await wipe(FRAME, ports, { folded: undefined }, 'wargames')
		expect(written).toEqual([])
	})

	it('ends at once when a key is pressed during the rain', async () => {
		const { keys, press } = skippable()
		const { written, ports } = recorded(never)
		const wiped = wipe(FRAME, ports, keys, 'matrix')

		press()
		await expect(wiped).resolves.toBeUndefined()
		expect(written).toHaveLength(1)
	})
})

describe('run_board_exit_rain.exit_of — the exit before the live board sets its wipe', () => {
	it('opens its gate and wipes nothing', async () => {
		const exit = run_board_exit_rain.exit_of()

		await expect(exit.wipe()).resolves.toBeUndefined()
		expect(exit.gate.is_open).toBe(true)
	})
})

describe('run_board_exit_rain.gated — the board silenced once the wipe begins', () => {
	it('keeps the typing trill off once the gate shuts', () => {
		const heard: Array<boolean> = []
		const { ports } = harness(undefined, [plan_titled('Matrix')])
		const typing_sound = {
			set: (is_on: boolean) => {
				heard.push(is_on)
			},
			stop: () => undefined,
		}

		gated({ ...ports, typing_sound }, { is_open: false }).typing_sound?.set(true)
		expect(heard).toEqual([false])
	})
})

describe('run_board_live.watch — Ctrl-C wipes the matrix board before it leaves', () => {
	beforeEach(() => {
		vi.stubEnv('FORCE_COLOR', FULL_COLOR)
	})

	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('leaves the screen only after the rain has erased every cell', async () => {
		const { frames, interrupts, type } = live_board('matrix')
		const before = await opened(frames)

		type(CTRL_C)
		await vi.waitFor(() => {
			expect(interrupts).toHaveLength(1)
		})
		expect(frames.length - before).toBeGreaterThan(2)
		expect(frames.at(-2)).toContain(CLEARED)
		expect(frames.at(-1)).toContain(SCREEN.leave)
	})

	it('leaves the wargames board at once, with no rain', async () => {
		const { frames, interrupts, type } = live_board('wargames')
		const before = await opened(frames)

		type(CTRL_C)
		await vi.waitFor(() => {
			expect(interrupts).toEqual([before])
		})
		expect(frames.slice(before)).toHaveLength(1)
		expect(frames.at(-1)).toContain(SCREEN.leave)
	})
})

describe('run_board_live.watch — what ends the matrix wipe early', () => {
	beforeEach(() => {
		vi.stubEnv('FORCE_COLOR', FULL_COLOR)
	})

	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('leaves at once when a key is pressed during the rain', async () => {
		const { frames, pace, interrupts, type } = live_board('matrix')

		await opened(frames)
		pace.sleep = never
		type(CTRL_C)
		type('x')
		await vi.waitFor(() => {
			expect(interrupts).toHaveLength(1)
		})
		expect(frames.at(-1)).toContain(SCREEN.leave)
	})

	it('leaves at once when Ctrl-C is pressed again during the rain', async () => {
		const { frames, pace, interrupts, type } = live_board('matrix')

		await opened(frames)
		pace.sleep = never
		type(CTRL_C)
		type(CTRL_C)
		await vi.waitFor(() => {
			expect(interrupts).toHaveLength(1)
		})
		expect(frames.at(-1)).toContain(SCREEN.leave)
	})
})

describe('run_board_live.watch — a signal during the matrix wipe', () => {
	beforeEach(() => {
		vi.stubEnv('FORCE_COLOR', FULL_COLOR)
	})

	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('puts the terminal back at once when a signal exits during the rain', async () => {
		const { frames, leaves, pace, interrupts, type } = live_board('matrix')

		await opened(frames)
		pace.sleep = never
		type(CTRL_C)
		leaves[0]?.()
		expect(frames.at(-1)).toContain(SCREEN.leave)
		expect(interrupts).toEqual([])
	})
})
