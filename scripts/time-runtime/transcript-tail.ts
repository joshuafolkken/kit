import { closeSync, fstatSync, openSync, readSync } from 'node:fs'
import { open, type FileHandle } from 'node:fs/promises'

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
const NEWLINE = 0x0a

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

// The bytes of `handle` from `start` up to `end`; only the bytes read are kept.
async function read_range(handle: FileHandle, start: number, end: number): Promise<Buffer> {
	const buffer = Buffer.alloc(end - start)
	const { bytesRead: read } = await handle.read(buffer, FILE_START, end - start, start)

	return buffer.subarray(FILE_START, read)
}

// The first `max_bytes` of a file, as text; only the bytes read are decoded.
async function read_head(file_path: string, max_bytes: number = TAIL_BYTES): Promise<string> {
	const handle = await open(file_path, 'r')

	try {
		const head = await read_range(handle, FILE_START, max_bytes)

		return head.toString('utf8')
	} finally {
		await handle.close()
	}
}

interface ScanSource {
	handle: FileHandle
	// Matches every line `last_line_matching` looks for: its pattern with `g` and without `y`.
	every: RegExp
	piece_bytes: number
}

interface ScanPiece {
	found: string | undefined
	// The bytes before the piece's first whole line: a line that begins in an earlier piece.
	carry: Buffer
	start: number
}

// Where the whole lines of `joined`, read from `start`, begin: the bytes before its first newline
// belong to a line that begins earlier, unless `start` is the file's start.
function first_whole_line(joined: Buffer, start: number): number {
	if (start === FILE_START) return FILE_START

	const newline = joined.indexOf(NEWLINE)

	return newline === -1 ? joined.length : newline + 1
}

// The piece of the file before `end`, joined to the line it began (`carry`): its last matching whole
// line, and the line it cuts, carried back to the piece before it.
async function scan_piece(source: ScanSource, end: number, carry: Buffer): Promise<ScanPiece> {
	const start = Math.max(end - source.piece_bytes, FILE_START)
	const joined = Buffer.concat([await read_range(source.handle, start, end), carry])
	const cut = first_whole_line(joined, start)
	const found = [...joined.subarray(cut).toString('utf8').matchAll(source.every)].at(-1)?.[0]

	return { found, carry: joined.subarray(FILE_START, cut), start }
}

async function scan_back(source: ScanSource, size: number): Promise<string | undefined> {
	let end = size
	let carry: Buffer = Buffer.alloc(FILE_START)

	while (end > FILE_START) {
		// eslint-disable-next-line no-await-in-loop -- An earlier piece is read only when the later ones held no match.
		const piece = await scan_piece(source, end, carry)

		if (piece.found !== undefined) return piece.found
		carry = piece.carry
		end = piece.start
	}

	return undefined
}

// The last line of a file that matches `pattern`, read back from its end a piece at a time, so no more
// than a piece and the line it cuts are held at once; `undefined` when no line matches
// (joshuafolkken/kit#8340). A lane log's last launch header usually sits at its start, megabytes back,
// and a read that kept the whole tail put the log's size in memory on every board quota read.
async function last_line_matching(
	file_path: string,
	pattern: RegExp,
	piece_bytes: number = TAIL_BYTES,
): Promise<string | undefined> {
	const every = new RegExp(pattern.source, `${pattern.flags.replaceAll(/[gy]/gu, '')}g`)
	const handle = await open(file_path, 'r')

	try {
		const { size } = await handle.stat()

		return await scan_back({ handle, every, piece_bytes }, size)
	} finally {
		await handle.close()
	}
}

const transcript_tail = { TAIL_BYTES, last_line_matching, read_head, read_tail }

export { transcript_tail }
