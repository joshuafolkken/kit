import { z } from 'zod'
import { parse_json_array_or_undefined } from './parse-json-array'

// The two REST listings `gh pr view --json statusCheckRollup` served as one array, merged back into
// that one array.
//
// `gh` answered a single `statusCheckRollup` whose elements were of two kinds; REST splits them
// across `commits/{sha}/check-runs` (`status` / `conclusion` / `name`) and `commits/{sha}/status`
// (`state` / `context`). The merge is pure — given the two responses it decides the answer with
// nothing else to know — so it lives here rather than beside the requests (joshuafolkken/kit#1028).

// `__typename` is what `git-pr-checks-parse.ts` distinguishes the two kinds by, and only the status
// contexts carry it: the parser's default branch is the check run, so a check run needs no marker
// while a status context without one is read as a check run, finds no `status`, and reports as
// `pending` forever.
const STATUS_CONTEXT_TYPE_NAME = 'StatusContext'
const TYPE_NAME_KEY = '__typename'

// Every field passes through untouched — the parser reads five of them and lower-cases each, so the
// REST spelling (`completed` / `success`) needs no conversion to match what `gh` sent in upper case.
const rollup_element_schema = z.looseObject({})

// Both endpoints answer an *object* wrapping the listing, so the reads page them with `--paginate
// --slurp` and each arrives as an array of pages (`git-gh-exec.ts` → `GhApiRequest`). A repository
// with more checks than one page holds is the case this exists for: without the concatenation the
// merge gate would judge a pull request on its first 30 checks.
const check_runs_page_schema = z.looseObject({
	// Required, not optional: GitHub always names the key, and accepting a page without one would
	// answer an empty rollup — which `git-pr-followup.ts` reports as "this branch has no checks".
	check_runs: z.array(rollup_element_schema),
})

const status_page_schema = z.looseObject({
	statuses: z.array(rollup_element_schema),
})

type RollupElement = z.infer<typeof rollup_element_schema>

const NOT_A_CHECK_RUNS_LISTING = 'gh api answered something other than a check run listing'
const NOT_A_STATUS_LISTING = 'gh api answered something other than a commit status listing'

// A response that will not parse throws rather than degrading to an empty rollup. The direction is
// what makes it worth the throw: an empty rollup reads as "this pull request has no checks", and
// `git-pr-followup.ts` treats that as a reason to stop watching rather than as a failure — so a rate
// limit would arrive as a pull request nothing was ever required to pass (joshuafolkken/kit#973).
function read_pages<T>(raw_json: string, schema: z.ZodType<T>, message: string): Array<T> {
	const pages = parse_json_array_or_undefined(raw_json, schema)
	if (pages === undefined) throw new Error(message)

	return pages
}

function to_check_run_items(check_runs_json: string): Array<RollupElement> {
	const pages = read_pages(check_runs_json, check_runs_page_schema, NOT_A_CHECK_RUNS_LISTING)

	return pages.flatMap((page) => page.check_runs)
}

function to_status_context_items(status_json: string): Array<RollupElement> {
	const pages = read_pages(status_json, status_page_schema, NOT_A_STATUS_LISTING)

	return pages
		.flatMap((page) => page.statuses)
		.map((status) => ({ ...status, [TYPE_NAME_KEY]: STATUS_CONTEXT_TYPE_NAME }))
}

// Check runs first, then the status contexts — the order `gh` used, and the order
// `read_required_statuses` reads when two entries share a name.
function to_status_check_rollup(input: {
	check_runs_json: string
	status_json: string
}): Array<RollupElement> {
	return [
		...to_check_run_items(input.check_runs_json),
		...to_status_context_items(input.status_json),
	]
}

const git_gh_pr_rollup = {
	to_check_run_items,
	to_status_context_items,
	to_status_check_rollup,
}

export type { RollupElement }
export {
	git_gh_pr_rollup,
	to_status_check_rollup,
	NOT_A_CHECK_RUNS_LISTING,
	NOT_A_STATUS_LISTING,
	STATUS_CONTEXT_TYPE_NAME,
}
