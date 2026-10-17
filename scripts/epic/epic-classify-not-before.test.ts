import { describe, expect, it } from 'vitest'
import { epic_classify } from './epic-classify'
import type { EpicChild } from './epic-graph'

const REPO = 'joshuafolkken/kit'
const FUTURE = '2999-01-01T00:00Z'
const PAST = '2000-01-01T00:00Z'

function dated_child(number: number, date: string): EpicChild {
	return {
		number,
		repo: REPO,
		state: 'OPEN',
		labels: [],
		blocked_by: [],
		body: `## 背景\n\n- 実施可能日: ${date}\n`,
	}
}

describe('epic_classify — a child held until its declared start time', () => {
	it('waits on a child whose start time is still ahead', () => {
		expect(epic_classify.local_category(dated_child(1, FUTURE))).toBe('time')
	})

	it('runs a child whose start time has passed', () => {
		const result = epic_classify.classify_children([dated_child(1, PAST)])

		expect(result.runnable.map((entry) => entry.number)).toEqual([1])
	})

	it('waits on the child behind a held one', () => {
		const behind: EpicChild = { ...dated_child(2, PAST), blocked_by: [{ repo: REPO, number: 1 }] }
		const result = epic_classify.classify_children([dated_child(1, FUTURE), behind])

		expect(result.time.map((entry) => entry.number)).toEqual([1, 2])
	})
})
