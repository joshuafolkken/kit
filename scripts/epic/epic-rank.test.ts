import { defect_rate } from '#scripts/issue/defect-rate'
import { PRIORITY_HIGH_LABEL } from '#scripts/issue/issue-labels'
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

	// joshuafolkken/kit#5310: the body's run-last declaration reaches the ranking.
	it('puts the child that declares it runs last behind undeclared ones', () => {
		const children = [child(1, '## 背景\n\n- 実施順: 最後\n'), child(2), child(3)]

		expect(epic_rank.rank(children, children).map((entry) => entry.number)).toStrictEqual([2, 3, 1])
	})

	// joshuafolkken/kit#7912: the body's defect declaration reaches the defect key, with no label.
	it('puts the child whose body declares a defect ahead of an older one (ac-ac7a05a2)', () => {
		const children = [child(1), child(2, defect_rate.DEFECT_DECLARATION_LINE)]

		expect(epic_rank.rank(children, children).map((entry) => entry.number)).toStrictEqual([2, 1])
	})
})

// joshuafolkken/kit#8541: a child blocking an open priority:high child ranks in the high class; one
// blocking a closed priority:high child does not.
function ranked_beside_urgent(state: EpicChild['state']): Array<number> {
	const urgent: EpicChild = {
		...child(2),
		state,
		labels: [PRIORITY_HIGH_LABEL],
		blocked_by: [{ number: 3, repo: REPO }],
	}
	const children = [child(1), child(3)]

	return epic_rank.rank(children, [...children, urgent]).map((entry) => entry.number)
}

// joshuafolkken/kit#8571: a run of children declaring one file goes ahead of an older independent
// child of its priority, and never ahead of a higher priority class.
const SAME_FILE_BODY = '## 変更\n\n- `scripts/run/board/run-board-seat.ts` を直す\n'
const OTHER_FILE_BODY = '## 変更\n\n- `scripts/lines/effective-limit.ts` を直す\n'

function same_file_run(): Array<EpicChild> {
	return [child(2, SAME_FILE_BODY), child(3, SAME_FILE_BODY), child(4, SAME_FILE_BODY)]
}

describe('epic_rank.rank path-overlap run', () => {
	it('puts the same-file run ahead of an older non-overlapping child (ac-5c644983)', () => {
		const children = [child(1, OTHER_FILE_BODY), ...same_file_run()]

		expect(epic_rank.rank(children, children).map((entry) => entry.number)).toStrictEqual([
			2, 3, 4, 1,
		])
	})

	it('keeps a priority:high non-overlapping child ahead of the run', () => {
		const urgent: EpicChild = { ...child(1, OTHER_FILE_BODY), labels: [PRIORITY_HIGH_LABEL] }
		const children = [urgent, ...same_file_run()]

		expect(epic_rank.rank(children, children).map((entry) => entry.number)).toStrictEqual([
			1, 2, 3, 4,
		])
	})

	it('does not count the same path in another repository as an overlap', () => {
		const elsewhere: EpicChild = { ...child(3, SAME_FILE_BODY), repo: 'joshuafolkken/other' }
		const children = [child(1, OTHER_FILE_BODY), child(2, SAME_FILE_BODY), elsewhere]

		expect(epic_rank.rank(children, children).map((entry) => entry.number)).toStrictEqual([1, 2, 3])
	})
})

describe('epic_rank.rank blocked priority class', () => {
	it('lifts the blocker of an open priority:high child into the high class', () => {
		expect(ranked_beside_urgent('OPEN')).toStrictEqual([3, 1])
	})

	it('does not lift the blocker of a closed priority:high child (ac-a55d5ed8)', () => {
		expect(ranked_beside_urgent('CLOSED')).toStrictEqual([1, 3])
	})
})
