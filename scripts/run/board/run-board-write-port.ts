import { writeSync } from 'node:fs'
import type { Writable } from './run-board-output-hold'
import type { BoardPorts } from './run-board-state'

// A live `run:board`'s writes to the terminal with their backpressure (joshuafolkken/kit#8826): a
// write the stream could not take at once (`write` answered false) holds `drained` until the stream
// drains, so the frame loop makes no frame the terminal is not ready for — and writes none it skipped.

interface Held {
	pending: Promise<void> | undefined
	is_settled: boolean
}

// `bytes` handed to the stream, `drained` held while it could not take them.
function queued(stream: Writable, held: Held, bytes: string): void {
	const is_taken = stream.write(bytes)

	if (is_taken || held.pending !== undefined) return
	held.pending = new Promise((resolve) => {
		stream.once('drain', () => {
			held.pending = undefined
			resolve()
		})
	})
}

// The handle Node keeps under a TTY stream, its writes made blocking by `tty.WriteStream`.
interface Handle {
	setBlocking: (is_blocking: boolean) => unknown
}

function is_handle(value: unknown): value is Handle {
	return typeof value === 'object' && value !== null && 'setBlocking' in value
}

// A stream with no such handle (a pipe, a file) is left as it is.
function set_blocking(stream: object, is_blocking: boolean): void {
	const handle: unknown = Reflect.get(stream, '_handle')

	if (is_handle(handle)) handle.setBlocking(is_blocking)
}

// joshuafolkken/kit#9027: once settled, the board is leaving and `process.exit` drops a write still
// queued behind a frame's unwritten tail, so each write goes to the descriptor at once, blocking.
function port_of(stream: Writable): Pick<BoardPorts, 'write' | 'drained' | 'settle'> {
	const held: Held = { pending: undefined, is_settled: false }

	return {
		write: (bytes) => {
			if (held.is_settled && stream.fd !== undefined) writeSync(stream.fd, bytes)
			else queued(stream, held, bytes)
		},
		drained: async () => {
			await held.pending
		},
		settle: () => {
			set_blocking(stream, true)
			held.is_settled = true
		},
	}
}

// joshuafolkken/kit#9027: Node writes a TTY synchronously, so a terminal that stops reading blocks the
// board's thread on its next write, and every signal handler with it, the leave that ends the sound
// among them. Unblocked, a write the terminal cannot take waits for `drain` (`port_of`) and a signal
// still leaves.
function unblock(stream: object): void {
	set_blocking(stream, false)
}

const run_board_write_port = { port_of, unblock }

export { run_board_write_port }

export { type Writable } from './run-board-output-hold'
