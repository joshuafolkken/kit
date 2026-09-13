import { auto_ok_fixture, CREATED_EARLIER } from '#scripts/auto-ok/auto-ok-fixture'
import type { EpicChild } from '#scripts/epic/epic-graph'
import { ALREADY_DONE_LABEL, AUTO_OK_LABEL, NEEDS_DECISION_LABEL } from '#scripts/git/issue-labels'
import type { OpenIssueData } from '#scripts/git/schemas'
import { describe, expect, it } from 'vitest'
import { backlog_pool } from './backlog-pool'

// A standalone row's `blocked_by` edges carry the repository each blocker actually lives in, never
// the repository the row happened to be read from (joshuafolkken/kit#1654). Issue numbers are unique
// per repository, so a blocker stamped with the reading repository names a different issue there —
// and `backlog:plan` then drops it as closed and reports the child as merely next in line.

const READING_REPO = 'joshuafolkken/kit'
const OTHER_REPO = 'joshuafolkken/app-kit'
const ROW_NUMBER = 10
const BLOCKER_NUMBER = 7
const CREATED_AT = '2026-09-09T00:00:00Z'

interface BlockerInput {
	number: number
	repository_url?: string
}

function row(blockers: ReadonlyArray<BlockerInput>): OpenIssueData {
	return {
		number: ROW_NUMBER,
		title: 'A standalone row',
		labels: [],
		createdAt: CREATED_AT,
		blockedBy: { nodes: [...blockers], totalCount: blockers.length },
	}
}

describe('backlog_pool.to_child', () => {
	it('stamps a blocker with the repository the node itself names', () => {
		const blocker = {
			number: BLOCKER_NUMBER,
			repository_url: `https://api.github.com/repos/${OTHER_REPO}`,
		}

		const child = backlog_pool.to_child(row([blocker]), READING_REPO)

		expect(child.blocked_by).toEqual([{ repo: OTHER_REPO, number: BLOCKER_NUMBER }])
	})

	it('falls back to the reading repository for a blocker that names none', () => {
		const child = backlog_pool.to_child(row([{ number: BLOCKER_NUMBER }]), READING_REPO)

		expect(child.blocked_by).toEqual([{ repo: READING_REPO, number: BLOCKER_NUMBER }])
	})

	it('stamps the row itself with the reading repository', () => {
		expect(backlog_pool.to_child(row([]), READING_REPO).repo).toBe(READING_REPO)
	})
})

// joshuafolkken/kit#1679: `already-done` names work that is already merged, and the close that is
// left is Tier C — so a person is the only thing that resolves it. Bucketed with the rows that are
// waiting on time, it would be reported as something that resolves itself and nobody would ever be
// told to close it.
const STANDALONE_CONTEXT = {
	tracked: new Map<number, number>(),
	exclude: [],
	repo: READING_REPO,
	running: new Set<string>(),
}

function opted_in(number: number, labels: ReadonlyArray<string>): OpenIssueData {
	return auto_ok_fixture.issue(number, CREATED_EARLIER, [AUTO_OK_LABEL, ...labels])
}

function human_numbers(issues: ReadonlyArray<OpenIssueData>): Array<number> {
	return backlog_pool
		.classify_standalone(issues, STANDALONE_CONTEXT)
		.human.map((child) => child.number)
}

describe('backlog_pool.classify_standalone — the rows a person has to resolve', () => {
	it('puts an already-done row on the person side', () => {
		expect(human_numbers([opted_in(ROW_NUMBER, [ALREADY_DONE_LABEL])])).toEqual([ROW_NUMBER])
	})

	it('puts a parked row there too, unchanged', () => {
		expect(human_numbers([opted_in(ROW_NUMBER, [NEEDS_DECISION_LABEL])])).toEqual([ROW_NUMBER])
	})

	// The row is withheld from the offer as well, not merely reported differently — otherwise a
	// `backlogrun` would start the very issue it has just been told is already merged.
	it('does not offer an already-done row', () => {
		const issues = [opted_in(ROW_NUMBER, [ALREADY_DONE_LABEL])]

		expect(backlog_pool.classify_standalone(issues, STANDALONE_CONTEXT).runnable).toEqual([])
	})

	it('still offers a row carrying neither label', () => {
		const issues = [opted_in(ROW_NUMBER, [])]
		const offered = backlog_pool.classify_standalone(issues, STANDALONE_CONTEXT).runnable

		expect(offered.map((child) => child.number)).toEqual([ROW_NUMBER])
	})
})

// joshuafolkken/kit#1943: a blocker outside every graph is weighed against what the backlog runs.
const EPIC_CHILD = 20
const OTHER_EPIC_CHILD = 30
const THIRD_CHILD = 40

function epic_child(number: number, blockers: ReadonlyArray<number> = []): EpicChild {
	return {
		number,
		repo: READING_REPO,
		state: 'OPEN',
		labels: [],
		blocked_by: blockers.map((blocker) => ({ repo: READING_REPO, number: blocker })),
	}
}

function blocked_row(state: 'OPEN' | 'CLOSED'): OpenIssueData {
	return auto_ok_fixture.blocked_issue(ROW_NUMBER, CREATED_EARLIER, [
		{ number: BLOCKER_NUMBER, state },
	])
}

describe('backlog_pool.running_set', () => {
	// The blocker carries no `auto-ok` of its own; its epic's does, which is what put it in the graph.
	it('counts an opted-in epic child and a standalone row alike', () => {
		const running = backlog_pool.running_set(
			[[epic_child(EPIC_CHILD)]],
			[opted_in(ROW_NUMBER, [])],
			READING_REPO,
		)

		expect(running).toEqual(
			new Set([`${READING_REPO}#${String(EPIC_CHILD)}`, `${READING_REPO}#${String(ROW_NUMBER)}`]),
		)
	})

	it('leaves out a standalone row a person has to resolve', () => {
		const running = backlog_pool.running_set(
			[],
			[opted_in(ROW_NUMBER, [NEEDS_DECISION_LABEL])],
			READING_REPO,
		)

		expect(running.size).toBe(0)
	})
})

describe('backlog_pool.classify_standalone — a blocker outside the backlog', () => {
	it('sends a row waiting on an open issue the backlog does not run to a person', () => {
		const result = backlog_pool.classify_standalone([blocked_row('OPEN')], STANDALONE_CONTEXT)

		expect(result.human.map((child) => child.number)).toEqual([ROW_NUMBER])
	})

	it('keeps a row waiting on an open issue the backlog does run on time', () => {
		const running = new Set([`${READING_REPO}#${String(BLOCKER_NUMBER)}`])
		const result = backlog_pool.classify_standalone([blocked_row('OPEN')], {
			...STANDALONE_CONTEXT,
			running,
		})

		expect(result.time.map((child) => child.number)).toEqual([ROW_NUMBER])
	})
})

describe('backlog_pool.cross_epic_cycles', () => {
	it('reports a cycle whose links cross from one epic into another', () => {
		const anomalies = backlog_pool.cross_epic_cycles(
			[[epic_child(EPIC_CHILD, [OTHER_EPIC_CHILD])], [epic_child(OTHER_EPIC_CHILD, [EPIC_CHILD])]],
			[],
		)

		expect(anomalies.map((anomaly) => anomaly.kind)).toEqual(['cycle'])
		expect(anomalies[0]?.message).toContain(`#${String(EPIC_CHILD)}`)
	})

	it('leaves a cycle inside one epic to that epic', () => {
		const one_epic = [
			epic_child(EPIC_CHILD, [OTHER_EPIC_CHILD]),
			epic_child(OTHER_EPIC_CHILD, [EPIC_CHILD]),
		]

		expect(backlog_pool.cross_epic_cycles([one_epic], [])).toEqual([])
	})

	it('reports nothing for an ordering that crosses epics without looping', () => {
		const graphs = [[epic_child(EPIC_CHILD)], [epic_child(OTHER_EPIC_CHILD, [EPIC_CHILD])]]

		expect(backlog_pool.cross_epic_cycles(graphs, [])).toEqual([])
	})

	// Standalone rows looping only among themselves have always waited without stopping the backlog.
	it('leaves a loop among standalone rows alone', () => {
		const rows = [
			epic_child(EPIC_CHILD, [OTHER_EPIC_CHILD]),
			epic_child(OTHER_EPIC_CHILD, [EPIC_CHILD]),
		]

		expect(backlog_pool.cross_epic_cycles([], rows)).toEqual([])
	})
})

describe('backlog_pool.cross_epic_cycles — what only waits behind a loop', () => {
	// A child downstream of a loop already known is not a loop of its own.
	it('does not name an epic child that only waits behind a standalone loop', () => {
		const rows = [
			epic_child(EPIC_CHILD, [OTHER_EPIC_CHILD]),
			epic_child(OTHER_EPIC_CHILD, [EPIC_CHILD]),
		]

		expect(backlog_pool.cross_epic_cycles([[epic_child(THIRD_CHILD, [EPIC_CHILD])]], rows)).toEqual(
			[],
		)
	})
})

describe('backlog_pool.settle_standalone', () => {
	// A row blocked from outside the backlog needs a person, and so does the row waiting on it.
	it('takes out a row waiting on a row that is blocked from outside, however long the chain', () => {
		const outside_blocked = auto_ok_fixture.blocked_issue(ROW_NUMBER, CREATED_EARLIER, [
			{ number: BLOCKER_NUMBER, state: 'OPEN' },
		])
		const behind = auto_ok_fixture.blocked_issue(THIRD_CHILD, CREATED_EARLIER, [
			{ number: ROW_NUMBER, state: 'OPEN' },
		])
		const running = backlog_pool.running_set([], [outside_blocked, behind], READING_REPO)

		expect(running.size).toBe(0)
	})
})
