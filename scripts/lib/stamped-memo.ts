import { lstatSync } from 'node:fs'

// An answer remembered per key, recomputed only when the key's stamp changes (joshuafolkken/kit#4263).
//
// **`run:board` redraws every second, and most of what it reads has not changed since the last
// redraw.** A process's app name, a ledger's parsed lines and a work tree's git config were computed
// again on every pass, and on a saturated machine those passes stopped the spinner visibly. The
// stamp is what says "this has changed": a file's `file_stamp`, or a constant where the key alone
// decides the answer.

const NO_STAMP = ''
const STAMP_SEPARATOR = ':'

interface Remembered<Value> {
	stamp: string
	value: Value
}

interface StampedMemo<Value> {
	// `compute`'s answer for `key`, run only when `key` was never seen or its stamp moved since.
	of: (key: string, stamp: string, compute: () => Value) => Value
	// Forget every key outside `keys` — a process gone from the table, so the memo cannot grow unbounded.
	keep: (keys: ReadonlySet<string>) => void
}

function create<Value>(): StampedMemo<Value> {
	const answers = new Map<string, Remembered<Value>>()

	return {
		of(key, stamp, compute) {
			const known = answers.get(key)

			if (known?.stamp === stamp) return known.value

			const value = compute()

			answers.set(key, { stamp, value })

			return value
		},
		keep(keys) {
			for (const key of answers.keys()) if (!keys.has(key)) answers.delete(key)
		},
	}
}

// What changes when a file is rewritten, appended to, replaced or re-owned: its inode, its modification
// and change times and its size. An absent or unreadable file is `NO_STAMP`, so it reads again once
// it appears.
function file_stamp(file: string): string {
	try {
		const status = lstatSync(file)

		return [status.ino, status.mtimeMs, status.ctimeMs, status.size].join(STAMP_SEPARATOR)
	} catch {
		return NO_STAMP
	}
}

const stamped_memo = { NO_STAMP, create, file_stamp }

export { stamped_memo }
export type { StampedMemo }
