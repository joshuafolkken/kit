import { run_board_intro, type IntroPorts } from './run-board-intro'
import type { KeyReading } from './run-board-keys'

// The intro's tests' ports: writes recorded, pauses that end at once or never, and keys a test presses
// to skip (joshuafolkken/kit#7927, joshuafolkken/kit#8441).

const { ERASE_LINE_END, LINE_START } = run_board_intro
const READ = 'read'
const NO_KEYS: KeyReading = { folded: undefined }

// The line as a beat rewrites it.
function line_of(shown: string): string {
	return `${LINE_START}${shown}${ERASE_LINE_END}`
}

async function instant(): Promise<void> {
	await Promise.resolve()
}

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

// joshuafolkken/kit#8787: ports on a fake clock that a pause moves on by its length and a write by
// `write_ms`, the time a terminal takes to draw it; the pauses asked for are recorded.
interface Clocked {
	written: Array<string>
	paused: Array<number>
	clock: { at: number }
	ports: IntroPorts
}

function clocked(write_ms: number): Clocked {
	const written: Array<string> = []
	const paused: Array<number> = []
	const clock = { at: 0 }
	const ports: IntroPorts = {
		write: (text) => {
			written.push(text)
			clock.at += write_ms
		},
		intro_sleep: async (ms) => {
			paused.push(ms)
			clock.at += ms
			await instant()
		},
		intro_now: () => clock.at,
	}

	return { written, paused, clock, ports }
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

async function read_at_once(): Promise<string> {
	return READ
}

const run_board_intro_fixture = {
	NO_KEYS,
	READ,
	clocked,
	deferred,
	instant,
	line_of,
	never,
	read_at_once,
	recorded,
	skippable,
}

export { run_board_intro_fixture }
