import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it, vi, type Mock } from 'vitest'
import type { KeyInput, KeyReading, KeyTaker } from './run-board-keys'
import { run_board_repaint } from './run-board-repaint'
import { run_board_theme_keys, type KeyHolder, type ThemeKeyPorts } from './run-board-theme-keys'
import { run_board_theme_layer } from './run-board-theme-layer'
import { run_board_theme_layer_fixture } from './run-board-theme-layer-fixture'
import { run_board_theme_run, type ThemeRun, type ThemeValue } from './run-board-theme-run'

const { claim_of, ending_input, save_theme, skip_opening } = run_board_theme_keys
const { VIEW, base_canvas, ticking_run } = run_board_theme_layer_fixture
const NOW_MS = 20_000

// Keys whose taker the test presses, and how often a taker was released.
interface Pressed {
	holder: KeyHolder
	press: (chunk: string) => void
	released: () => number
}

function pressed(): Pressed {
	const held: { taker: KeyTaker | undefined; releases: number } = { taker: undefined, releases: 0 }
	const keys: KeyReading = {
		folded: undefined,
		intercept: (on_key) => {
			held.taker = on_key

			return () => {
				held.releases += 1
				if (held.taker === on_key) held.taker = undefined
			}
		},
	}

	return {
		holder: { keys },
		press: (chunk) => held.taker?.(chunk),
		released: () => held.releases,
	}
}

// A run past its opening whose theme was built over the fixture's base, so its parts have lengths.
function built_run(): ThemeRun {
	const run = ticking_run(0)

	run_board_theme_layer.theme_layer(run, VIEW).draw(base_canvas(), NOW_MS)

	return run
}

// A pause that never ends: the ending plays until a key ends it.
async function endless(): Promise<void> {
	await new Promise(() => undefined)
}

function key_ports(
	saves: Array<ThemeValue>,
	sleep: ThemeKeyPorts['sleep'] = endless,
): ThemeKeyPorts {
	return {
		now: () => NOW_MS,
		sleep,
		save: (value) => {
			saves.push(value)
		},
	}
}

function input_of(): KeyInput & { interrupt: Mock<() => void> } {
	return {
		is_tty: true,
		raw: vi.fn(),
		listen: vi.fn(),
		close: vi.fn(),
		interrupt: vi.fn<() => void>(),
	}
}

// A run in demo mode's reach, its keys, and the board's claim on them.
function demo(saves: Array<ThemeValue>): {
	run: ThemeRun
	keys: Pressed
	claim: (chunk: string) => boolean
} {
	const run = built_run()
	const keys = pressed()

	return { run, keys, claim: claim_of(run, keys.holder, key_ports(saves)) }
}

const temporary = temporary_directory()

function environment_file(content: string | undefined): string {
	const file = path.join(temporary('theme-env-'), '.env')

	if (content !== undefined) writeFileSync(file, content)

	return file
}

describe('run_board_theme_keys.skip_opening', () => {
	it('ends the opening on any key and gives the keys back', () => {
		const run = built_run()
		const keys = pressed()

		run.part = { name: 'opening', start_ms: NOW_MS }
		skip_opening(run, keys.holder)
		keys.press('x')

		expect(run.part).toBeUndefined()
		expect(keys.released()).toBe(1)
	})
})

describe('run_board_theme_keys.ending_input', () => {
	it('plays the ending on the first Ctrl-C and leaves on any key during it', () => {
		const run = built_run()
		const keys = pressed()
		const input = input_of()
		const quitting = ending_input(input, run, keys.holder, key_ports([]))

		quitting?.interrupt()

		expect(run.part?.name).toBe('ending')
		expect(input.interrupt).not.toHaveBeenCalled()
		keys.press('t')
		keys.press('u')
		expect(input.interrupt).toHaveBeenCalledTimes(1)
	})

	it('leaves at once on a second Ctrl-C', () => {
		const run = built_run()
		const input = input_of()
		const quitting = ending_input(input, run, pressed().holder, key_ports([]))

		quitting?.interrupt()
		quitting?.interrupt()

		expect(input.interrupt).toHaveBeenCalledTimes(1)
	})

	it('leaves once the ending has played through', async () => {
		const run = built_run()
		const input = input_of()
		const sleep = vi.fn(async () => undefined)
		const quitting = ending_input(input, run, pressed().holder, key_ports([], sleep))

		quitting?.interrupt()
		await vi.waitFor(() => {
			expect(input.interrupt).toHaveBeenCalledTimes(1)
		})
		expect(sleep).toHaveBeenCalledWith(expect.any(Number))
	})
})

// A board shrunk below its lamp panel draws no theme frame: Ctrl-C has no ending to play on it.
describe('run_board_theme_keys.ending_input with no theme frame', () => {
	it('leaves at once where a second since drew no theme frame', () => {
		const run = built_run()
		const input = input_of()
		const quitting = ending_input(input, run, pressed().holder, key_ports([]))

		run_board_theme_run.settle(run, false)
		quitting?.interrupt()

		expect(run.part).toBeUndefined()
		expect(input.interrupt).toHaveBeenCalledTimes(1)
	})

	// joshuafolkken/kit#8917: a board with its lamp panel off screen keeps its theme, so its ending plays.
	it('plays the ending where the lamp panel is off screen, the theme kept', () => {
		const run = built_run()
		const input = input_of()
		const quitting = ending_input(input, run, pressed().holder, key_ports([]))

		run_board_theme_layer.theme_layer(run, { ...VIEW, lamps: [] }).draw(base_canvas(), NOW_MS)
		quitting?.interrupt()

		expect(run.part?.name).toBe('ending')
		expect(input.interrupt).not.toHaveBeenCalled()
	})
})

describe('run_board_theme_keys.claim_of', () => {
	it('leaves every key but the demo key to the folds', () => {
		const { run, claim } = demo([])

		expect(claim('t')).toBe(false)
		expect(run.demo).toBeUndefined()
	})

	it('enters demo mode on its key, on the theme idle board', () => {
		const { run, claim } = demo([])

		run.part = { name: 'ending', start_ms: 0 }

		expect(claim('/')).toBe(true)
		expect(run.demo?.entered).toBe('wopr')
		expect(run.part).toBeUndefined()
	})

	it('routes the demo keys: works, events and parts, and takes the folds and the sound switch', () => {
		const { run, keys, claim } = demo([])

		claim('/')
		keys.press('3')
		expect(run.value).toBe('flux')
		keys.press('w')
		expect(run.demo?.timeline.notice).toHaveLength(1)
		keys.press('q')
		expect(run.part?.name).toBe('opening')
		keys.press('ts')
		expect(run.value).toBe('flux')
	})
})

// joshuafolkken/kit#8969: the footer names what a key picked on the frame it starts on.
describe('run_board_theme_keys.claim_of redrawing demo mode', () => {
	it('asks a redraw at once for every demo key, a work or what plays alike', () => {
		const { run, keys, claim } = demo([])

		claim('/')
		const stale = ['3', 's', 'a', 'd', 'w', 'q', 'e'].map((key) => {
			const is_current = run_board_repaint.current_of(run.repaint)

			keys.press(key)

			return is_current?.()
		})

		expect(stale).toStrictEqual(Array.from({ length: stale.length }, () => false))
	})

	it('plays a PROGRESS once and a part through once', () => {
		const { run, keys, claim } = demo([])

		claim('/')
		keys.press('a')
		expect(run.demo?.timeline.progress).toHaveLength(1)
		keys.press('e')

		expect(run.part).toEqual({ name: 'ending', start_ms: NOW_MS, is_once: true })
	})
})

describe('run_board_theme_keys.claim_of leaving demo mode', () => {
	it('saves the theme switched to as it leaves, an empty value for none', () => {
		const saves: Array<ThemeValue> = []
		const { keys, claim } = demo(saves)

		claim('/')
		keys.press('0')
		keys.press('/')

		expect(saves).toEqual([''])
	})

	it('saves nothing when it leaves without a switch', () => {
		const saves: Array<ThemeValue> = []
		const { run, keys, claim } = demo(saves)

		claim('/')
		keys.press('a/')

		expect(saves).toEqual([])
		expect(run.demo).toBeUndefined()
	})
})

describe('run_board_theme_keys.save_theme', () => {
	it('replaces the theme line, touching no other line', () => {
		const file = environment_file('A=1\nJOSH_BOARD_THEME=wargames\n# note\nB=2\n')

		save_theme('magi', file)

		expect(readFileSync(file, 'utf8')).toBe('A=1\nJOSH_BOARD_THEME=magi\n# note\nB=2\n')
	})

	it('adds the theme line where the file has none, or no file is there', () => {
		const file = environment_file('A=1\n')

		save_theme('codec', file)

		expect(readFileSync(file, 'utf8')).toBe('A=1\nJOSH_BOARD_THEME=codec\n')

		const fresh = environment_file(undefined)

		save_theme('', fresh)

		expect(readFileSync(fresh, 'utf8')).toBe('JOSH_BOARD_THEME=\n')
	})
})
