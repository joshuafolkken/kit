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
const ISSUES_PATH = 'repos/{owner}/{repo}/issues'
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
	updated_at: z.string().nullish(),
	head: z.object({ ref: z.string().nullish(), sha: z.string().nullish() }).nullish(),
})

const PULLS_SCHEMA = z.array(PULL_SCHEMA)

// `conclusion` is what GitHub calls the check's outcome — `success`, `failure`, `skipped`,
// `cancelled`, `neutral`, `timed_out`. It is `null` until the run completes, and this module only
// keeps completed runs, so an empty one here means GitHub sent no outcome at all rather than that the
// job is still going (joshuafolkken/kit#1310).
const CHECK_RUN_SCHEMA = z.object({
	name: z.string().nullish(),
	conclusion: z.string().nullish(),
	started_at: z.string().nullish(),
	completed_at: z.string().nullish(),
})

const CHECK_RUNS_SCHEMA = z.object({ check_runs: z.array(CHECK_RUN_SCHEMA).nullish() })

const ISSUE_SCHEMA = z.object({ body: z.string().nullish() })

// A pull request as this command needs it. `merged_ms` is `undefined` for one that is still open —
// never `0`, which would read as "merged at the epoch" and silently produce a negative CI wait.
//
// `updated_ms` is what the listing is sorted by, and it is carried for one reason: it is the only
// thing that proves the walk below may stop (joshuafolkken/kit#1279). It is `undefined` for a row
// whose `updated_at` could not be read, which costs one more request rather than a wrong answer.
interface PullSummary {
	number: number
	branch: string
	head_sha: string
	created_ms: number
	merged_ms: number | undefined
	updated_ms: number | undefined
}

interface CheckRun {
	name: string
	// The outcome GitHub reported, empty where it reported none. Carried as the raw string rather than
	// as a parsed enum: a conclusion this code has never heard of still has to reach the reader, and a
	// narrowing schema would drop the whole row for it.
	conclusion: string
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
		updated_ms: time_instant.parse_instant(raw.updated_at),
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

// What one page's rows say about the answer, in two parts rather than one.
//
// `best` is the best candidate seen so far — this page folded into whatever the pages before it
// offered — and `is_certain` says whether a later page could still beat it. **The second half is
// what a candidate alone cannot express.** Without it the walk stopped at the first page holding
// any candidate at all, which is right for a branch match and wrong for a merge: the listing is
// sorted by update time, so a pull request merged yesterday and commented on today sits above the
// one merged an hour ago, and the newest merge falls to page two (joshuafolkken/kit#1279).
//
// **The candidate is a type parameter, because a batch's candidate is not one pull request**
// (joshuafolkken/kit#1292). An epic's children are all answered from this same listing, so what is
// carried across pages there is the index built so far — and writing that as a second walk would
// page the same listing twice in two slightly different ways.
interface PullFold<Candidate> {
	best: Candidate
	is_certain: boolean
}

// Which rows of a page answer the question, given what the pages before it offered. A fold rather
// than a predicate, because the lookups differ in more than a test: one wants the *latest* merge
// across every page read, another every issue an epic asked about — and `Array#find` cannot express
// either.
type PullFolder<Candidate> = (
	pulls: ReadonlyArray<PullSummary>,
	best: Candidate,
) => PullFold<Candidate>

// The single-pull instantiation, named because it is what the merge lookup below folds with.
type PullChoice = PullFold<PullSummary | undefined>
type PullChooser = PullFolder<PullSummary | undefined>

// How the walk ended, carried out rather than turned into an answer inside it. **The three "not
// found" reasons are properties of the walk, not of a candidate**, and a batch needs them after the
// fact: one walk answers many issues, and each issue that went unresolved inherits the same ending.
type WalkEnd = 'settled' | 'ended' | 'capped' | 'failed'

const WALK_SETTLED: WalkEnd = 'settled'
const WALK_ENDED: WalkEnd = 'ended'
const WALK_CAPPED: WalkEnd = 'capped'
const WALK_FAILED: WalkEnd = 'failed'

interface PullWalk<Candidate> {
	best: Candidate
	end: WalkEnd
}

// One page at a time, and the next one only if this one left the answer open. Written as a walk
// forward rather than as parallel requests because the answer is almost always certain on the first
// page: firing five to discard four spends someone's rate limit to save nothing.
//
// **The cap is reported, never answered.** Handing the best unproven candidate back as though the
// walk had settled would be indistinguishable from a proven one, so `time-run.ts` would print an
// older merge as "the run that just finished" with no sign that 500 rows were read without settling
// it. `WALK_CAPPED` is what makes the caller say "not found among the 500 most recently updated"
// instead, which is the true sentence.
async function walk_from_page<Candidate>(
	page: number,
	fold: PullFolder<Candidate>,
	read: GhReader,
	best: Candidate,
): Promise<PullWalk<Candidate>> {
	const read_page = await read_pulls_page(page, read)

	if (read_page === undefined) return { best, end: WALK_FAILED }

	const folded = fold(read_page.pulls, best)

	if (folded.is_certain) return { best: folded.best, end: WALK_SETTLED }
	if (read_page.row_count < PAGE_SIZE) return { best: folded.best, end: WALK_ENDED }
	if (page >= MAX_PAGES) return { best: folded.best, end: WALK_CAPPED }

	return await walk_from_page(page + 1, fold, read, folded.best)
}

// The walk over the listing that `fold` answers from. Every lookup in this command is this walk with
// a different fold — the merge below, and the per-issue index in `time-pull-index.ts`.
async function walk_pulls<Candidate>(
	fold: PullFolder<Candidate>,
	read: GhReader,
	best: Candidate,
): Promise<PullWalk<Candidate>> {
	return await walk_from_page(FIRST_PAGE, fold, read, best)
}

// The three answers that are not a pull request, read off how the walk ended rather than decided
// again by each caller. `WALK_ENDED` proves an absence as well as `WALK_SETTLED` does, because with
// the listing exhausted there is nothing left that could have matched.
function absent_search(end: WalkEnd): PullSearch {
	if (end === WALK_FAILED) return FAILED
	if (end === WALK_CAPPED) return CAPPED

	return NOT_FOUND
}

function to_search(walk: PullWalk<PullSummary | undefined>): PullSearch {
	if (walk.best === undefined || walk.end === WALK_FAILED || walk.end === WALK_CAPPED) {
		return absent_search(walk.end)
	}

	return to_found(walk.best)
}

async function find_pull(choose: PullChooser, read: GhReader): Promise<PullSearch> {
	return to_search(await walk_pulls(choose, read, undefined))
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

// The oldest update on a page. The listing is sorted by update time descending, so this is the
// boundary every later page sits below. A row whose `updated_at` could not be read is left out,
// which can only raise the boundary and so can only make the walk read one more page.
function oldest_update(pulls: ReadonlyArray<PullSummary>): number | undefined {
	const stamps = pulls.map((pull) => pull.updated_ms).filter((ms): ms is number => ms !== undefined)

	return stamps.length === 0 ? undefined : Math.min(...stamps)
}

// Whether a later page could still hold a newer merge. **A merged pull request always carries
// `updated_at >= merged_at`** — the merge is itself an update — so once this page's oldest update
// is no newer than the best merge seen, every row after it in an update-sorted listing was last
// touched before that merge, and none of them can be a newer one. Checked against all 485 merged
// rows in the five pages this walk can read, on 2026-09-04.
//
// **The proof is what keeps the ordinary case at one request.** Reading all `MAX_PAGES` and taking
// the global maximum is the other correct answer, and it costs five requests every time to fix a
// case that arises when more than a page of pull requests were updated after the newest merge.
function is_merge_certain(
	pulls: ReadonlyArray<PullSummary>,
	best: PullSummary | undefined,
): boolean {
	const merged_ms = best?.merged_ms
	const oldest_ms = oldest_update(pulls)

	if (merged_ms === undefined || oldest_ms === undefined) return false

	return oldest_ms <= merged_ms
}

// The newest merge across this page and every page before it, and whether that is settled. The
// candidate from earlier pages is folded in as one more row so the comparison stays
// `newest_merged`'s alone rather than being written a second time here.
function newest_merged_choice(
	pulls: ReadonlyArray<PullSummary>,
	best: PullSummary | undefined,
): PullChoice {
	const merged = newest_merged(best === undefined ? pulls : [...pulls, best])

	return { best: merged, is_certain: is_merge_certain(pulls, merged) }
}

// The most recently merged pull request — "the run that just finished", which is what
// `pnpm josh time` with no argument reports on.
async function latest_merged_pull(read: GhReader = read_gh): Promise<PullSearch> {
	return await find_pull(newest_merged_choice, read)
}

function to_check_run(raw: z.infer<typeof CHECK_RUN_SCHEMA>): CheckRun | undefined {
	const started_ms = time_instant.parse_instant(raw.started_at)
	const completed_ms = time_instant.parse_instant(raw.completed_at)

	if (started_ms === undefined || completed_ms === undefined) return undefined

	return { name: raw.name ?? '', conclusion: raw.conclusion ?? '', started_ms, completed_ms }
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

// One issue's body — the epic's task list, for the batch scope (joshuafolkken/kit#1271). What is
// done with it belongs to `git-epic-parse.ts`, which is the one reader of a task list; this only
// fetches the text.
//
// **`undefined` is "the read failed", and an issue with an empty body answers `''`.** Collapsing the
// two would report an unauthenticated `gh` as an epic that tracks no children — a definite answer
// nobody established, which is the distinction this module keeps everywhere else.
async function read_issue_body(
	issue_number: number,
	read: GhReader = read_gh,
): Promise<string | undefined> {
	try {
		const text = await read(`${ISSUES_PATH}/${String(issue_number)}`)
		const parsed = ISSUE_SCHEMA.safeParse(json_value.parse_or_undefined(text))

		return parsed.success ? (parsed.data.body ?? '') : undefined
	} catch {
		return undefined
	}
}

const time_github = {
	MAX_PAGES,
	PAGE_SIZE,
	read_gh,
	read_issue_body,
	parse_page,
	parse_pulls,
	parse_check_runs,
	pulls_page_path,
	newest_merged,
	newest_merged_choice,
	FAILED_SEARCH: FAILED,
	absent_search,
	to_found,
	walk_pulls,
	find_pull,
	latest_merged_pull,
	list_check_runs,
}

export type {
	CheckRun,
	GhReader,
	PullChoice,
	PullFold,
	PullFolder,
	PullSearch,
	PullsPage,
	PullSummary,
	PullWalk,
	WalkEnd,
}
export { time_github }
