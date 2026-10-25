import { describe, expect, it } from 'vitest'
import type { EpicChild } from './epic-graph'
import { epic_rank } from './epic-rank'

// joshuafolkken/kit#4859: a graph child's body carries its causing-lane minutes into the ranking.

const REPO = 'joshuafolkken/kit'

function child(number: number, body?: string): EpicChild {
	return { number, repo: REPO, state: 'OPEN', labels: [], blocked_by: [], body }
}

function lane_body(minutes: number): string {
	return `## 背景\n\n- 原因のレーン: ${String(minutes)} 分（#4794）\n`
}

describe('epic_rank.rank', () => {
	it('puts the child whose body declares the larger causing lane first', () => {
		const children = [child(1), child(2, lane_body(4)), child(3, lane_body(16))]

		expect(epic_rank.rank(children, children).map((entry) => entry.number)).toStrictEqual([3, 2, 1])
	})
})
