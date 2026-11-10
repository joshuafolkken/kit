import { closeSync, constants, openSync, readFileSync, rmSync, writeSync } from 'node:fs'
import { lane_ledger_write } from './lane-ledger-write'

// The mark a backlog driver leaves beside the measurement ledger when it hands back a run with every
// lane taken (joshuafolkken/kit#7159, split from joshuafolkken/kit#7121).
//
// **Only a running driver writes a hold.** A driver that ends on a full pool writes `released`, and a
// lane that frees after it is recorded by no one. The mark — `<ledger>.hand-back`, holding the
// hand-back's reason — tells a later writer that the lanes still wait on a session. The driver clears
// it on every ledger line it writes, so a mark only stands while no driver runs.
//
// Best-effort like every ledger write: a failed mark or clear is dropped rather than failing the driver.

const MARK_SUFFIX = '.hand-back'
const MARK_FILE_MODE = 0o600
const MARK_ENCODING = 'utf8'
const { O_CREAT, O_NOFOLLOW, O_TRUNC, O_WRONLY } = constants
// eslint-disable-next-line no-bitwise -- POSIX open flags are a bit field; `||` here would be a bug
const WRITE_FLAGS = O_WRONLY | O_CREAT | O_TRUNC | O_NOFOLLOW

function mark_of(ledger: string): string {
	return `${ledger}${MARK_SUFFIX}`
}

// The mark beside the given ledger, else beside this repository's — `undefined` outside one or in a test.
async function destination(ledger?: string): Promise<string | undefined> {
	const resolved = ledger ?? (await lane_ledger_write.target())

	return resolved === undefined ? undefined : mark_of(resolved)
}

// `O_NOFOLLOW` keeps a planted link from receiving the mark, as the ledger's own append does.
function write(path: string, reason: string): void {
	const descriptor = openSync(path, WRITE_FLAGS, MARK_FILE_MODE)

	try {
		writeSync(descriptor, reason)
	} finally {
		closeSync(descriptor)
	}
}

// `reason` is the hand-back's ledger reason, `hand-back:<end>`, written as the mark's whole content.
async function mark(reason: string, ledger?: string): Promise<void> {
	try {
		const path = await destination(ledger)

		if (path !== undefined) write(path, reason)
	} catch {
		// Best-effort: a mark that cannot be written leaves the free lanes unrecorded, as before it.
	}
}

async function clear(ledger?: string): Promise<void> {
	try {
		const path = await destination(ledger)

		if (path !== undefined) rmSync(path, { force: true })
	} catch {
		// Best-effort: a stale mark is cleared again by the driver's next ledger line.
	}
}

// The standing mark's reason, or `undefined` when no hand-back left one.
function read(ledger: string): string | undefined {
	try {
		return readFileSync(mark_of(ledger), MARK_ENCODING)
	} catch {
		return undefined
	}
}

const lane_hand_back_hold = { clear, mark, read }

export { lane_hand_back_hold }
