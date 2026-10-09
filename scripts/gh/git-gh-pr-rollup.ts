import { parse_json_array_or_undefined } from '#scripts/git/parse-json-array'
import { z } from 'zod'

// The two REST listings `gh pr view --json statusCheckRollup` served as one array, merged back into
// that one array.
//
// `gh` answered a single `statusCheckRollup` whose elements were of two kinds; REST splits them
// across `commits/{sha}/check-runs` (`status` / `conclusion` / `name`) and `commits/{sha}/status`
// (`state` / `context`). The merge is pure — given the two responses it decides the answer with
// nothing else to know — so it lives here rather than beside the requests.

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

// Both `app` and `check_suite` are objects carrying a numeric `id`, and so is a check run itself.
const id_holder_schema = z.object({ id: z.number() })

const status_page_schema = z.looseObject({
	statuses: z.array(rollup_element_schema),
})

type RollupElement = z.infer<typeof rollup_element_schema>

const NOT_A_CHECK_RUNS_LISTING = 'gh api answered something other than a check run listing'
const NOT_A_STATUS_LISTING = 'gh api answered something other than a commit status listing'

// A response that will not parse throws rather than degrading to an empty rollup. The direction is
// what makes it worth the throw: an empty rollup reads as "this pull request has no checks", and
// `git-pr-followup.ts` treats that as a reason to stop watching rather than as a failure — so a rate
// limit would arrive as a pull request nothing was ever required to pass.
function read_pages<T>(raw_json: string, schema: z.ZodType<T>, message: string): Array<T> {
	const pages = parse_json_array_or_undefined(raw_json, schema)
	if (pages === undefined) throw new Error(message)

	return pages
}

const NO_SUITE = -1

interface RunRank {
	suite: number
	run: number
}

function read_id(value: unknown): number | undefined {
	const parsed = id_holder_schema.safeParse(value)

	return parsed.success ? parsed.data.id : undefined
}

function check_run_group_key(run: RollupElement): string | undefined {
	const { name, app } = run
	if (typeof name !== 'string') return undefined

	return JSON.stringify([name, read_id(app)])
}

function read_rank(run: RollupElement): RunRank | undefined {
	const id = read_id(run)
	if (id === undefined) return undefined

	return { suite: read_id(run['check_suite']) ?? NO_SUITE, run: id }
}

// **The newest check suite decides a name, not the newest check run** — the rule GitHub's merge box
// applies. The endpoint's default `filter=latest` already keeps only the newest run of each name
// *within* a suite (a re-run job lands in the suite it re-runs), so what is left is one run per
// suite. Across suites GitHub takes the one from the newer suite: PR #2717's cancelled suite was the
// older one and GitHub read the pull request `CLEAN`, while PR #2698's cancelled suite was the newer
// one and GitHub held it `BLOCKED`. Ranking by run id alone picked #2698's
// older, successful suite — its jobs had queued later — so `followup` read green beside a `BLOCKED`
// pull request and waited out its whole budget.
function is_ranked_above(candidate: RunRank, current: RunRank): boolean {
	if (candidate.suite !== current.suite) return candidate.suite > current.suite

	return candidate.run > current.run
}

function should_replace(previous: RollupElement | undefined, rank: RunRank): boolean {
	const previous_rank = previous === undefined ? undefined : read_rank(previous)

	return previous_rank === undefined || is_ranked_above(rank, previous_rank)
}

function remember_newest_run(run: RollupElement, newest: Map<string, RollupElement>): void {
	const key = check_run_group_key(run)
	const rank = read_rank(run)
	if (key === undefined || rank === undefined) return
	if (should_replace(newest.get(key), rank)) newest.set(key, run)
}

// A run with no name or id cannot be ranked, so it is kept rather than guessed to be superseded.
function is_newest_run(run: RollupElement, newest: Map<string, RollupElement>): boolean {
	const key = check_run_group_key(run)
	if (key === undefined || read_rank(run) === undefined) return true

	return newest.get(key) === run
}

function to_check_run_items(check_runs_json: string): Array<RollupElement> {
	const pages = read_pages(check_runs_json, check_runs_page_schema, NOT_A_CHECK_RUNS_LISTING)
	const runs = pages.flatMap((page) => page.check_runs)
	const newest = new Map<string, RollupElement>()
	for (const run of runs) remember_newest_run(run, newest)

	return runs.filter((run) => is_newest_run(run, newest))
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
	to_status_check_rollup,
}

export {
	git_gh_pr_rollup,
	to_status_check_rollup,
	NOT_A_CHECK_RUNS_LISTING,
	NOT_A_STATUS_LISTING,
	STATUS_CONTEXT_TYPE_NAME,
}
