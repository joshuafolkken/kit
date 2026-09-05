import { describe, expect, it } from 'vitest'
import { time_github } from './time-github'
import { time_pull_fixture as fixture, type RawPull } from './time-pull-fixture'

// The listing fixtures are `time-pull-fixture.ts`'s, shared with the suite that answers a batch of
// issues from the same walk: what a page of pull requests looks like is one statement, not one per
// suite.
const { CREATED, MERGED, SHA, PAGE_INDICES, raw_pull, raw_json, reader, body_reader, refuse } =
	fixture
const ISSUE_BRANCH = '1268-measure-a-run'

const OPEN_PULL_ROW = `{"number":2,"created_at":"${CREATED}","merged_at":null,"updated_at":"${CREATED}","head":{"ref":"2-open","sha":"${SHA}"}}`
const OPEN_PULL_JSON = `[${OPEN_PULL_ROW}]`
// The open one first, so a lookup that took the first row rather than the first *merged* row would
// answer with a pull request that has no merge instant at all.
const MERGED_PULL_ROW = raw_json(1, ISSUE_BRANCH, MERGED)
// Merged a day earlier, so a listing sorted by update time can legitimately put it first.
const OLDER_PULL_ROW = raw_json(3, '3-older', '2026-09-02T00:00:00Z')
const MIXED_PULLS_JSON = `[${OPEN_PULL_ROW},${MERGED_PULL_ROW}]`

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

const CONCLUSION = 'success'

function check_body(started_at: string, completed_at: string): string {
	return JSON.stringify({
		check_runs: [{ name: CHECK_NAME, conclusion: CONCLUSION, started_at, completed_at }],
	})
}

const EMPTY_CHECKS = { runs: [], is_failed: false }

// The body `gh` hands back having exited 0 when the request was throttled — the case both read
// suites below are really about, named once so the two cannot spell it differently.
const RATE_LIMIT_CASE = 'a rate-limit error object'

describe('time_github.list_check_runs', () => {
	it('reads each job with its own start, finish and conclusion', async () => {
		const list = await time_github.list_check_runs(SHA, body_reader(check_body(CREATED, MERGED)))

		expect(list).toEqual({
			runs: [
				{
					name: CHECK_NAME,
					conclusion: CONCLUSION,
					started_ms: Date.parse(CREATED),
					completed_ms: Date.parse(MERGED),
				},
			],
			is_failed: false,
		})
	})

	// GitHub sends `null` for a job whose outcome it has no word for. **An empty conclusion is that
	// answer, never a substitute one**: reading it as `success` would report a check nobody graded as
	// one that passed (joshuafolkken/kit#1310).
	it('carries an absent conclusion through as empty rather than inventing one', async () => {
		const body = `{"check_runs":[{"name":"${CHECK_NAME}","conclusion":null,"started_at":"${CREATED}","completed_at":"${MERGED}"}]}`
		const list = await time_github.list_check_runs(SHA, body_reader(body))

		expect(list.runs[0]?.conclusion).toBe('')
	})

	// A job still running has no finish, and dating one would invent a duration. The read itself
	// succeeded, so this is an empty list and not a failure.
	it('drops a job that has not finished', async () => {
		const body = `{"check_runs":[{"name":"e2e","started_at":"${CREATED}","completed_at":null}]}`

		expect(await time_github.list_check_runs(SHA, body_reader(body))).toEqual(EMPTY_CHECKS)
	})

	it('asks nothing at all without a head sha', async () => {
		expect(await time_github.list_check_runs('', refuse)).toEqual(EMPTY_CHECKS)
	})
})

// The acceptance criterion of joshuafolkken/kit#1352's second symptom: a rate limit, a timeout and an
// expired credential all arrive through one `catch`, and answering them with an empty list reports
// "GitHub recorded no checks for this run" — a definite answer nobody established.
describe('time_github.list_check_runs — a read that was refused', () => {
	it('separates a refused read from a run that really had no checks', async () => {
		const refused = await time_github.list_check_runs(SHA, refuse)
		const empty = await time_github.list_check_runs(SHA, body_reader('{"check_runs":[]}'))

		expect(refused).toEqual({ runs: [], is_failed: true })
		expect(empty).toEqual(EMPTY_CHECKS)
	})

	// `gh` exits 0 with a body the schema rejects on a shape change or an error object, so laundering
	// that into an empty list is the same silence as swallowing a 403. The error object is the case
	// that reaches this in practice, and it needs `check_runs` to be required rather than nullish —
	// optional, it parses as a body that simply omitted the key.
	it.each([
		['a wrongly typed check list', '{"check_runs":"nope"}'],
		[RATE_LIMIT_CASE, '{"message":"API rate limit exceeded","documentation_url":"x"}'],
	])('treats %s as a failed read', async (_name: string, body: string) => {
		const list = await time_github.list_check_runs(SHA, body_reader(body))

		expect(list.is_failed).toBe(true)
	})
})

// joshuafolkken/kit#1384: a pull request with two commits ran CI twice, and only the head commit's
// cycle was ever read — so "the second cycle ran serially before the merge" could not be expressed.
describe('time_github.list_pull_commits', () => {
	const OTHER_SHA = 'b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0'

	it('reads every commit sha in the order GitHub sent them', async () => {
		const body = JSON.stringify([{ sha: SHA }, { sha: OTHER_SHA }])

		expect(await time_github.list_pull_commits(1, body_reader(body))).toEqual({
			shas: [SHA, OTHER_SHA],
			is_failed: false,
		})
	})

	// A listing short one commit is a CI measurement built from a subset of the cycles, and the caller
	// refuses to produce one of those — so a row this parse cannot read makes the listing unreadable
	// rather than one commit shorter. The wire format is stated rather than built, because a `null`
	// sha is what a body of that shape actually carries.
	it('treats a row carrying no sha as a listing it could not read', async () => {
		const body = `[{"sha":null},{"sha":"${SHA}"}]`
		const list = await time_github.list_pull_commits(1, body_reader(body))

		expect(list).toEqual({ shas: [], is_failed: true })
	})

	// The distinction every read in this module keeps: a refused listing is not a pull request with
	// no commits, and reporting it as one would report a rate limit as a run whose CI never ran.
	it.each([
		['a refused read', undefined],
		[RATE_LIMIT_CASE, '{"message":"API rate limit exceeded"}'],
		['a wrongly typed body', '{"commits":[]}'],
	])('separates %s from an empty listing', async (_name: string, body: string | undefined) => {
		const read = body === undefined ? refuse : body_reader(body)

		expect(await time_github.list_pull_commits(1, read)).toEqual({ shas: [], is_failed: true })
	})

	it('reads an empty listing as an answer', async () => {
		expect(await time_github.list_pull_commits(1, body_reader('[]'))).toEqual({
			shas: [],
			is_failed: false,
		})
	})
})
