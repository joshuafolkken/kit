import { repository_lock } from '#scripts/git/repository-lock'
import { durable_state } from '#scripts/josh/durable-state'
import { stamp_file } from '#scripts/josh/stamp-file'

// The josh processes' GitHub usage lines, one JSON line per process (joshuafolkken/kit#6707). **Its own
// file, not the run's event stream**: every josh process writes one, so in the stream, always at its
// cap, the bound dropped each line as it was written. Here a line lives until the newest `USAGE_CAP`
// lines push it out. The read and the rewrite are one step under the file's lock, as the stream's are,
// so concurrent processes never lose each other's lines.

const USAGE_SUFFIX = '.jsonl'
const USAGE_CAP = 2000
const LOCK_SUFFIX = '.lock'
const LOCK_WAIT_MS = 5000
const LINE_SEPARATOR = '\n'

function target_of(repository: string): string {
	return durable_state.path(durable_state.PREFIX.GH_USAGE, repository, USAGE_SUFFIX)
}

// Every line, oldest first; a missing file reads as none.
function read_lines(target: string): ReadonlyArray<string> {
	const raw = stamp_file.read_stamp_text(target) ?? ''

	return raw.split(LINE_SEPARATOR).filter((line) => line !== '')
}

function append_held(target: string, line: string): true {
	const lines = [...read_lines(target), line].slice(-USAGE_CAP)

	stamp_file.replace_text_stamp(target, `${lines.join(LINE_SEPARATOR)}${LINE_SEPARATOR}`)

	return true
}

// A lock still held after the wait throws, which the best-effort writer swallows.
function append(target: string, record: object): void {
	const lock = `${target}${LOCK_SUFFIX}`
	const line = JSON.stringify(record)

	if (repository_lock.with_lock_sync(() => append_held(target, line), lock, LOCK_WAIT_MS)) return

	throw new Error(`gh usage log: gave up waiting for the lock at ${lock}`)
}

const gh_usage_log = { USAGE_CAP, append, read_lines, target_of }

export { gh_usage_log }
