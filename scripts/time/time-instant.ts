// One decision about an unparseable timestamp, made once (joshuafolkken/kit#1268).
//
// Both halves of a run carry dates from somewhere else — the transcript's `timestamp` and GitHub's
// `created_at` / `merged_at` / check-run times — and both have to answer the same question about a
// value they cannot read. `undefined` is the answer, never `NaN` and never `0`: a `NaN` propagates
// silently through every arithmetic that touches it, and a `0` reads as the epoch, which puts a span
// in 1970 and makes a merge appear before its own pull request.
//
// It lives in its own module rather than in either reader because a copy in each is exactly the
// clone `CLAUDE.md` prohibits, and the two copies would disagree the first time one of them learned
// to accept another format.
function parse_instant(raw: string | null | undefined): number | undefined {
	const parsed = Date.parse(raw ?? '')

	return Number.isNaN(parsed) ? undefined : parsed
}

const time_instant = { parse_instant }

export { time_instant }
