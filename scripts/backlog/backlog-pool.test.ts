import { auto_ok_fixture, CREATED_EARLIER } from '#scripts/auto-ok/auto-ok-fixture'
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
const STANDALONE_CONTEXT = { tracked: new Map<number, number>(), exclude: [], repo: READING_REPO }

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
