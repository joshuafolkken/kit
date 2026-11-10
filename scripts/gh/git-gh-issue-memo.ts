import { git_gh_etag_read } from './git-gh-etag-read'

// The single-issue reads one process has already made, keyed by request path
// (joshuafolkken/kit#7141). `josh followup`, `backlog:drive` and `ship` read the same issue from
// several functions, and `josh gh:usage` counted four in five of those GETs answered `304` — a
// request each, for an answer the process already held. `git-gh-pr-read.ts`'s `pull_by_number` is
// the same memo for pull requests.
//
// The promise is stored, so readers in one tick share the request as well as its answer; a read
// that fails is dropped and re-tried. **Every write josh makes to an issue clears it** — the writes
// in `git-gh-issue-write.ts` and the pull-request writes `forget_pr_numbers` covers, since a merge
// closes the issues it names.
//
// **An answer is kept for `FRESH_MS`, not for the life of the process.** The live `run:board` gathers
// in one long-lived worker and re-reads a decision child every tick to see what *another* process or
// a person changed; a memo with no bound would freeze that board on its first answer.
const FRESH_MS = 10_000

interface Remembered {
	read: Promise<string>
	at_ms: number
}

const read_by_path = new Map<string, Remembered>()

function fresh_entry(path: string, now_ms: number): Remembered | undefined {
	const entry = read_by_path.get(path)

	return entry !== undefined && now_ms - entry.at_ms < FRESH_MS ? entry : undefined
}

// The identity check keeps a failure from evicting a read that `forget` already replaced.
async function read(path: string): Promise<string> {
	const now_ms = Date.now()
	const entry = fresh_entry(path, now_ms) ?? { read: git_gh_etag_read.read(path), at_ms: now_ms }

	read_by_path.set(path, entry)

	try {
		return await entry.read
	} catch (error) {
		if (read_by_path.get(path) === entry) read_by_path.delete(path)
		throw error
	}
}

function forget(): void {
	read_by_path.clear()
}

const git_gh_issue_memo = { read, forget, FRESH_MS }

export { git_gh_issue_memo }
