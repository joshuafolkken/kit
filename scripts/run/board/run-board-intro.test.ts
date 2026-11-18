import { describe, expect, it } from 'vitest'
import { run_board_intro, type IntroPorts } from './run-board-intro'
import type { KeyReading } from './run-board-keys'

// joshuafolkken/kit#7927: a live board types its line a letter at a time and holds it before the first
// frame, which a key skips; the first read runs meanwhile and is handed over only once the line is done.

const { HOLD_MS, LETTER_MS, LINE, after, play } = run_board_intro
const READ = 'read'
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

describe('run_board_intro.play', () => {
	it('types the line a letter at a time, pausing after each, then holds it', async () => {
		const slept: Array<number> = []
		const { written, ports } = recorded(async (ms) => {
			slept.push(ms)
		})

		await play(ports, NO_KEYS)
		expect(written.join('')).toBe(LINE)
		expect(written.slice(0, LINE.length).every((text) => text.length === 1)).toBe(true)
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
		expect(written).toStrictEqual([LINE[0]])
		expect(released()).toBe(true)
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
