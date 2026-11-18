import { describe, expect, it } from 'vitest'
import { size_estimate } from './size-estimate'
import { size_estimate_target } from './size-estimate-target'

// joshuafolkken/kit#7925: an Issue projecting past the lane target is split by default; only a
// no-split reason opening with one of the three kinds keeps it one Issue.

const TARGET_HINT = 'lane target'
const OVER = 31
const WITHIN = 30
const RATE = { median: 20, lanes: 10 }
const GROWTH = { files: 2, lines: 2 }

function body_with(...lines: ReadonlyArray<string>): string {
	return ['## 背景', '', '- 種別: 非不具合', ...lines, '', '## 現象', '', 'x'].join('\n')
}

describe('size_estimate_target.problem', () => {
	it('does not judge a projection within the target', () => {
		expect(size_estimate_target.problem(WITHIN)).toBeUndefined()
	})

	it('does not judge with no projection', () => {
		expect(size_estimate_target.problem(undefined)).toBeUndefined()
	})

	it('refuses a projection over the target with no reason, naming the split steps', () => {
		expect(size_estimate_target.problem(OVER)).toEqual(expect.stringContaining('--route split'))
	})

	it('refuses a reason with no kind over the target', () => {
		expect(size_estimate_target.problem(OVER, '1 コミットで入れないと壊れる')).toEqual(
			expect.stringContaining(TARGET_HINT),
		)
	})

	it('refuses a kind with no reason after it', () => {
		expect(size_estimate_target.problem(OVER, '分けられない —')).toEqual(
			expect.stringContaining(TARGET_HINT),
		)
	})

	it.each(size_estimate_target.KINDS)('passes a reason of kind %s', (kind) => {
		expect(size_estimate_target.problem(OVER, `${kind} — 理由`)).toBeUndefined()
	})
})

// The plan-time bodies of joshuafolkken/kit#7866 and joshuafolkken/kit#7889 — each declared a reason
// with no kind and projected past the target.
const PLAN_TIME_7866 = body_with(
	'- 規模見積もり: 約 8 ファイル / 170 行（テスト除く）',
	'- 分割しない理由: 共通の除外区間の関数・終了イベントへの除外分の保存・時間セルの表示は 1 つの振る舞いで、どれか 1 つだけでは表示も計測も変わらない中間版になる。接続記録は別の子に分けてある',
)
const PLAN_TIME_7889 = body_with(
	'- 規模見積もり: 約 11 ファイル / 190 行（テスト除く）',
	'- 分割しない理由: 送信の記録と回答の書き足しは同じ台帳の 1 行を読み書きする 1 つの形で、片方だけをマージしても待ち時間が出ない',
)

describe('size_estimate.guide_problem against the lane target', () => {
	it.each([PLAN_TIME_7866, PLAN_TIME_7889])('refuses a plan-time body past the target', (body) => {
		expect(size_estimate.guide_problem(body, undefined, RATE, GROWTH)).toEqual(
			expect.stringContaining(TARGET_HINT),
		)
	})

	it('passes the same body once its reason names a kind', () => {
		const named = PLAN_TIME_7889.replace('分割しない理由: ', '分割しない理由: 全体が遅くなる — ')

		expect(size_estimate.guide_problem(named, undefined, RATE, GROWTH)).toBeUndefined()
	})

	it('leaves a body within the target to the existing judgement', () => {
		const small = body_with('- 規模見積もり: 約 2 ファイル / 30 行（テスト除く）')

		expect(size_estimate.guide_problem(small, undefined, RATE, GROWTH)).toBeUndefined()
	})

	it('does not judge the target with no measured rate', () => {
		expect(size_estimate.guide_problem(PLAN_TIME_7866, undefined)).toBeUndefined()
	})
})
