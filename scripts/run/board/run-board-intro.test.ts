import { stripVTControlCharacters } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_intro, type IntroPorts } from './run-board-intro'
import { run_board_intro_fixture } from './run-board-intro-fixture'
import { run_board_jump_screen } from './run-board-jump-screen'
import { run_board_label_pair } from './run-board-label-pair'
import { run_board_screen } from './run-board-screen'
import { run_board_theme } from './run-board-theme'
import { run_board_theme_defs } from './run-board-theme-defs'
import { run_board_typing } from './run-board-typing'

// joshuafolkken/kit#7927: a live board types its line a letter at a time and holds it before the first
// frame, which a key skips; the first read runs meanwhile and is handed over only once the line is done.

const { REVEAL_LINE_MS, after, play, reveal } = run_board_intro
const { NO_KEYS, READ, deferred, instant, line_of, never, read_at_once, recorded, skippable } =
	run_board_intro_fixture
const THEME = 'wargames'
const {
	line: LINE,
	letter_ms: LETTER_MS,
	hold_ms: HOLD_MS,
} = run_board_theme_defs.THEME_DEFS[THEME].intro
const { CURSOR } = run_board_typing
const { TITLE_MARK, untitled } = run_board_label_pair

function recording(written: Array<string>): IntroPorts {
	return {
		intro_sleep: instant,
		write: (text) => {
			written.push(text)
		},
	}
}

async function settled_flag(read: Promise<string>, flag: { is_done: boolean }): Promise<string> {
	const value = await read

	flag.is_done = true

	return value
}

async function caught_flag(read: Promise<string>, flag: { is_done: boolean }): Promise<unknown> {
	try {
		await read
	} catch (error: unknown) {
		flag.is_done = true

		return error
	}

	return undefined
}

describe('run_board_intro.play', () => {
	it('types the line a letter at a time, pausing after each, then holds it', async () => {
		const slept: Array<number> = []
		const { written, ports } = recorded(async (ms) => {
			slept.push(ms)
		})

		await play(ports, NO_KEYS, THEME)
		expect(written).toHaveLength(LINE.length + 1)
		expect(slept).toStrictEqual([...Array.from(LINE, () => LETTER_MS), HOLD_MS])
	})

	it('types nothing where the ports carry no pauses', async () => {
		const { written, ports } = recorded(never)

		await play({ write: ports.write }, NO_KEYS, THEME)
		expect(written).toStrictEqual([])
	})

	it('stops typing at a key, cutting the pause short, and gives the keys back', async () => {
		const { keys, press, released } = skippable()
		const { written, ports } = recorded(never)
		const pending = play(ports, keys, THEME)

		press()
		await pending
		expect(written).toStrictEqual([line_of(`${LINE.slice(0, 1)}${CURSOR}`)])
		expect(released()).toBe(true)
	})
})

// joshuafolkken/kit#8000: each beat rewrites the line with a block cursor after the letters typed so far;
// the last letter drops it, and the hold shows none.
describe('run_board_intro.play cursor', () => {
	it('rewrites the line with a cursor after each letter, and drops it on the last letter', async () => {
		const { written, ports } = recorded(instant)

		await play(ports, NO_KEYS, THEME)
		const typing = Array.from(LINE.slice(0, -1), (_letter, index) =>
			line_of(`${LINE.slice(0, index + 1)}${CURSOR}`),
		)

		expect(written.slice(0, LINE.length)).toStrictEqual([...typing, line_of(LINE)])
	})

	it('shows no cursor while it holds the line', async () => {
		const { written, ports } = recorded(instant)

		await play(ports, NO_KEYS, THEME)
		expect(written.at(-1)).toBe('')
		expect(written.at(-2)?.includes(CURSOR)).toBe(false)
	})
})

// joshuafolkken/kit#8006, joshuafolkken/kit#8224: the first frame, as the theme draws it, is written
// from the top a line at a time and each line a block at a time, the line's beat shared out between
// its blocks; a key writes the rest at once, and ports without pauses get the frame whole. The frame
// here is drawn in no color, already in capitals, so the theme leaves its text as it is.
const FRAME = `ONE  TWO\n\nA ${TITLE_MARK}TITLE  B  C`
const SHOWN = untitled(FRAME)

beforeEach(() => {
	vi.stubEnv('FORCE_COLOR', '0')
})

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_board_intro.reveal', () => {
	it('writes the frame a block at a time from the top, a line in 75 ms', async () => {
		const slept: Array<number> = []
		const { written, ports } = recorded(async (ms) => {
			slept.push(ms)
		})
		const quarter = REVEAL_LINE_MS / 4

		await reveal(FRAME, ports, NO_KEYS, THEME)
		expect(written).toStrictEqual(['ONE', '  TWO', '\n', '\nA', ' TITLE', '  B', '  C'])
		expect(slept).toStrictEqual([37.5, 37.5, REVEAL_LINE_MS, quarter, quarter, quarter, quarter])
		expect(REVEAL_LINE_MS).toBe(75)
	})

	it('writes the blocks left at once on a key, and gives the keys back', async () => {
		const { keys, press, released } = skippable()
		const { written, ports } = recorded(never)
		const pending = reveal(FRAME, ports, keys, THEME)

		press()
		await pending
		expect(written).toStrictEqual(['ONE', '  TWO\n\nA TITLE  B  C'])
		expect(written.join('')).toBe(SHOWN)
		expect(released()).toBe(true)
	})

	it('writes the frame whole, unmarked, where the ports carry no pauses', async () => {
		const { written, ports } = recorded(never)

		await reveal(FRAME, { write: ports.write }, NO_KEYS, THEME)
		expect(written).toStrictEqual([SHOWN])
	})

	it('draws the frame in the theme and writes it past the theme where the ports can', async () => {
		const write_drawn = vi.fn<(text: string) => void>()
		const { written, ports } = recorded(instant)

		await reveal('one', { ...ports, write_drawn }, NO_KEYS, THEME)
		expect(write_drawn.mock.calls).toStrictEqual([['ONE']])
		expect(written).toStrictEqual([])
	})
})

describe('run_board_intro.reveal in its icons', () => {
	it('draws the frame in the icons the ports ask for (#8505)', async () => {
		const { written, ports } = recorded(never)

		await reveal('🔄', { write: ports.write, icons: 'letters' }, NO_KEYS, THEME)
		expect(stripVTControlCharacters(written.join(''))).toBe('RN')
	})
})

describe('run_board_intro.after', () => {
	it('holds the first read until the intro is over, then hands it over', async () => {
		const intro = deferred<undefined>()
		const flag = { is_done: false }
		const first = settled_flag(after(async () => READ, intro.promise)('background'), flag)

		await Promise.resolve()
		await Promise.resolve()
		expect(flag.is_done).toBe(false)
		intro.resolve(undefined)
		await expect(first).resolves.toBe(READ)
	})

	it('starts the first read at once and waits on it too when the intro ends first', async () => {
		const read = deferred<string>()
		const paces: Array<string> = []
		const first = after(async (pace) => {
			paces.push(pace)

			return await read.promise
		}, Promise.resolve())('background')

		expect(paces).toStrictEqual(['background'])
		read.resolve(READ)
		await expect(first).resolves.toBe(READ)
	})

	it('reads every later frame without waiting on the intro', async () => {
		const intro = deferred<undefined>()
		const gather = after(async () => READ, intro.promise)
		const first = gather('background')

		await expect(gather('settled')).resolves.toBe(READ)
		intro.resolve(undefined)
		await expect(first).resolves.toBe(READ)
	})
})

describe('run_board_intro.after on a failed first read', () => {
	it('throws it only once the intro is over', async () => {
		const intro = deferred<undefined>()
		const failure = new Error(READ)
		const flag = { is_done: false }
		const first = caught_flag(
			after(async () => {
				throw failure
			}, intro.promise)('background'),
			flag,
		)

		await Promise.resolve()
		await Promise.resolve()
		expect(flag.is_done).toBe(false)
		intro.resolve(undefined)
		await expect(first).resolves.toBe(failure)
	})
})

// joshuafolkken/kit#8029: the opening is the theme's — a board in none reads at once and reveals nothing.

describe('run_board_intro.opening', () => {
	it('plays nothing and hands the read back as it is with no theme', async () => {
		const written: Array<string> = []
		const opened = run_board_intro.opening(read_at_once, recording(written), NO_KEYS, undefined)

		expect(opened.gather).toBe(read_at_once)
		expect(opened.reveal).toBeUndefined()
		await expect(opened.gather('background')).resolves.toBe(READ)
		expect(written).toStrictEqual([])
	})

	it('types the line before the first read lands and reveals in a theme', async () => {
		const written: Array<string> = []
		const opened = run_board_intro.opening(read_at_once, recording(written), NO_KEYS, 'wargames')

		await expect(opened.gather('background')).resolves.toBe(READ)
		expect(written).toContain(line_of(`${LINE.slice(0, -1)}${CURSOR}`))
		await opened.reveal?.('a\nb')
		expect(written.slice(-2)).toStrictEqual(['A', '\nB'])
	})
})

// joshuafolkken/kit#8677: the bttf first frame arrives out of the time jump.
const ARRIVE_THEME = 'bttf'
const COLORED = { random: (): number => 0, is_colored: (): boolean => true }
const WIPE = '\u{1B}[H\u{1B}[J'
// A frame's own color: the first frame is drawn in the theme's colors.
const RED = '\u{1B}[38;2;255;0;0m'

describe('run_board_intro.arrive', () => {
	it('is the bttf theme’s reveal', () => {
		expect(run_board_intro.ARRIVE_THEMES.has(ARRIVE_THEME)).toBe(true)
	})

	it('plays the arrival from a cleared screen, then writes the frame whole', async () => {
		const { written, ports } = recorded(instant)
		const drawn = run_board_theme.restyle(ARRIVE_THEME, FRAME)
		const beats = run_board_jump_screen.arrive_beats(drawn, undefined)

		await run_board_intro.arrive(FRAME, { ...ports, rain: COLORED }, NO_KEYS, ARRIVE_THEME)
		expect(written).toHaveLength(beats.length + 1)
		expect(written[0]).toContain(WIPE)
		expect(written.at(-1)).toBe(run_board_screen.synced(drawn))
	})

	it('wipes the screen nowhere past its first beat for a held first frame (#8732)', async () => {
		const { written, ports } = recorded(instant)
		const held = run_board_screen.screen_of('live').held(`${RED}ONE  TWO\u{1B}[0m\nA  B`)

		await run_board_intro.arrive(held, { ...ports, rain: COLORED }, NO_KEYS, ARRIVE_THEME)
		expect(written.slice(1, -1).filter((text) => text.includes(WIPE))).toStrictEqual([])
	})

	it('writes the frame at once where stdout draws no color', async () => {
		const { written, ports } = recorded(instant)
		const uncolored = { ...COLORED, is_colored: (): boolean => false }

		await run_board_intro.arrive(FRAME, { ...ports, rain: uncolored }, NO_KEYS, ARRIVE_THEME)
		expect(written).toStrictEqual([
			run_board_screen.synced(run_board_theme.restyle(ARRIVE_THEME, FRAME)),
		])
	})
})
