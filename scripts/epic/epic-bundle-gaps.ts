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

// Whether "this issue belongs to no epic" is a finding or merely an absence.
//
// Every verdict that *places* the subject in an epic rests on that negative — `create_epic` asserts
// it about the candidates too, but `add_to_epic` and `ask` assert it about the subject alone — and
// the assertion is only as good as the epic listing it was read from: an epic past the cut tracks its
// children invisibly, so each of them reads as tracked by nothing. Acted on as Tier A, that absence
// puts a **second** epic over an issue one already tracks — the state `fullrun.md` forbids, because
// the auto-close then has two task lists to disagree about and `epic:next` answers from two graphs
// (joshuafolkken/kit#943).
//
// A membership that *was* found is untouched, and that is the whole of what survives a cut: `none`
// reporting `#E already tracks this issue` read the epic it names, and more epics past the cut cannot
// unseat it.
//
// The cut is the whole condition, and deliberately so. An epic the listing answered without a body
// would hide its children the same way, but it cannot arrive: the listing mapping coerces a REST
// `null` body to `''` before this module's caller ever parses one (`git-gh-issue-rest.ts`,
// `to_gh_field_value`), so a gate arm for it would be code no input can reach
// (joshuafolkken/kit#1697).
function is_membership_established(cutoff: ScanCutoff): boolean {
	return cutoff === 'none'
}

// Not a placement, and not `Nothing to bundle.` either: the command has an answer about the
// candidates and no answer about which epics they and the subject sit in. The headline says which of
// the two, because a run reads the first line and acts on it.
const UNCONFIRMED_MEMBERSHIP_LINE =
	'Could not confirm which epic already tracks these — do not place this issue in one.'

const UNCONFIRMED_MEMBERSHIP_REASON =
	'the epics were not read in full, so an epic already tracking one of these may never have been seen'

// The whole verdict for that case. The children and the declared order are deliberately absent: they
// are the recipe for the placement this line says not to make.
function unconfirmed_membership(related: string): Array<string> {
	return [
		UNCONFIRMED_MEMBERSHIP_LINE,
		`  ${UNCONFIRMED_MEMBERSHIP_REASON}`,
		`  Related: ${related}`,
	]
}

const epic_bundle_gaps = {
	backlog_gap,
	epic_gap,
	is_membership_established,
	UNCONFIRMED_MEMBERSHIP_LINE,
	unconfirmed_membership,
}

export { epic_bundle_gaps }
