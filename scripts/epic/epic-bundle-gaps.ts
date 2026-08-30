import { cutoff_cause, type ScanCutoff } from '#scripts/git/listing-cutoff'

// What `epic:bundle` could not see, said in the `⚠ … cap` shape joshuafolkken/kit#1033 settled on
// for `epic:audit`. Split out of `epic-bundle-cli.ts` because the wording carries more explanation
// than the command it warns from (joshuafolkken/kit#1067).
//
// **Two listings, and two cuts each.** The listing decides *what* is hidden — a backlog issue, or
// the epic that tracks one — and the cut decides *which number to cite*, because a reader who wants
// the answer widened reaches for a different knob in each case: the caller's `limit`, which this
// command sets, or the paging's page ceiling, which it does not. The dispatch between the two is
// `cutoff_cause`, shared with every other caller that reports one.

// The backlog scan's gap: a related issue past the cut is reported as "no existing issue shares a
// reference" — an assertion about data that was never loaded.
function backlog_gap(cutoff: ScanCutoff, limit: number): string | undefined {
	const cause = cutoff_cause(cutoff, `hit its ${String(limit)}-issue cap`)
	if (cause === undefined) return undefined

	return `⚠ The backlog listing ${cause}; older issues were not considered.`
}

// Named separately from the backlog's. What this one hides is *which epic tracks a candidate*, so
// `Nothing to bundle.` under it may mean "the epic was past the cut" rather than "no epic tracks
// it" — and acting on the second reading creates the duplicate epic (joshuafolkken/kit#950).
function epic_gap(cutoff: ScanCutoff, limit: number): string | undefined {
	const cause = cutoff_cause(cutoff, `hit its ${String(limit)}-epic cap`)
	if (cause === undefined) return undefined

	return `⚠ The epic listing ${cause}; an epic past it was not considered.`
}

const epic_bundle_gaps = {
	backlog_gap,
	epic_gap,
}

export { epic_bundle_gaps }
