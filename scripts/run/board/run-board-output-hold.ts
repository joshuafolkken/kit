// The part of a writable stream the board's write port writes through. It is declared here, not in the
// write port, so the sound player that reaches this hold does not reach the board's state.
interface Writable {
	write: (bytes: string) => boolean
	once: (event: 'drain', listener: () => void) => unknown
	// The descriptor a settled port writes to directly; none keeps every write on `write`.
	fd?: number | undefined
}

// joshuafolkken/kit#9008: the board writes only what changed to a terminal it assumes is as it left
// it, so a line another writer put there stays broken. While the screen is up, every write to the
// process's stdout and stderr but the board's own port is held, and said on stderr once the screen is
// left. The worker thread's output is forwarded through these streams, so it is held with them.

type Write = (chunk: string | Uint8Array, ...rest: Array<unknown>) => unknown

const OUT = process.stdout
const ERR = process.stderr
// The stdout `write` as it was before the hold in force, none while nothing is held.
const before: { out: typeof OUT.write | undefined } = { out: undefined }

// The board's own writes — its frames and its bell: the stream as it was before any hold. It carries
// the handle the stream's blocking is set on (`run-board-write-port.ts`).
const terminal: Writable = Object.defineProperty(
	{
		write: (bytes: string) => (before.out ?? OUT.write).call(OUT, bytes),
		once: (event: 'drain', listener: () => void) => OUT.once(event, listener),
		fd: OUT.fd,
	},
	'_handle',
	{ get: () => Reflect.get(OUT, '_handle') as unknown },
)

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

	before.out = before_out
	OUT.write = holder(chunks) as typeof OUT.write
	ERR.write = holder(chunks) as typeof ERR.write

	return () => {
		if (!is_held) return
		is_held = false
		before.out = undefined
		OUT.write = before_out
		ERR.write = before_error
		if (chunks.length > 0) ERR.write(chunks.join(''))
	}
}

const run_board_output_hold = { hold, terminal }

export { run_board_output_hold }
export type { Writable }
