import { MAX_SCANNED } from './git-gh-issue-list'

// Why an open-issue listing stopped short of the end of the backlog, or that it did not
// (joshuafolkken/kit#1067).
//
// Every caller of `issue_list_open` asks this same question, and before this the answer was written
// out again at each of them — `rows.length >= LIMIT` in `epic:bundle` and the `auto-ok` pickup, a
// near-identical `cutoff_of` in `epic:audit`, and nothing at all in the two that most needed it. One
// definition instead, so a caller cannot quietly disagree with the others about what "I saw
// everything" means.
//
// The two cutoffs are told apart because they cite different numbers and send a reader to different
// knobs: `row_limit` is the caller's own `limit`, which it can raise, and `page_ceiling` is the
// paging's `MAX_PAGES`, which it cannot.
type ScanCutoff = 'none' | 'row_limit' | 'page_ceiling'

// The two are mutually exclusive by construction — the paging stops as soon as `limit` rows have
// been selected, so a listing that filled `limit` never reached the ceiling — and `row_limit` is
// checked first so that stays true even if the paging changes.
//
// Exactly `limit` rows answers `row_limit` though nothing may have been missed, and exactly
// `MAX_SCANNED` open items answers `page_ceiling` for the same boundary reason
// `git-gh-issue-list.ts` records. Erring toward "I may not have seen everything" is the safe
// direction for every caller here; the alternative spends a request on each capped run to rule out
// one boundary.
function cutoff_of(row_count: number, limit: number, is_capped: boolean): ScanCutoff {
	if (row_count >= limit) return 'row_limit'

	return is_capped ? 'page_ceiling' : 'none'
}

// What the page ceiling cut off, said once. Each caller words its own *consequence* — an epic past
// the cut hides something different from a backlog issue past it — but the cause is one fact, and a
// second spelling of it would cite a number that does not match `MAX_SCANNED`.
const PAGE_CEILING_CAUSE = `stopped at the ${String(MAX_SCANNED)}-issue page ceiling`

// Why this listing stopped, as a phrase to drop into the caller's own sentence — or `undefined` when
// it ran out and there is nothing to say.
//
// `row_limit_cause` is passed rather than built here because the noun differs at every call site: an
// issue cap, an epic cap, a match cap. What is shared is the *dispatch* — which of the two numbers a
// reader has to be given — and writing it out at each caller is what let one of them cite the wrong
// one.
function cutoff_cause(cutoff: ScanCutoff, row_limit_cause: string): string | undefined {
	if (cutoff === 'row_limit') return row_limit_cause

	return cutoff === 'page_ceiling' ? PAGE_CEILING_CAUSE : undefined
}

export type { ScanCutoff }
export { cutoff_of, cutoff_cause, PAGE_CEILING_CAUSE }
