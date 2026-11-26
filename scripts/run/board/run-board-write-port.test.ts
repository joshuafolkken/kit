import { describe, expect, it, vi } from 'vitest'
import { run_board_write_port, type Writable } from './run-board-write-port'

// joshuafolkken/kit#8826: a write the stream could not take holds `drained` until the stream drains.

// A stream that takes writes while `is_ready`, and the drain listeners it was given.
function stream_of(is_ready: boolean): {
	stream: Writable
	written: Array<string>
	drains: Array<() => void>
} {
	const written: Array<string> = []
	const drains: Array<() => void> = []
	const stream: Writable = {
		write: (bytes) => {
			written.push(bytes)

			return is_ready
		},
		once: (_event, listener) => {
			drains.push(listener)
		},
	}

	return { stream, written, drains }
}

async function mark(promise: Promise<void>, state: { is_done: boolean }): Promise<void> {
	await promise
	state.is_done = true
}

// Whether `promise` settles once every queued microtask has run.
async function is_settled(promise: Promise<void>): Promise<boolean> {
	const state = { is_done: false }

	void mark(promise, state)
	await new Promise<void>((resolve) => {
		setImmediate(resolve)
	})

	return state.is_done
}

describe('run_board_write_port.port_of', () => {
	it('writes through and is drained at once while the stream takes writes', async () => {
		const { stream, written, drains } = stream_of(true)
		const port = run_board_write_port.port_of(stream)

		port.write('a')

		expect(written).toStrictEqual(['a'])
		expect(drains).toHaveLength(0)
		await expect(is_settled(port.drained?.() ?? Promise.resolve())).resolves.toBe(true)
	})

	it('holds drained until the stream drains, waiting once for writes made meanwhile', async () => {
		const { stream, written, drains } = stream_of(false)
		const port = run_board_write_port.port_of(stream)

		port.write('a')
		port.write('b')
		const drained = port.drained?.() ?? Promise.resolve()

		expect(written).toStrictEqual(['a', 'b'])
		expect(drains).toHaveLength(1)
		await expect(is_settled(drained)).resolves.toBe(false)
		drains[0]?.()
		await expect(is_settled(drained)).resolves.toBe(true)
	})
})

// joshuafolkken/kit#9027: a terminal that stops reading must not block the board's thread.
describe('run_board_write_port.unblock', () => {
	it('makes a TTY handle non-blocking', () => {
		const set_blocking = vi.fn()

		run_board_write_port.unblock({ _handle: { setBlocking: set_blocking } })

		expect(set_blocking).toHaveBeenCalledExactlyOnceWith(false)
	})

	it.each([
		['no handle', {}],
		['a handle without setBlocking', { _handle: {} }],
		['a handle that is no object', { _handle: 'tty' }],
	])('leaves a stream with %s as it is', (_name, stream) => {
		expect(() => {
			run_board_write_port.unblock(stream)
		}).not.toThrow()
	})
})
