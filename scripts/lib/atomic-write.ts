import { randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

// Replacing a file so a concurrent reader sees the old content or the new, never half of either.
//
// The content is written to a staging file and renamed over the target; `rename` swaps the path
// itself, so a reader that opened the old file keeps reading it. **The staging name is unique per
// write** — process id and a random UUID — because two writers sharing one name interleave their bytes
// into the same staging file and both rename the mix into place. Create-exclusively refuses a name
// someone else already holds rather than writing through it, and the `finally` removes the staging
// file on every failing path. The `.tmp` ending keeps it out of a directory scan that matches the
// target's own extension.

const STAGING_EXTENSION = '.tmp'
const CREATE_EXCLUSIVE_FLAG = 'wx'

interface AtomicWriteOptions {
	// Given to the create, so a private file is never readable at another mode in between, and
	// applied again with `chmod`, so the umask cannot narrow it.
	readonly mode?: number
	// Where the staging file is written; the target's directory by default. It must sit on the
	// target's filesystem for the rename to stay atomic.
	readonly staging_directory?: string
}

function staging_path(target: string, staging_directory: string): string {
	const name = `${path.basename(target)}.${String(process.pid)}.${randomUUID()}${STAGING_EXTENSION}`

	return path.join(staging_directory, name)
}

interface Staged {
	readonly directory: string
	readonly staging: string
}

// Where one write stages, shared by the synchronous and asynchronous replace so both name it alike.
function staged_for(target: string, options: AtomicWriteOptions): Staged {
	const directory = options.staging_directory ?? path.dirname(target)

	return { directory, staging: staging_path(target, directory) }
}

function create_options(mode?: number): { flag: string; mode?: number } {
	return { flag: CREATE_EXCLUSIVE_FLAG, ...(mode !== undefined && { mode }) }
}

function write_staged(staging: string, content: string | Uint8Array, mode?: number): void {
	writeFileSync(staging, content, create_options(mode))
	if (mode !== undefined) chmodSync(staging, mode)
}

async function write_staged_async(
	staging: string,
	content: string | Uint8Array,
	mode?: number,
): Promise<void> {
	await writeFile(staging, content, create_options(mode))
	if (mode !== undefined) await chmod(staging, mode)
}

function replace_file(
	target: string,
	content: string | Uint8Array,
	options: AtomicWriteOptions = {},
): void {
	const { directory, staging } = staged_for(target, options)

	mkdirSync(directory, { recursive: true })

	try {
		write_staged(staging, content, options.mode)
		renameSync(staging, target)
	} finally {
		rmSync(staging, { force: true })
	}
}

// The same replace for a caller that must not wait on the disk, such as a redraw on the second.
async function replace_file_async(
	target: string,
	content: string | Uint8Array,
	options: AtomicWriteOptions = {},
): Promise<void> {
	const { directory, staging } = staged_for(target, options)

	await mkdir(directory, { recursive: true })

	try {
		await write_staged_async(staging, content, options.mode)
		await rename(staging, target)
	} finally {
		await rm(staging, { force: true })
	}
}

const atomic_write = { replace_file, replace_file_async }

export { atomic_write }
export type { AtomicWriteOptions }
