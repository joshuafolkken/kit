import { describe, expect, it } from 'vitest'
import { time_github, type GhReader, type PullSearch } from './time-github'

const { PAGE_SIZE } = time_github
const CREATED = '2026-09-03T08:57:20Z'
const MERGED = '2026-09-03T09:00:32Z'
const SHA = 'abc123'
const ISSUE_BRANCH = '1268-measure-a-run'
const ISSUE = 1268

interface RawPull {
	number: number
	created_at: string
	merged_at: string
	updated_at: string
	head: { ref: string; sha: string }
}

// `updated_at` defaults to the merge instant, which is what GitHub sends for a pull request nothing
// has touched since it merged. A fixture that wants the awkward case — merged long ago, commented
// on today — says so by passing both.
function raw_pull(
	pull_number: number,
	branch: string,
	merged_at: string = MERGED,
	updated_at: string = merged_at,
): RawPull {
	return {
		number: pull_number,
		created_at: CREATED,
		merged_at,
		updated_at,
		head: { ref: branch, sha: SHA },
	}
}

// An open pull request carries a JSON `null`, which is what GitHub sends and what the schema's
// `nullish` exists for. Written as text rather than as a `null` literal so the fixture states the
// wire format instead of a language value.
function raw_json(pull_number: number, branch: string, merged_at: string): string {
	return `{"number":${String(pull_number)},"created_at":"${CREATED}","merged_at":"${merged_at}","updated_at":"${merged_at}","head":{"ref":"${branch}","sha":"${SHA}"}}`
}

const OPEN_PULL_ROW = `{"number":2,"created_at":"${CREATED}","merged_at":null,"updated_at":"${CREATED}","head":{"ref":"2-open","sha":"${SHA}"}}`
const OPEN_PULL_JSON = `[${OPEN_PULL_ROW}]`
// The open one first, so a lookup that took the first row rather than the first *merged* row would
// answer with a pull request that has no merge instant at all.
const MERGED_PULL_ROW = raw_json(1, ISSUE_BRANCH, MERGED)
// Merged a day earlier, so a listing sorted by update time can legitimately put it first.
const OLDER_PULL_ROW = raw_json(3, '3-older', '2026-09-02T00:00:00Z')
const MIXED_PULLS_JSON = `[${OPEN_PULL_ROW},${MERGED_PULL_ROW}]`

// A reader that answers each requested path from a fixed script, and records what was asked for. The
// whole point of injecting it is that the paging, the cap and the parsing are provable without a
// network — a test that has to reach GitHub to prove the pagination stops is a test nobody runs.
function reader(pages: ReadonlyArray<ReadonlyArray<RawPull>>, asked: Array<string> = []): GhReader {
	return async (request_path: string) => {
		asked.push(request_path)

		// Anchored on the separator: `per_page=100` sits in front of `page=` in the same query string,
		// and an unanchored match reads the page size as the page number. A positional capture rather
		// than a named one, because a named group is read through an index signature that the type
		// check wants bracketed and the lint's dot-notation rule rewrites back.
		const found = /[&?]page=(\d+)/u.exec(request_path)?.[1]
		const index = found === undefined ? 0 : Number(found) - 1

		return JSON.stringify(pages[index] ?? [])
	}
}

function body_reader(body: string): GhReader {
	return async () => body
}

async function refuse(): Promise<string> {
	throw new Error('gh: 403')
}

function other_pull(index: number): RawPull {
	const branch = `9${String(index)}-other`

	return raw_pull(index + 1, branch)
}

const PAGE_INDICES = Array.from({ length: PAGE_SIZE }, (_, index) => index)

function filled_page(): Array<RawPull> {
	return PAGE_INDICES.map((index) => other_pull(index))
}

async function search_issue(pages: ReadonlyArray<ReadonlyArray<RawPull>>): Promise<PullSearch> {
	return await time_github.pull_for_branch_prefix(ISSUE, reader(pages))
}

const TIME_BRANCH = '1267-time'
const TIME_PULL_JSON = JSON.stringify([raw_pull(1277, TIME_BRANCH)])

describe('time_github.parse_pulls', () => {
	it('reads the number, branch, head sha and every timestamp', () => {
		expect(time_github.parse_pulls(TIME_PULL_JSON)).toEqual([
			{
				number: 1277,
				branch: TIME_BRANCH,
				head_sha: SHA,
				created_ms: Date.parse(CREATED),
				merged_ms: Date.parse(MERGED),
				updated_ms: Date.parse(MERGED),
			},
		])
	})

	// `undefined` rather than `0`: a zero would read as "merged at the epoch" and produce a negative
	// CI wait rather than the honest "not merged yet".
	it('leaves an open pull request without a merge instant', () => {
		const [pull] = time_github.parse_pulls(OPEN_PULL_JSON)

		expect(pull?.merged_ms).toBeUndefined()
	})

	it('answers nothing for a body it cannot parse, rather than throwing', () => {
		expect(time_github.parse_pulls('not json')).toEqual([])
		expect(time_github.parse_page('not json')).toBeUndefined()
	})

	// The raw row count is what says where the listing ends. Measured on the filtered array instead,
	// one undated row on a full page looks like the last page — and the walk then reports a definite
	// absence it never established.
	it('counts the rows GitHub sent, not the rows it could read', () => {
		const undated = `{"number":9,"merged_at":null,"head":{"ref":"9-x","sha":"${SHA}"}}`
		const page = time_github.parse_page(`[${MERGED_PULL_ROW},${undated}]`)

		expect(page?.row_count).toBe(2)
		expect(page?.pulls).toHaveLength(1)
	})
})

describe('time_github.pull_for_branch_prefix — matching', () => {
	it('matches the branch josh git names after the issue', async () => {
		const found = await search_issue([[raw_pull(1, '126-other'), raw_pull(1279, ISSUE_BRANCH)]])

		expect(found.pull?.number).toBe(1279)
	})

	// `126-` must not satisfy `1268-`: the prefix carries the separator for exactly this reason.
	it('does not match an issue number that is only a prefix of the branch number', async () => {
		const found = await time_github.pull_for_branch_prefix(
			126,
			reader([[raw_pull(1, ISSUE_BRANCH)]]),
		)

		expect(found.pull).toBeUndefined()
	})

	// A failed read must not be laundered into an authoritative "there is none": an unauthenticated
	// or rate-limited `gh` would otherwise be reported as proof that the issue has no pull request.
	it('reports a failed read as a failure, not as an absence', async () => {
		const found = await time_github.pull_for_branch_prefix(ISSUE, refuse)

		expect(found).toEqual({ pull: undefined, is_exhausted: false, is_failed: true })
	})

	// `gh` exiting 0 with a body the schema rejects is a read nobody got an answer from, and it goes
	// down the same path as a 403 rather than being reported as an absence.
	it('reports an unreadable body as a failure too', async () => {
		const found = await time_github.pull_for_branch_prefix(ISSUE, body_reader('not json'))

		expect(found.is_failed).toBe(true)
		expect(found.is_exhausted).toBe(false)
	})
})

describe('time_github.pull_for_branch_prefix — paging', () => {
	// A short page is the end of the listing, so an absent match there is a real "there is none".
	it('reports the listing as exhausted when the page was short', async () => {
		const found = await time_github.pull_for_branch_prefix(999, reader([[raw_pull(1, '1-x')]]))

		expect(found).toEqual({ pull: undefined, is_exhausted: true, is_failed: false })
	})

	// Reaching the cap is not an answer. Reporting it as "there is none" is the silent zero this
	// command exists to remove, so the caller is told which of the two happened.
	it('stops at the page cap and says it did not reach the end', async () => {
		const asked: Array<string> = []
		const pages = Array.from({ length: time_github.MAX_PAGES + 2 }, () => filled_page())
		const found = await time_github.pull_for_branch_prefix(ISSUE, reader(pages, asked))

		expect(found).toEqual({ pull: undefined, is_exhausted: false, is_failed: false })
		expect(asked).toHaveLength(time_github.MAX_PAGES)
	})

	it('walks on to the next page only when the first did not answer', async () => {
		const asked: Array<string> = []
		const pages = [filled_page(), [raw_pull(7, '1268-late')]]
		const found = await time_github.pull_for_branch_prefix(ISSUE, reader(pages, asked))

		expect(found.pull?.number).toBe(7)
		expect(asked).toHaveLength(2)
	})

	// The other user of the shared walk, unchanged by the certainty protocol: a branch match is
	// settled the moment it is found, so a match on a full first page still costs one request.
	it('stops on the page that holds the branch, without reading the next', async () => {
		const asked: Array<string> = []
		const pages = [[...filled_page().slice(1), raw_pull(7, ISSUE_BRANCH)], filled_page()]
		const found = await time_github.pull_for_branch_prefix(ISSUE, reader(pages, asked))

		expect(found.pull?.number).toBe(7)
		expect(asked).toHaveLength(1)
	})
})

// Merged days ago, so a page that holds it is not the page holding the newest merge.
const OLD_MERGE = '2026-09-01T00:00:00Z'
// Touched after the newest merge — a comment, a label, a bot push.
const UPDATED_TODAY = '2026-09-03T12:00:00Z'
// Touched before it, which is what lets a page prove nothing newer follows.
const QUIET_UPDATE = '2026-09-03T08:00:00Z'
const NEWEST_PULL = 500
const NEWEST_BRANCH = '1279-newest'
const QUIET_PULL_BASE = 600

// A full page of pull requests updated after the newest merge. One of them merged days ago, so the
// walk used to take it as the answer and stop here.
function busy_page(): Array<RawPull> {
	return PAGE_INDICES.map((index) =>
		raw_pull(index + 1, `${String(index + 1)}-busy`, OLD_MERGE, UPDATED_TODAY),
	)
}

// The page the newest merge actually sits on: nothing on it was touched after that merge.
function merge_page(): Array<RawPull> {
	const quiet = PAGE_INDICES.slice(1).map((index) =>
		raw_pull(QUIET_PULL_BASE + index, `${String(index)}-quiet`, OLD_MERGE, QUIET_UPDATE),
	)

	return [raw_pull(NEWEST_PULL, NEWEST_BRANCH), ...quiet]
}

describe('time_github.latest_merged_pull — paging', () => {
	// The failure this walk was rewritten for (joshuafolkken/kit#1279): a page of pull requests
	// updated since the newest merge pushes it to page two, and page one holds an older merge that
	// used to look like an answer.
	it('walks past a page whose oldest update is newer than the merge found on it', async () => {
		const asked: Array<string> = []
		const found = await time_github.latest_merged_pull(
			reader([busy_page(), merge_page(), busy_page()], asked),
		)

		expect(found.pull?.number).toBe(NEWEST_PULL)
		expect(asked).toHaveLength(2)
	})

	// ...and the ordinary case did not get more expensive for it. One page proves itself, and the
	// second is never requested — the whole reason for proving the stop rather than always reading
	// every page.
	it('asks for one page when that page proves no later merge can be newer', async () => {
		const asked: Array<string> = []
		const found = await time_github.latest_merged_pull(reader([merge_page(), busy_page()], asked))

		expect(found.pull?.number).toBe(NEWEST_PULL)
		expect(asked).toHaveLength(1)
	})

	// A candidate the cap cut short is not an answer. Reported as one it would be indistinguishable
	// from a proven merge, and `pnpm josh time` would print an older run as "the run that just
	// finished" with no sign that 500 rows were read without settling it.
	it('reports the cap rather than a merge it could not prove is the newest', async () => {
		const asked: Array<string> = []
		const pages = Array.from({ length: time_github.MAX_PAGES + 1 }, () => busy_page())
		const found = await time_github.latest_merged_pull(reader(pages, asked))

		expect(found).toEqual({ pull: undefined, is_exhausted: false, is_failed: false })
		expect(asked).toHaveLength(time_github.MAX_PAGES)
	})

	// The listing ending is a proof of its own: with no page left, the best merge seen is the newest
	// there is, so a short page settles the question even when no page proved it on its own.
	it('settles on the best merge when the listing ends before the cap', async () => {
		const asked: Array<string> = []
		const tail = [raw_pull(NEWEST_PULL, NEWEST_BRANCH, MERGED, UPDATED_TODAY)]
		const found = await time_github.latest_merged_pull(reader([busy_page(), tail], asked))

		expect(found.pull?.number).toBe(NEWEST_PULL)
		expect(asked).toHaveLength(2)
	})
})

describe('time_github.newest_merged_choice', () => {
	// A merged pull request always carries `updated_at >= merged_at`, so a page whose oldest update
	// has fallen below the best merge settles the question and one that has not cannot.
	it('is certain only once the page has settled below the best merge', () => {
		const busy = time_github.parse_pulls(JSON.stringify(busy_page()))
		const quiet = time_github.parse_pulls(JSON.stringify(merge_page()))

		expect(time_github.newest_merged_choice(busy, undefined).is_certain).toBe(false)
		expect(time_github.newest_merged_choice(quiet, undefined).is_certain).toBe(true)
	})
})

describe('time_github.latest_merged_pull', () => {
	it('skips the open pull requests and takes a merged one', async () => {
		const found = await time_github.latest_merged_pull(body_reader(MIXED_PULLS_JSON))

		expect(time_github.parse_pulls(MIXED_PULLS_JSON)).toHaveLength(2)
		expect(found.pull?.number).toBe(1)
	})
})

describe('time_github.newest_merged', () => {
	// The listing is sorted by *update* time, and one comment on a pull request merged yesterday
	// lifts it above the one merged an hour ago. Taking the first merged row would then report
	// yesterday's run as "the run that just finished".
	it('takes the latest merge on the page, not the first merged row', () => {
		const newest_first = time_github.parse_pulls(`[${MERGED_PULL_ROW},${OLDER_PULL_ROW}]`)
		const oldest_first = time_github.parse_pulls(`[${OLDER_PULL_ROW},${MERGED_PULL_ROW}]`)

		expect(time_github.newest_merged(newest_first)?.number).toBe(1)
		expect(time_github.newest_merged(oldest_first)?.number).toBe(1)
	})

	it('answers nothing when nothing on the page is merged', () => {
		expect(time_github.newest_merged(time_github.parse_pulls(OPEN_PULL_JSON))).toBeUndefined()
	})
})

const CHECK_NAME = 'unit'

function check_body(started_at: string, completed_at: string): string {
	return JSON.stringify({ check_runs: [{ name: CHECK_NAME, started_at, completed_at }] })
}

describe('time_github.list_check_runs', () => {
	it('reads each job with its own start and finish', async () => {
		const runs = await time_github.list_check_runs(SHA, body_reader(check_body(CREATED, MERGED)))

		expect(runs).toEqual([
			{ name: CHECK_NAME, started_ms: Date.parse(CREATED), completed_ms: Date.parse(MERGED) },
		])
	})

	// A job still running has no finish, and dating one would invent a duration.
	it('drops a job that has not finished', async () => {
		const body = `{"check_runs":[{"name":"e2e","started_at":"${CREATED}","completed_at":null}]}`

		expect(await time_github.list_check_runs(SHA, body_reader(body))).toEqual([])
	})

	it('asks nothing at all without a head sha', async () => {
		expect(await time_github.list_check_runs('', refuse)).toEqual([])
	})
})
