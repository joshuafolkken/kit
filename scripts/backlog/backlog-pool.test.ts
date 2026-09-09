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
