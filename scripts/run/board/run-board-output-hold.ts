import type { Writable } from './run-board-write-port'

// joshuafolkken/kit#9008: the board writes only what changed to a terminal it assumes is as it left
// it, so a line another writer put there stays broken. While the screen is up, every write to the
// process's stdout and stderr but the board's own port is held, and said on stderr once the screen is
// left. The worker thread's output is forwarded through these streams, so it is held with them.

type Write = (chunk: string | Uint8Array, ...rest: Array<unknown>) => unknown

const OUT = process.stdout
const ERR = process.stderr
const before = { out: OUT.write.bind(OUT) }

// The board's own writes: the stream as it was before any hold.
const terminal: Writable = {
	write: (bytes) => before.out(bytes),
	once: (event, listener) => OUT.once(event, listener),
	fd: OUT.fd,
}

function text_of(chunk: string | Uint8Array): string {
	return typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString()
}

// A write that keeps its text and tells the callback it was given that it is done.
function holder(chunks: Array<string>): Write {
	return (chunk, ...rest) => {
		chunks.push(text_of(chunk))
		for (const argument of rest) if (typeof argument === 'function') (argument as () => void)()

		return true
	}
}

// Holds the process's output until the returned release, which says it on stderr; a second release
// does nothing.
function hold(): () => void {
	const chunks: Array<string> = []
	const { write: before_out } = OUT
	const { write: before_error } = ERR
	let is_held = true

	OUT.write = holder(chunks) as typeof OUT.write
	ERR.write = holder(chunks) as typeof ERR.write

	return () => {
		if (!is_held) return
		is_held = false
		OUT.write = before_out
		ERR.write = before_error
		if (chunks.length > 0) ERR.write(chunks.join(''))
	}
}

const run_board_output_hold = { hold, terminal }

export { run_board_output_hold }
