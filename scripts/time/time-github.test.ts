import { describe, expect, it } from 'vitest'
import { time_github } from './time-github'
import { time_pull_fixture as fixture } from './time-pull-fixture'

// The listing fixtures are `time-pull-fixture.ts`'s, shared with the suite that answers a batch of
// issues from the same walk: what a page of pull requests looks like is one statement, not one per
// suite.
const { CREATED, MERGED, SHA, raw_pull, raw_json, body_reader, refuse } = fixture
const ISSUE_BRANCH = '1268-measure-a-run'

const OPEN_PULL_ROW = `{"number":2,"created_at":"${CREATED}","merged_at":null,"updated_at":"${CREATED}","head":{"ref":"2-open","sha":"${SHA}"}}`
const OPEN_PULL_JSON = `[${OPEN_PULL_ROW}]`
// The open one first, so a lookup that took the first row rather than the first *merged* row would
// answer with a pull request that has no merge instant at all.
const MERGED_PULL_ROW = raw_json(1, ISSUE_BRANCH, MERGED)

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
