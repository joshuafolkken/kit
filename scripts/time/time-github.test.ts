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
	head: { ref: string; sha: string }
}

function raw_pull(pull_number: number, branch: string, merged_at: string = MERGED): RawPull {
	return { number: pull_number, created_at: CREATED, merged_at, head: { ref: branch, sha: SHA } }
}

// An open pull request carries a JSON `null`, which is what GitHub sends and what the schema's
// `nullish` exists for. Written as text rather than as a `null` literal so the fixture states the
// wire format instead of a language value.
function raw_json(pull_number: number, branch: string, merged_at: string): string {
	return `{"number":${String(pull_number)},"created_at":"${CREATED}","merged_at":"${merged_at}","head":{"ref":"${branch}","sha":"${SHA}"}}`
}

const OPEN_PULL_ROW = `{"number":2,"created_at":"${CREATED}","merged_at":null,"head":{"ref":"2-open","sha":"${SHA}"}}`
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
	it('reads the number, branch, head sha and both timestamps', () => {
		expect(time_github.parse_pulls(TIME_PULL_JSON)).toEqual([
			{
				number: 1277,
				branch: TIME_BRANCH,
				head_sha: SHA,
				created_ms: Date.parse(CREATED),
				merged_ms: Date.parse(MERGED),
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
