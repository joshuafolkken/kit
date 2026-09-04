import { describe, expect, it } from 'vitest'
import { time_github } from './time-github'
import { time_last_select, type RunSelection } from './time-last-select'
import { time_pull_fixture, type RawPull } from './time-pull-fixture'

// Which runs "the last N" are (joshuafolkken/kit#1312).
//
// The listing fixtures are `time-pull-fixture.ts`'s, shared with the two suites that walk the same
// pages one level down — a second page shape beside this suite would let the three disagree about
// what GitHub sends.

const { raw_pull, reader, refuse, pulls_asked } = time_pull_fixture

const FIXTURE_YEAR = 2026
const UNNAMED_BRANCH = 'chore/no-issue-here'
const NEWEST_HOUR = 10
const MIDDLE_HOUR = 9
const OLDEST_HOUR = 8
const FILLER_HOUR = 1
const UNREACHED_HOUR = 23
const NONE = 0
const TWO = 2
const THREE = 3

function at(hour: number): string {
	return new Date(Date.UTC(FIXTURE_YEAR, 8, 5, hour)).toISOString()
}

function run_pull(pull_number: number, issue_number: number, hour: number): RawPull {
	return raw_pull(pull_number, `${String(issue_number)}-a-change`, at(hour))
}

const NEWEST = run_pull(1, 201, NEWEST_HOUR)
const MIDDLE = run_pull(2, 202, MIDDLE_HOUR)
const OLDEST = run_pull(3, 203, OLDEST_HOUR)

async function select(
	pages: ReadonlyArray<ReadonlyArray<RawPull>>,
	count: number,
	asked?: Array<string>,
): Promise<RunSelection> {
	return await time_last_select.select_last_runs(count, reader(pages, asked))
}

describe('time_last_select.select_last_runs — which runs it takes', () => {
	it('takes the most recently merged runs, newest merge first', async () => {
		const selection = await select([[OLDEST, NEWEST, MIDDLE]], TWO)

		expect(selection.runs.map((run) => run.issue_number)).toEqual([201, 202])
	})

	// The listing is sorted by update time, not by merge time, so the rows arrive in whatever order
	// somebody last commented in. Ordering here is what stops "the last five" meaning "the five most
	// recently commented on".
	it('orders by the merge instant rather than by the order the rows arrived', async () => {
		const stale = raw_pull(4, '204-a-change', at(OLDEST_HOUR), at(UNREACHED_HOUR))
		const selection = await select([[stale, NEWEST]], TWO)

		expect(selection.runs.map((run) => run.issue_number)).toEqual([201, 204])
	})

	// A run is measured by issue number, so a merged pull request whose branch names none has nothing
	// to join its two halves on. Counted rather than dropped in silence.
	it('leaves out a merged pull request whose branch names no issue, and counts it', async () => {
		const unnamed = raw_pull(5, UNNAMED_BRANCH, at(NEWEST_HOUR))
		const selection = await select([[unnamed, NEWEST, MIDDLE]], THREE)

		expect(selection.runs.map((run) => run.issue_number)).toEqual([201, 202])
		expect(selection.skipped_count).toBe(1)
	})

	// A page holds a hundred rows and the walk may only need three of them, so counting every
	// branchless merge it passed would report candidates that were never candidates.
	it('does not count a branchless merge older than the oldest run kept', async () => {
		const old_unnamed = raw_pull(8, UNNAMED_BRANCH, at(FILLER_HOUR))
		const selection = await select([[NEWEST, MIDDLE, old_unnamed]], TWO)

		expect(selection.runs.map((run) => run.issue_number)).toEqual([201, 202])
		expect(selection.skipped_count).toBe(NONE)
	})

	// A revert and the change it reverts are two merged pull requests naming one issue, and both
	// halves of that issue's measurement are the same — so counting both would report one run twice.
	it('keeps one row per issue, the newest merge winning', async () => {
		const revert = run_pull(6, 201, OLDEST_HOUR)
		const selection = await select([[NEWEST, revert]], TWO)

		expect(selection.runs).toHaveLength(1)
		expect(selection.runs[0]?.pull.number).toBe(1)
	})

	// An open pull request has no merge instant at all, so it is not one of "the last N merged runs".
	it('ignores a pull request that never merged', async () => {
		const open = { ...raw_pull(7, '207-a-change'), merged_at: '' }
		const selection = await select([[open, NEWEST]], TWO)

		expect(selection.runs.map((run) => run.issue_number)).toEqual([201])
	})
})

describe('time_last_select.select_last_runs — how far it reads', () => {
	// The proof `time-github.ts` already carries, applied to the *last* of the runs kept: every row
	// after this page was updated before that merge, so none of them can displace it.
	it('stops reading once enough runs are held and the page proves no later one can beat them', async () => {
		const filler = time_pull_fixture.PAGE_INDICES.slice(TWO).map((index) =>
			run_pull(index + 10, index + 300, FILLER_HOUR),
		)
		const asked: Array<string> = []

		const selection = await select(
			[[NEWEST, MIDDLE, ...filler], [run_pull(9, 209, UNREACHED_HOUR)]],
			TWO,
			asked,
		)

		expect(selection.runs.map((run) => run.issue_number)).toEqual([201, 202])
		expect(pulls_asked(asked)).toHaveLength(1)
	})

	// A read that failed is not an empty listing: the caller has to be able to say "there may be more
	// recent runs than these" rather than reporting a definite answer nobody established.
	it('reports a failed read as such, rather than as a repository with no runs', async () => {
		const selection = await time_last_select.select_last_runs(TWO, refuse)

		expect(selection.runs).toEqual([])
		expect(selection.end).toBe('failed')
	})

	it('reads the whole listing when the page cannot settle the answer', async () => {
		const asked: Array<string> = []

		await select([time_pull_fixture.filled_page()], time_github.PAGE_SIZE + 1, asked)

		expect(pulls_asked(asked).length).toBeGreaterThan(0)
	})
})
