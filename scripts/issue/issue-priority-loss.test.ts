import { describe, expect, it } from 'vitest'
import { PRIORITY_HIGH_LABEL } from './issue-labels'
import { issue_priority } from './issue-priority'

// joshuafolkken/kit#4960: cause-loss lines summing to 30 minutes or more set the high floor.

const BASE = ['enhancement']
const NORMAL_LINE = '- 優先度: 通常'

function body(declaration: string, extra: string): string {
	return `## 背景\n\n- 種別: 非不具合\n- 目的: 時間短縮\n${extra}${declaration}\n\n## 期待効果\n\n`
}

function loss(...minutes: ReadonlyArray<string>): string {
	return minutes.map((value) => `- 原因の損失: ${value} 分\n`).join('')
}

describe('issue_priority.floor_of — summed cause-loss minutes', () => {
	it.each([
		['29 minutes', loss('29'), 'normal'],
		['30 minutes', loss('30'), 'high'],
		['two recurrences summing to 30', loss('12', '18'), 'high'],
		['a 60-minute causing lane alone', '- 原因のレーン: 60 分（#4695）\n', 'normal'],
	])('reads %s as %s', (_case, extra, level) => {
		expect(issue_priority.floor_of(body('', extra))).toBe(level)
	})

	it('holds the threshold in one named constant', () => {
		expect(issue_priority.LOSS_HIGH_MINUTES).toBe(30)
	})
})

describe('issue_priority.problem — a cause-loss floor', () => {
	it('refuses a normal declaration, naming the summed minutes as the floor', () => {
		const refusal = issue_priority.problem(body(NORMAL_LINE, loss('12', '20')), [])

		expect(refusal).toContain('`high`')
		expect(refusal).toContain("the cause-loss lines' sum of 32 minutes (30 or more)")
		expect(refusal).toContain('原因の損失 …')
	})

	it('accepts a normal declaration below the floor', () => {
		const filed = body(NORMAL_LINE, loss('29'))

		expect(issue_priority.problem(filed, [])).toBeUndefined()
	})

	it('files a body that declares no priority at high', () => {
		const filed = body('', loss('30'))

		expect(issue_priority.problem(filed, [])).toBeUndefined()
		expect(issue_priority.with_label(BASE, filed)).toStrictEqual([...BASE, PRIORITY_HIGH_LABEL])
	})

	it('names both floors when a caused park line sits beside the losses', () => {
		const refusal = issue_priority.problem(
			body(NORMAL_LINE, `- 原因の park: #4703\n${loss('30')}`),
			[],
		)

		expect(refusal).toContain("the security finding or caused park and the cause-loss lines' sum")
	})
})
