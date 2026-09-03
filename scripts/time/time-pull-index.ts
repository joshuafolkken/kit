import { cost_attribute } from '#scripts/cost/cost-attribute'
import {
	time_github,
	type GhReader,
	type PullFold,
	type PullSearch,
	type PullSummary,
	type PullWalk,
} from './time-github'

// Which pull request belongs to which issue, from one walk over the listing
// (joshuafolkken/kit#1292).
//
// **The listing used to be paged once per issue, and `--epic` is once per child.** Each child's
// report searched the same `state=all&sort=updated` listing for its own head branch, so epic #1272
// paged it thirteen times — 21 requests, of which 10 were the two children with no pull request
// reading all five pages each to establish that. Nothing about the second walk could differ from the
// first: the 500 rows are the same, only the branch they are searched for changes. It is the
// duplication joshuafolkken/kit#1284 removed from the transcript side, one data source over, and the
// larger half of the two — the pages were about 40 of the 46 seconds `--epic 1272` took.
//
// **So the issue number moves inside the walk.** One pass reads each page once and hands every row
// to whichever issue its head branch names. One issue asked about is the same walk with a list of
// one, which is why `--issue` reads exactly what it read before and there is no second lookup that
// could disagree with this one.
//
// The check-run reads stay per child, and deliberately: they are keyed on each pull request's own
// head sha, so there is no shared listing for them to be pulled out of.

const NO_ISSUES = 0

// The issues asked about, and the answer found for each so far. `wanted` is a set rather than a
// list so a number repeated in an epic's task list is answered once rather than searched for twice.
interface PullIndex {
	wanted: ReadonlySet<number>
	found: Map<number, PullSummary>
}

// Which issue a head branch names is `cost_attribute.issue_from_branch`'s rule and never a second
// one: `josh git` names a branch `<N>-<slug>`, and the transcript side attributes spans by exactly
// this reading — a copy here is how the two halves of a run would come to disagree about which issue
// they belong to.
//
// **The first row wins, and the pages arrive in order**, which is the answer the per-issue search
// gave: it took the first matching row of the first page that held one.
function index_pulls(index: PullIndex, pulls: ReadonlyArray<PullSummary>): void {
	for (const pull of pulls) {
		const issue_number = cost_attribute.issue_from_branch(pull.branch)

		if (index.wanted.has(issue_number) && !index.found.has(issue_number)) {
			index.found.set(issue_number, pull)
		}
	}
}

// This page folded into the index, and whether the walk may stop. **A branch match is certain the
// moment it is found** — `josh git` names one branch after one issue, so no later page can offer a
// better one — which is why an entry is never revised and the walk stops as soon as the last issue
// asked about has landed.
function index_choice(pulls: ReadonlyArray<PullSummary>, index: PullIndex): PullFold<PullIndex> {
	index_pulls(index, pulls)

	return { best: index, is_certain: index.found.size === index.wanted.size }
}

// One search result per issue asked about. **An issue found before the walk hit a failure, the cap
// or the end of the listing keeps its answer**, exactly as it did when it had a walk of its own that
// stopped on the page holding its branch; only the issues still unresolved inherit how the walk
// ended.
function to_searches(walk: PullWalk<PullIndex>): Map<number, PullSearch> {
	const searches = new Map<number, PullSearch>()

	for (const issue_number of walk.best.wanted) {
		const pull = walk.best.found.get(issue_number)

		searches.set(
			issue_number,
			pull === undefined ? time_github.absent_search(walk.end) : time_github.to_found(pull),
		)
	}

	return searches
}

// Every issue's pull request, from one walk however many issues are asked about. An issue with none
// is present with its own reason rather than absent — "there is none", "the read failed" and "not
// among the 500 most recently updated" are three different answers, and a caller that had to tell
// them apart from "not asked for" would be re-deriving them.
//
// **Nothing asked means nothing read**, the rule `time-corpus.ts` states for the transcript side: an
// epic whose task list names no issue in this repository would otherwise page the whole listing to
// build an empty map.
async function pulls_for_issues(
	issue_numbers: ReadonlyArray<number>,
	read: GhReader = time_github.read_gh,
): Promise<Map<number, PullSearch>> {
	const index: PullIndex = { wanted: new Set(issue_numbers), found: new Map() }

	if (index.wanted.size === NO_ISSUES) return new Map()

	return to_searches(await time_github.walk_pulls(index_choice, read, index))
}

// One issue's pull request — the same walk with a list of one, and never a second implementation of
// it. The fallback cannot be reached: `pulls_for_issues` answers every number it was asked about,
// which `time-pull-index.test.ts` pins.
async function pull_for_issue(
	issue_number: number,
	read: GhReader = time_github.read_gh,
): Promise<PullSearch> {
	const searches = await pulls_for_issues([issue_number], read)

	return searches.get(issue_number) ?? time_github.FAILED_SEARCH
}

const time_pull_index = {
	index_choice,
	pulls_for_issues,
	pull_for_issue,
}

export type { PullIndex }
export { time_pull_index }
