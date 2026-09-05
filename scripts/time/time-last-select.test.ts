import { describe, expect, it } from 'vitest'
import { time_github } from './time-github'
import { time_last_select, type MergedRun, type RunSelection } from './time-last-select'
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
const REVERT_PULL = 6

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

	// With fewer runs than asked for there were unfilled slots, so every branchless merge the walk
	// passed really was a candidate for one of them.
	it('counts every branchless merge when the request could not be filled', async () => {
		const old_unnamed = raw_pull(9, UNNAMED_BRANCH, at(FILLER_HOUR))
		const selection = await select([[NEWEST, old_unnamed]], THREE)

		expect(selection.runs.map((run) => run.issue_number)).toEqual([201])
		expect(selection.skipped_count).toBe(1)
	})
})

describe('time_last_select.select_last_runs — the rows it collapses', () => {
	// A revert and the change it reverts are two merged pull requests naming one issue, and both
	// halves of that issue's measurement are the same — so counting both would report one run twice.
	it('keeps one row per issue, the newest merge winning', async () => {
		const revert = run_pull(REVERT_PULL, 201, OLDEST_HOUR)
		const selection = await select([[NEWEST, revert]], TWO)

		expect(selection.runs).toHaveLength(1)
		expect(selection.runs[0]?.pull.number).toBe(1)
	})

	// The collapse is right; the silence was not. Without this the answer was built from two merges
	// and reported one row, with nothing anywhere saying a merge had been folded away.
	it('records the pull request it folded away', async () => {
		const revert = run_pull(REVERT_PULL, 201, OLDEST_HOUR)
		const selection = await select([[NEWEST, revert]], TWO)

		expect(selection.collapsed_pulls).toEqual([REVERT_PULL])
	})

	it('records nothing where every run came from a single merge', async () => {
		const selection = await select([[NEWEST, MIDDLE]], TWO)

		expect(selection.collapsed_pulls).toEqual([])
	})

	// A duplicate whose own run was pushed out of the window was never a candidate for the answer, so
	// naming it would point the reader at a run the table does not show.
	it('leaves out a duplicate whose run did not make the window', async () => {
		const revert = run_pull(REVERT_PULL, 203, FILLER_HOUR)
		const selection = await select([[NEWEST, MIDDLE, OLDEST, revert]], TWO)

		expect(selection.runs.map((run) => run.issue_number)).toEqual([201, 202])
		expect(selection.collapsed_pulls).toEqual([])
	})

	// An open pull request has no merge instant at all, so it is not one of "the last N merged runs".
	it('ignores a pull request that never merged', async () => {
		const open = { ...raw_pull(7, '207-a-change'), merged_at: '' }
		const selection = await select([[open, NEWEST]], TWO)

		expect(selection.runs.map((run) => run.issue_number)).toEqual([201])
	})
})

function merged_run(pull_number: number, issue_number: number): MergedRun {
	return {
		issue_number,
		merged_ms: NONE,
		pull: {
			number: pull_number,
			branch: `${String(issue_number)}-a-change`,
			head_sha: '',
			created_ms: NONE,
			merged_ms: NONE,
			updated_ms: NONE,
		},
	}
}

// The guard is asked here rather than through a walk, because reaching it that way needs a page full
// to its hundred-row ceiling: a short page ends the listing, so nothing can be handed back twice.
describe('time_last_select.collapsed_within', () => {
	// A listing paginated by update time hands the same pull request back on a later page when
	// something touched it mid-walk. The second copy folds into the first, and reporting it would name
	// a row sitting in the table as its own duplicate — a false reading of the one fact this states.
	it('does not report a row that is itself in the answer', () => {
		const kept = merged_run(1, 201)

		expect(time_last_select.collapsed_within([kept], [kept])).toEqual([])
	})

	it('reports a genuinely different merge of an issue that is in the answer', () => {
		const kept = merged_run(1, 201)
		const revert = merged_run(REVERT_PULL, 201)

		expect(time_last_select.collapsed_within([revert], [kept])).toEqual([REVERT_PULL])
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
