// How many `gh` requests this process sent, and how many of them GitHub answered `304 Not Modified`
// (joshuafolkken/kit#6694). Every spawn in `git-gh-exec.ts` counts one call, retries included,
// because each spawn can cost REST core quota; a 304 is a call that cost none. A `--paginate` spawn
// is one call here however many pages it fetched.
//
// It does no I/O: it only counts, and a later step reads `snapshot()` and writes it out. A `gh`
// run outside the exec layer (a session typing `gh issue view` itself) is not counted.

interface GhRequestTally {
	calls: number
	not_modified: number
}

const tally: GhRequestTally = { calls: 0, not_modified: 0 }

function count_call(): void {
	tally.calls += 1
}

function count_not_modified(): void {
	tally.not_modified += 1
}

function snapshot(): GhRequestTally {
	return { ...tally }
}

// For tests: the counts belong to the process, so each test starts them at zero itself.
function reset(): void {
	tally.calls = 0
	tally.not_modified = 0
}

const gh_request_tally = { count_call, count_not_modified, snapshot, reset }

export type { GhRequestTally }
export { gh_request_tally }
