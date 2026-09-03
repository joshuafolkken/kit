import { git_gh_exec } from '#scripts/git/git-gh-exec'
import { json_value } from '#scripts/json-value'
import { z } from 'zod'
import { time_instant } from './time-instant'

// The half of a run's wall clock that no transcript records (joshuafolkken/kit#1268).
//
// A `fullrun` ends at the merge, and the interval from the pull request opening to that merge — CI
// running, the gate polling, the merge itself — leaves no line in any session file. Measured on
// PR #1263: `createdAt 08:57:20Z → mergedAt 09:00:32Z`, 3 minutes 12 seconds that `josh time` could
// not see at all. So the timestamps come from GitHub, and the join with the transcript side is
// `time-run.ts`'s.
//
// **Every read goes through `git_gh_exec.exec_gh_api`** — the same REST layer, the same request
// budget, the same error translation as every other GitHub access kit makes. The reader is a
// parameter rather than a hard-wired import so the tests exercise the parsing and the paging without
// a network: a test that has to reach GitHub to prove the pagination stops is a test nobody runs.

const PULLS_PATH = 'repos/{owner}/{repo}/pulls'
const CHECK_RUNS_PATH = 'repos/{owner}/{repo}/commits'
const PAGE_SIZE = 100

// Five pages, 500 pull requests. **A cap rather than `--paginate`**, because the question is always
// about a recent run and walking a repository's whole history to answer it costs one request per
// hundred pull requests ever opened. When the cap is reached without a match the caller says so in
// words — "not found in the most recent 500" is a different answer from "there is none", and only
// the first one is true here.
const MAX_PAGES = 5

const FIRST_PAGE = 1

const PULL_SCHEMA = z.object({
	number: z.number(),
	created_at: z.string().nullish(),
	merged_at: z.string().nullish(),
	head: z.object({ ref: z.string().nullish(), sha: z.string().nullish() }).nullish(),
})

const PULLS_SCHEMA = z.array(PULL_SCHEMA)

const CHECK_RUN_SCHEMA = z.object({
	name: z.string().nullish(),
	started_at: z.string().nullish(),
	completed_at: z.string().nullish(),
})

const CHECK_RUNS_SCHEMA = z.object({ check_runs: z.array(CHECK_RUN_SCHEMA).nullish() })

// A pull request as this command needs it. `merged_ms` is `undefined` for one that is still open —
// never `0`, which would read as "merged at the epoch" and silently produce a negative CI wait.
interface PullSummary {
	number: number
	branch: string
	head_sha: string
	created_ms: number
	merged_ms: number | undefined
}

interface CheckRun {
	name: string
	started_ms: number
	completed_ms: number
}

// How a request is made. `git_gh_exec.exec_gh_api` is the production one; a test passes its own.
type GhReader = (path: string) => Promise<string>

async function read_gh(path: string): Promise<string> {
	return await git_gh_exec.exec_gh_api({ path })
}

// The head ref and sha, defaulted in one place. A pull request whose head repository has been
// deleted carries a null `head`, and reading through it twice at the call site is what pushed the
// branch count past the limit.
function head_of(raw: z.infer<typeof PULL_SCHEMA>): { branch: string; head_sha: string } {
	const { head } = raw

	return { branch: head?.ref ?? '', head_sha: head?.sha ?? '' }
}

function to_pull(raw: z.infer<typeof PULL_SCHEMA>): PullSummary | undefined {
	const created_ms = time_instant.parse_instant(raw.created_at)

	if (created_ms === undefined) return undefined

	return {
		number: raw.number,
		...head_of(raw),
		created_ms,
		merged_ms: time_instant.parse_instant(raw.merged_at),
	}
}

// One page, with the count of rows GitHub actually sent beside the ones that could be read.
//
// **The two numbers are not the same, and only the raw one says where the listing ends.** A page is
// the last one when GitHub returned fewer than `PAGE_SIZE` *rows* — measuring the filtered array
// instead makes one undated row on a full page look like the end of the listing, and the walk then
// reports a definite absence it never established.
interface PullsPage {
	pulls: Array<PullSummary>
	row_count: number
}

// A body that does not parse yields `undefined`, which the walk treats as a failed read rather than
// as an empty page. `gh` exiting 0 with a body the schema rejects — a shape change, an error object
// — is a read nobody got an answer from, and reporting it as "there is no such pull request" is the
// same laundering as swallowing a 403.
function parse_page(text: string): PullsPage | undefined {
	const parsed = PULLS_SCHEMA.safeParse(json_value.parse_or_undefined(text))

	if (!parsed.success) return undefined

	return {
		pulls: parsed.data
			.map((raw) => to_pull(raw))
			.filter((pull): pull is PullSummary => pull !== undefined),
		row_count: parsed.data.length,
	}
}

function parse_pulls(text: string): Array<PullSummary> {
	return parse_page(text)?.pulls ?? []
}

function pulls_page_path(page: number): string {
	return `${PULLS_PATH}?state=all&sort=updated&direction=desc&per_page=${String(PAGE_SIZE)}&page=${String(page)}`
}

// One page, or nothing at all when the request failed. **A failure is not an empty page**: an empty
// page is the end of the listing, and conflating the two turns an unauthenticated or rate-limited
// `gh` into an authoritative "there is no such pull request" — the very distinction this module
// exists to keep.
async function read_pulls_page(page: number, read: GhReader): Promise<PullsPage | undefined> {
	try {
		return parse_page(await read(pulls_page_path(page)))
	} catch {
		return undefined
	}
}

// What the walk over the pages produced, in three states rather than two.
//
// `is_exhausted` distinguishes "there is no such pull request" from "it may sit past the 500 that
// were read", and `is_failed` distinguishes both of those from "nobody got an answer at all". The
// second and third are not answers, and reporting either as the first is the silent zero this
// command exists to remove.
interface PullSearch {
	pull: PullSummary | undefined
	is_exhausted: boolean
	is_failed: boolean
}

const NOT_FOUND: PullSearch = { pull: undefined, is_exhausted: true, is_failed: false }
const CAPPED: PullSearch = { pull: undefined, is_exhausted: false, is_failed: false }
const FAILED: PullSearch = { pull: undefined, is_exhausted: false, is_failed: true }

function to_found(pull: PullSummary): PullSearch {
	return { pull, is_exhausted: false, is_failed: false }
}

// Which row of a page answers the question. A chooser rather than a predicate, because the two
// lookups below differ in more than a test: one wants the first branch that matches, the other the
// *latest* merge on the page — and `Array#find` cannot express the second.
type PullChooser = (pulls: ReadonlyArray<PullSummary>) => PullSummary | undefined

// One page at a time, and the next one only if this one did not answer. Written as a walk forward
// rather than as parallel requests because the match is almost always on the first page: firing five
// to discard four spends someone's rate limit to save nothing.
async function find_from_page(
	page: number,
	choose: PullChooser,
	read: GhReader,
): Promise<PullSearch> {
	const read_page = await read_pulls_page(page, read)

	if (read_page === undefined) return FAILED

	const picked = choose(read_page.pulls)

	if (picked !== undefined) return to_found(picked)
	if (read_page.row_count < PAGE_SIZE) return NOT_FOUND

	return page >= MAX_PAGES ? CAPPED : await find_from_page(page + 1, choose, read)
}

// The first page the listing offers that `choose` answers from. Both lookups below are this walk
// with a different chooser; writing them separately would page the same listing twice in two
// slightly different ways.
async function find_pull(choose: PullChooser, read: GhReader): Promise<PullSearch> {
	return await find_from_page(FIRST_PAGE, choose, read)
}

// The pull request that closes an issue, found by its head branch. `josh git` names a branch
// `<N>-<slug>`, so the branch is the link — the same fact `cost_attribute.issue_from_branch` reads
// on the transcript side, which is why both halves of a run agree on which issue they belong to.
async function pull_for_branch_prefix(
	issue_number: number,
	read: GhReader = read_gh,
): Promise<PullSearch> {
	const prefix = `${String(issue_number)}-`

	return await find_pull((pulls) => pulls.find((pull) => pull.branch.startsWith(prefix)), read)
}

// The latest merge on a page, not the first merged row on it. **The listing is sorted by update
// time, and "most recently updated that happens to be merged" is not "most recently merged"**: one
// comment on a pull request merged yesterday lifts it above the one merged an hour ago, and
// `pnpm josh time` with no argument would then report yesterday's run. GitHub offers no
// merged-time sort, so the ordering is imposed here over the rows already fetched.
function newest_merged(pulls: ReadonlyArray<PullSummary>): PullSummary | undefined {
	return pulls
		.filter((pull) => pull.merged_ms !== undefined)
		.toSorted((left, right) => (right.merged_ms ?? 0) - (left.merged_ms ?? 0))[0]
}

// The most recently merged pull request — "the run that just finished", which is what
// `pnpm josh time` with no argument reports on.
async function latest_merged_pull(read: GhReader = read_gh): Promise<PullSearch> {
	return await find_pull(newest_merged, read)
}

function to_check_run(raw: z.infer<typeof CHECK_RUN_SCHEMA>): CheckRun | undefined {
	const started_ms = time_instant.parse_instant(raw.started_at)
	const completed_ms = time_instant.parse_instant(raw.completed_at)

	if (started_ms === undefined || completed_ms === undefined) return undefined

	return { name: raw.name ?? '', started_ms, completed_ms }
}

function parse_check_runs(text: string): Array<CheckRun> {
	const parsed = CHECK_RUNS_SCHEMA.safeParse(json_value.parse_or_undefined(text))

	if (!parsed.success) return []

	return (parsed.data.check_runs ?? [])
		.map((raw) => to_check_run(raw))
		.filter((run): run is CheckRun => run !== undefined)
}

// Each CI job's own start and finish, for the per-check table. **These overlap each other** — the
// jobs run in parallel — so they are reported as durations and never summed into a share; the CI
// wait itself is measured from the pull request's own window in `time-run.ts`.
async function list_check_runs(
	head_sha: string,
	read: GhReader = read_gh,
): Promise<Array<CheckRun>> {
	if (head_sha === '') return []

	try {
		return parse_check_runs(
			await read(`${CHECK_RUNS_PATH}/${head_sha}/check-runs?per_page=${String(PAGE_SIZE)}`),
		)
	} catch {
		return []
	}
}

const time_github = {
	MAX_PAGES,
	PAGE_SIZE,
	read_gh,
	parse_page,
	parse_pulls,
	parse_check_runs,
	pulls_page_path,
	newest_merged,
	find_pull,
	pull_for_branch_prefix,
	latest_merged_pull,
	list_check_runs,
}

export type { CheckRun, GhReader, PullSearch, PullsPage, PullSummary }
export { time_github }
