import { readSync } from 'node:fs'

// Standard input read to its end, for every command that takes `-` as a path (joshuafolkken/kit#7075).
//
// **`readFileSync(0)` is not that read.** When descriptor 0 is a pipe in non-blocking mode and its
// writer has not written yet, the read throws `EAGAIN` instead of waiting — the shape
// `producer | pnpm josh issue:body <N> --body-file -` takes, because a pipe's status flags belong to
// the shared open file and a stream opened on it elsewhere in the process sets `O_NONBLOCK`. Here each
// `EAGAIN` waits a moment and reads again, and the input ends at a read of zero bytes.
//
// **The read stays synchronous** so the readers of `cli_body` keep their signatures; the wait parks the
// thread with `Atomics.wait` rather than spinning.

const STDIN_FD = 0
const CHUNK_BYTES = 65_536
const RETRY_WAIT_MS = 10
const WAIT_CELL = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT))
const TRY_AGAIN_CODE = 'EAGAIN'

// The two effects the read loop has, apart so a test can drive the `EAGAIN` path without a real pipe.
interface StdinSource {
	read: (buffer: Uint8Array) => number
	wait: () => void
}

function read_descriptor(buffer: Uint8Array): number {
	return readSync(STDIN_FD, buffer)
}

function wait_briefly(): void {
	Atomics.wait(WAIT_CELL, 0, 0, RETRY_WAIT_MS)
}

const DESCRIPTOR_SOURCE: StdinSource = { read: read_descriptor, wait: wait_briefly }

function is_try_again(error: unknown): boolean {
	return error instanceof Error && 'code' in error && error.code === TRY_AGAIN_CODE
}

// One chunk's byte count, or undefined when the descriptor had nothing to give yet.
function read_chunk(source: StdinSource, buffer: Uint8Array): number | undefined {
	try {
		return source.read(buffer)
	} catch (error) {
		if (!is_try_again(error)) throw error
		source.wait()

		return undefined
	}
}

function read_all(source: StdinSource = DESCRIPTOR_SOURCE): string {
	const buffer = new Uint8Array(CHUNK_BYTES)
	const chunks: Array<Buffer> = []
	let count = read_chunk(source, buffer)

	while (count !== 0) {
		if (count !== undefined) chunks.push(Buffer.from(buffer.subarray(0, count)))
		count = read_chunk(source, buffer)
	}

	return Buffer.concat(chunks).toString('utf8')
}

const stdin_text = { read_all }

export type { StdinSource }
export { stdin_text }
