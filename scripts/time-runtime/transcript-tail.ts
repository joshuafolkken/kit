import { closeSync, fstatSync, openSync, readSync } from 'node:fs'

// **The transcript's tail, read with no reader attached** (joshuafolkken/kit#6151): `hook-decision.ts`
// needs these bytes and nothing else, and reading them through `time-density-hook.ts` pulled the batch
// guard, the shell parser and the josh alias table into every hook's import graph — a one-line alias
// edit reached 551 test files.

// How much of the transcript's end is read. The file grows to several megabytes over a long run,
// and reading all of it on every edit would put the run's own history in front of every write. A
// quarter of a megabyte is far more than the ten round trips the reading needs and is read in a
// couple of milliseconds.
const TAIL_BYTES = 262_144
const FILE_START = 0

// The last `max_bytes` of a file, as text. The leading line is usually cut mid-way, which every
// reader already handles: an unparseable line is dropped rather than dated.
//
// **Only the bytes `readSync` reports are decoded.** `Buffer.alloc` zero-fills, and a short read — a
// real possibility on the network- and FUSE-backed home directories these transcripts can live on —
// would otherwise leave NUL padding on the end of the text, making the *last* line unparseable. That
// is the one line the turn's call count is read from.
function read_tail(file_path: string, max_bytes: number = TAIL_BYTES): string {
	const descriptor = openSync(file_path, 'r')

	try {
		const { size } = fstatSync(descriptor)
		const length = Math.min(size, max_bytes)
		const buffer = Buffer.alloc(length)
		const read = readSync(descriptor, buffer, FILE_START, length, size - length)

		return buffer.subarray(FILE_START, read).toString('utf8')
	} finally {
		closeSync(descriptor)
	}
}

const transcript_tail = { TAIL_BYTES, read_tail }

export { transcript_tail }
