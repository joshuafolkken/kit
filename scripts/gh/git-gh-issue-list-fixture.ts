import type { IssueListOutcome } from './git-gh-issue-list'

// A listing as the six wrappers in `git-gh-issue.ts` answer it, for the suites that mock one of them
// (joshuafolkken/kit#1067).
//
// Every caller receives `{ json, is_capped }` now, so a suite resolving a bare JSON string would be
// pinning a shape no caller ever sees. Built here rather than spelled out in each file: six suites
// writing the same object literal is what makes a later field addition a six-file edit.
//
// `json` is `undefined` for a read that failed — never `'[]'`, which is a real answer meaning the
// listing was empty. `is_capped` says the page ceiling stopped the paging before the listing ran
// out, and defaults to the ordinary case.
function listing_outcome(json: string | undefined, is_capped = false): IssueListOutcome {
	return { json, is_capped }
}

// The same listing, cut short by the page ceiling. Named so a case about truncation reads as one.
function capped_listing_outcome(json: string): IssueListOutcome {
	return listing_outcome(json, true)
}

// The listing built from rows the case already has. Its reason is the nesting limit: a case writing
// `mockResolvedValueOnce(listing_outcome(JSON.stringify([issue(1)])))` is four calls deep, and every
// suite that mocks a listing hits that on the row-bearing cases.
function listing_of(rows: ReadonlyArray<unknown>, is_capped = false): IssueListOutcome {
	return listing_outcome(JSON.stringify(rows), is_capped)
}

export { listing_outcome, capped_listing_outcome, listing_of }
