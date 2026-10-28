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

	// joshuafolkken/kit#4861: causes of one lane are ranked by the minutes each lost.
	it('puts the child whose cause lost more first among causes of one lane', () => {
		const small = `${lane_body(98)}- 原因の損失: 4 分\n`
		const large = `${lane_body(98)}- 原因の損失: 16 分\n`
		const children = [child(1, small), child(2, large)]

		expect(epic_rank.rank(children, children).map((entry) => entry.number)).toStrictEqual([2, 1])
	})

	// joshuafolkken/kit#5302: the body's declared weekly speed-up reaches the ranking.
	it('puts the child that declares an expected effect ahead of undeclared ones', () => {
		const effect = '## 期待効果\n\n- 効く率: 週 5 回\n- 1 回あたりの得: 約 250 秒\n'
		const children = [child(1), child(2), child(3, effect)]

		expect(epic_rank.rank(children, children).map((entry) => entry.number)).toStrictEqual([3, 1, 2])
	})
})
