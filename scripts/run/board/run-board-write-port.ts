import type { BoardPorts } from './run-board-state'

// A live `run:board`'s writes to the terminal with their backpressure (joshuafolkken/kit#8826): a
// write the stream could not take at once (`write` answered false) holds `drained` until the stream
// drains, so the frame loop makes no frame the terminal is not ready for — and writes none it skipped.

// The part of a writable stream the port writes through.
interface Writable {
	write: (bytes: string) => boolean
	once: (event: 'drain', listener: () => void) => unknown
}

function port_of(stream: Writable): Pick<BoardPorts, 'write' | 'drained'> {
	const held: { pending: Promise<void> | undefined } = { pending: undefined }

	return {
		write: (bytes) => {
			const is_taken = stream.write(bytes)

			if (is_taken || held.pending !== undefined) return
			held.pending = new Promise((resolve) => {
				stream.once('drain', () => {
					held.pending = undefined
					resolve()
				})
			})
		},
		drained: async () => {
			await held.pending
		},
	}
}

const run_board_write_port = { port_of }

export { run_board_write_port }
export type { Writable }
