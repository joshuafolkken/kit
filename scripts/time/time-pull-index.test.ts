import { describe, expect, it } from 'vitest'
import { time_github, type GhReader, type PullSearch } from './time-github'
import { time_pull_fixture as fixture, type RawPull } from './time-pull-fixture'
import { time_pull_index } from './time-pull-index'

// The listing fixtures are `time-pull-fixture.ts`'s, shared with the suite that covers the walk
// itself: what a page of pull requests looks like is one statement, not one per suite.
const { raw_pull, reader, body_reader, refuse, filled_page } = fixture

const ISSUE_BRANCH = '1268-measure-a-run'
const ISSUE = 1268
// Numbers no fixture branch names, so a walk asking about them reads every page there is.
const ABSENT = [9001, 9002, 9003, 9004]
const FIRST_ABSENT = 9001
// The child a batch case finds, and the pull request that answers it.
const MATCHED = 101
const MATCHED_BRANCH = '101-a'
const MATCHED_PULL = 7
// The page the failing reader refuses, which is the second one every such case scripts.
const FAIL_PAGE = 2

// The two "not found" answers a case here asserts in full are `time-pull-fixture.ts`'s, shared with
// the epic suite that expects the same shape one level up.
const { EXHAUSTED_SEARCH, CAPPED_SEARCH } = fixture

async function search_issue(pages: ReadonlyArray<ReadonlyArray<RawPull>>): Promise<PullSearch> {
	return await time_pull_index.pull_for_issue(ISSUE, reader(pages))
}

// Five full pages, so a walk that never settles reads to the cap rather than to the end.
function capped_pages(): Array<Array<RawPull>> {
	return Array.from({ length: time_github.MAX_PAGES + 1 }, () => filled_page())
}

// A full page whose last row is the match, so a walk that answered before reading the whole page
// would miss it — and one that stops here proves the page it settled on.
function page_ending_with(branch: string): Array<RawPull> {
	return [...filled_page().slice(1), raw_pull(MATCHED_PULL, branch)]
}

// A reader that answers from the script until the named page, which it refuses. `gh` failing partway
// is the case where an issue already found and one still unresolved must not get the same answer.
function failing_reader(
	pages: ReadonlyArray<ReadonlyArray<RawPull>>,
	fail_page: number,
	asked: Array<string> = [],
): GhReader {
	const answer = reader(pages, asked)

	return async (request_path: string) => {
		if (request_path.includes(`page=${String(fail_page)}`)) return await refuse()

		return await answer(request_path)
	}
}

describe('time_pull_index.pull_for_issue — matching', () => {
	it('matches the branch josh git names after the issue', async () => {
		const found = await search_issue([[raw_pull(1, '126-other'), raw_pull(1279, ISSUE_BRANCH)]])

		expect(found.pull?.number).toBe(1279)
	})

	// `126-` must not satisfy `1268-`: the branch names one issue, and the separator is what says so.
	it('does not match an issue number that is only a prefix of the branch number', async () => {
		const found = await time_pull_index.pull_for_issue(126, reader([[raw_pull(1, ISSUE_BRANCH)]]))

		expect(found.pull).toBeUndefined()
	})

	// A branch that names no issue at all — a bot's, a hand-made one — belongs to nobody.
	it('claims nothing for a branch that does not begin with an issue number', async () => {
		const found = await time_pull_index.pull_for_issue(ISSUE, reader([[raw_pull(1, 'renovate/x')]]))

		expect(found.is_exhausted).toBe(true)
	})

	// A failed read must not be laundered into an authoritative "there is none": an unauthenticated
	// or rate-limited `gh` would otherwise be reported as proof that the issue has no pull request.
	it('reports a failed read as a failure, not as an absence', async () => {
		const found = await time_pull_index.pull_for_issue(ISSUE, refuse)

		expect(found).toEqual({ pull: undefined, is_exhausted: false, is_failed: true })
	})

	// `gh` exiting 0 with a body the schema rejects is a read nobody got an answer from, and it goes
	// down the same path as a 403 rather than being reported as an absence.
	it('reports an unreadable body as a failure too', async () => {
		const found = await time_pull_index.pull_for_issue(ISSUE, body_reader('not json'))

		expect(found.is_failed).toBe(true)
		expect(found.is_exhausted).toBe(false)
	})
})

describe('time_pull_index.pull_for_issue — paging', () => {
	// A short page is the end of the listing, so an absent match there is a real "there is none".
	it('reports the listing as exhausted when the page was short', async () => {
		const found = await time_pull_index.pull_for_issue(999, reader([[raw_pull(1, '1-x')]]))

		expect(found).toEqual(EXHAUSTED_SEARCH)
	})

	// Reaching the cap is not an answer. Reporting it as "there is none" is the silent zero this
	// command exists to remove, so the caller is told which of the two happened.
	it('stops at the page cap and says it did not reach the end', async () => {
		const asked: Array<string> = []
		const found = await time_pull_index.pull_for_issue(ISSUE, reader(capped_pages(), asked))

		expect(found).toEqual(CAPPED_SEARCH)
		expect(asked).toHaveLength(time_github.MAX_PAGES)
	})

	it('walks on to the next page only when the first did not answer', async () => {
		const asked: Array<string> = []
		const pages = [filled_page(), [raw_pull(MATCHED_PULL, '1268-late')]]
		const found = await time_pull_index.pull_for_issue(ISSUE, reader(pages, asked))

		expect(found.pull?.number).toBe(MATCHED_PULL)
		expect(asked).toHaveLength(2)
	})

	// A branch match is settled the moment it is found, so a match on a full first page still costs
	// one request — the certainty that keeps `--issue` at exactly the reads it always made.
	it('stops on the page that holds the branch, without reading the next', async () => {
		const asked: Array<string> = []
		const pages = [page_ending_with(ISSUE_BRANCH), filled_page()]
		const found = await time_pull_index.pull_for_issue(ISSUE, reader(pages, asked))

		expect(found.pull?.number).toBe(MATCHED_PULL)
		expect(asked).toHaveLength(1)
	})
})

// The defect this module was written for (joshuafolkken/kit#1292): the listing was paged once per
// child, so an epic paid for the same 500 rows once per issue in it.
describe('time_pull_index.pulls_for_issues — one walk for the whole batch', () => {
	it('costs the same requests for four issues as for one', async () => {
		const one: Array<string> = []
		const many: Array<string> = []
		const pages = capped_pages()

		await time_pull_index.pulls_for_issues([FIRST_ABSENT], reader(pages, one))
		await time_pull_index.pulls_for_issues(ABSENT, reader(pages, many))

		expect(many).toHaveLength(one.length)
		expect(many).toHaveLength(time_github.MAX_PAGES)
	})

	it('answers every child of a page from the one request that read it', async () => {
		const asked: Array<string> = []
		const pages = [[raw_pull(1, MATCHED_BRANCH), raw_pull(2, '102-b'), raw_pull(3, '103-c')]]
		const found = await time_pull_index.pulls_for_issues([MATCHED, 102, 103], reader(pages, asked))

		expect([...found].map(([issue, search]) => [issue, search.pull?.number])).toEqual([
			[MATCHED, 1],
			[102, 2],
			[103, 3],
		])
		expect(asked).toHaveLength(1)
	})

	// Nothing asked means nothing read — an epic whose task list names no issue in this repository
	// would otherwise page the whole listing to build an empty map.
	it('reads nothing at all when no issue was asked about', async () => {
		const asked: Array<string> = []

		expect(await time_pull_index.pulls_for_issues([], reader([], asked))).toEqual(new Map())
		expect(asked).toHaveLength(0)
	})

	// A number twice in an epic's task list is one question, not two.
	it('answers a repeated issue number once', async () => {
		const found = await time_pull_index.pulls_for_issues(
			[ISSUE, ISSUE],
			reader([[raw_pull(MATCHED_PULL, ISSUE_BRANCH)]]),
		)

		expect(found.size).toBe(1)
		expect(found.get(ISSUE)?.pull?.number).toBe(MATCHED_PULL)
	})
})

describe('time_pull_index.pulls_for_issues — when the walk stops', () => {
	it('stops as soon as the last child asked about has landed', async () => {
		const asked: Array<string> = []
		const pages = [page_ending_with(MATCHED_BRANCH), filled_page()]
		const found = await time_pull_index.pulls_for_issues([MATCHED], reader(pages, asked))

		expect(found.get(MATCHED)?.pull?.number).toBe(MATCHED_PULL)
		expect(asked).toHaveLength(1)
	})

	// The three "not found" reasons are the walk's, so a child still unresolved when it ended
	// inherits that ending — and a child already found keeps its answer rather than inheriting it.
	it('keeps a found child while the rest inherit the page cap', async () => {
		const pages = [page_ending_with(MATCHED_BRANCH), ...capped_pages().slice(1)]
		const found = await time_pull_index.pulls_for_issues([MATCHED, FIRST_ABSENT], reader(pages))

		expect(found.get(MATCHED)?.pull?.number).toBe(MATCHED_PULL)
		expect(found.get(FIRST_ABSENT)).toEqual(CAPPED_SEARCH)
	})

	it('keeps a found child while the rest inherit a failed read', async () => {
		const pages = [page_ending_with(MATCHED_BRANCH), filled_page()]
		const found = await time_pull_index.pulls_for_issues(
			[MATCHED, FIRST_ABSENT],
			failing_reader(pages, FAIL_PAGE),
		)

		expect(found.get(MATCHED)?.pull?.number).toBe(MATCHED_PULL)
		expect(found.get(FIRST_ABSENT)?.is_failed).toBe(true)
	})

	it('tells a child the listing ran out rather than that the read failed', async () => {
		const pages = [[raw_pull(MATCHED_PULL, MATCHED_BRANCH)]]
		const found = await time_pull_index.pulls_for_issues([MATCHED, FIRST_ABSENT], reader(pages))

		expect(found.get(FIRST_ABSENT)).toEqual(EXHAUSTED_SEARCH)
	})
})
