import { describe, expect, it } from 'vitest'
import { run_board_intro, type IntroPorts } from './run-board-intro'
import type { KeyReading } from './run-board-keys'
import { run_board_typing } from './run-board-typing'

// joshuafolkken/kit#7927: a live board types its line a letter at a time and holds it before the first
// frame, which a key skips; the first read runs meanwhile and is handed over only once the line is done.

const {
	ERASE_LINE_END,
	HOLD_MS,
	LETTER_MS,
	LINE,
	LINE_START,
	REVEAL_LINE_MS,
	after,
	play,
	reveal,
} = run_board_intro
const { CURSOR } = run_board_typing

function line_of(shown: string): string {
	return `${LINE_START}${shown}${ERASE_LINE_END}`
}

async function instant(): Promise<void> {
	await Promise.resolve()
}

const READ = 'read'

function recording(written: Array<string>): IntroPorts {
	return {
		intro_sleep: instant,
		write: (text) => {
			written.push(text)
		},
	}
}

const NO_KEYS: KeyReading = { folded: undefined }

interface Deferred<Value> {
	promise: Promise<Value>
	resolve: (value: Value) => void
}

function deferred<Value>(): Deferred<Value> {
	const held: { resolve: ((value: Value) => void) | undefined } = { resolve: undefined }
	const promise = new Promise<Value>((resolve) => {
		held.resolve = resolve
	})

	return { promise, resolve: (value) => held.resolve?.(value) }
}

async function never(): Promise<void> {
	await deferred<undefined>().promise
}

function recorded(intro_sleep: (ms: number) => Promise<void>): {
	written: Array<string>
	ports: IntroPorts
} {
	const written: Array<string> = []
	const ports: IntroPorts = {
		write: (text) => {
			written.push(text)
		},
		intro_sleep,
	}

	return { written, ports }
}

interface Skippable {
	keys: KeyReading
	press: () => void
	released: () => boolean
}

function skippable(): Skippable {
	const held: { taker: (() => void) | undefined; is_released: boolean } = {
		taker: undefined,
		is_released: false,
	}

	return {
		keys: {
			folded: undefined,
			intercept: (on_key) => {
				held.taker = on_key

				return () => {
					held.is_released = true
				}
			},
		},
		press: () => held.taker?.(),
		released: () => held.is_released,
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

		await play(ports, NO_KEYS)
		expect(written).toHaveLength(LINE.length + 1)
		expect(slept).toStrictEqual([...Array.from(LINE, () => LETTER_MS), HOLD_MS])
	})

	it('types nothing where the ports carry no pauses', async () => {
		const { written, ports } = recorded(never)

		await play({ write: ports.write }, NO_KEYS)
		expect(written).toStrictEqual([])
	})

	it('stops typing at a key, cutting the pause short, and gives the keys back', async () => {
		const { keys, press, released } = skippable()
		const { written, ports } = recorded(never)
		const pending = play(ports, keys)

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

		await play(ports, NO_KEYS)
		const typing = Array.from(LINE.slice(0, -1), (_letter, index) =>
			line_of(`${LINE.slice(0, index + 1)}${CURSOR}`),
		)

		expect(written.slice(0, LINE.length)).toStrictEqual([...typing, line_of(LINE)])
	})

	it('shows no cursor while it holds the line', async () => {
		const { written, ports } = recorded(instant)

		await play(ports, NO_KEYS)
		expect(written.at(-1)).toBe('')
		expect(written.at(-2)?.includes(CURSOR)).toBe(false)
	})
})

// joshuafolkken/kit#8006: the first frame is written a line at a time from the top, a pause after each;
// a key writes the rest at once, and ports without pauses get the frame whole.
const FRAME = 'one\ntwo\nthree'

describe('run_board_intro.reveal', () => {
	it('writes the frame a line at a time from the top, pausing after each line', async () => {
		const slept: Array<number> = []
		const { written, ports } = recorded(async (ms) => {
			slept.push(ms)
		})

		await reveal(FRAME, ports, NO_KEYS)
		expect(written).toStrictEqual(['one', '\ntwo', '\nthree'])
		expect(slept).toStrictEqual([REVEAL_LINE_MS, REVEAL_LINE_MS, REVEAL_LINE_MS])
	})

	it('writes the lines left at once on a key, and gives the keys back', async () => {
		const { keys, press, released } = skippable()
		const { written, ports } = recorded(never)
		const pending = reveal(FRAME, ports, keys)

		press()
		await pending
		expect(written).toStrictEqual(['one', '\ntwo\nthree'])
		expect(written.join('')).toBe(FRAME)
		expect(released()).toBe(true)
	})

	it('writes the frame whole where the ports carry no pauses', async () => {
		const { written, ports } = recorded(never)

		await reveal(FRAME, { write: ports.write }, NO_KEYS)
		expect(written).toStrictEqual([FRAME])
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
async function read_at_once(): Promise<string> {
	return await READ
}

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
		expect(written.slice(-2)).toStrictEqual(['a', '\nb'])
	})
})
