import { describe, expect, it } from 'vitest'
import { effect_audit, type FollowUp } from './effect-audit'
import { MEASURED_LABEL, MEASURED_UNMET_LABEL } from './issue-labels'
import type { SearchIssue } from './issue-search'

// joshuafolkken/kit#4958: each closed run-time-shortening issue is set beside the follow-up that cites
// it and that follow-up's recorded verdict.

const ORIGIN = 4896
const FOLLOW_UP = 4897
const OTHER = 4898
const ORIGIN_BODY = [
	'## 背景',
	'',
	'- 目的: 時間短縮',
	'',
	'## 期待効果',
	'',
	'- 効く率: 9 割',
	'- 1 回あたりの得: 30 s',
	'- 外れたときの損: 0 s',
	'- 出典: lane:stats',
].join('\n')

function issue(number: number, body: string, labels: ReadonlyArray<string> = []): SearchIssue {
	return { number, title: `Issue ${String(number)}`, state: 'closed', body, labels }
}

// The body names a bystander as well, the way a measurement names its parent or the lanes it compares.
const FOLLOW_UP_BODY = `## 背景\n\n- 実施可能条件: #4899 のマージ後 10 マージ\n\n#${String(ORIGIN)} の効果。比較: #${String(OTHER)}`

function follow_up(labels: ReadonlyArray<string>, measures: number = ORIGIN): FollowUp {
	return { issue: issue(FOLLOW_UP, FOLLOW_UP_BODY, labels), measures }
}

describe('effect_audit.rows — the verdict', () => {
	it.each([
		['measured:unmet', [MEASURED_LABEL, MEASURED_UNMET_LABEL], 'unmet'],
		['measured alone', [MEASURED_LABEL], 'met'],
		['an unmeasured follow-up', [], 'unmeasured'],
	] as const)('reads %s', (_case, labels, result) => {
		const [row] = effect_audit.rows([issue(ORIGIN, ORIGIN_BODY)], [follow_up(labels)])

		expect(row?.result).toBe(result)
	})

	it('answers unmeasured with no follow-up, and drops an issue that does not declare the aim', () => {
		const rows = effect_audit.rows(
			[issue(ORIGIN, ORIGIN_BODY), issue(OTHER, '## 背景\n\n- 目的: 時間短縮の確認')],
			[],
		)

		expect(rows.map((row) => [row.origin.number, row.result])).toStrictEqual([
			[ORIGIN, 'unmeasured'],
		])
	})

	it('credits a follow-up only to the issue it measures, not to another issue its body names', () => {
		const rows = effect_audit.rows(
			[issue(ORIGIN, ORIGIN_BODY), issue(OTHER, ORIGIN_BODY)],
			[follow_up([MEASURED_LABEL, MEASURED_UNMET_LABEL])],
		)
		const verdicts = rows.map((row) => [row.origin.number, row.follow_ups.length, row.result])

		expect(verdicts).toStrictEqual([
			[ORIGIN, 1, 'unmet'],
			[OTHER, 0, 'unmeasured'],
		])
	})
})

describe('effect_audit.cited_pull — what makes an issue a follow-up', () => {
	it('reads the pull request of the run condition, and nothing from a bare mention', () => {
		const mention = issue(OTHER, `#${String(ORIGIN)} の続き`)

		expect(effect_audit.cited_pull(issue(FOLLOW_UP, FOLLOW_UP_BODY))).toBe(4899)
		expect(effect_audit.cited_pull(mention)).toBeUndefined()
	})
})

describe('effect_audit.format_row and summary', () => {
	it('prints the expected effect, the follow-ups and the verdict on one line', () => {
		const [row] = effect_audit.rows([issue(ORIGIN, ORIGIN_BODY)], [follow_up([MEASURED_LABEL])])

		expect(row === undefined ? '' : effect_audit.format_row(row)).toBe(
			'#4896 — 期待効果: 効く率 9 割 · 1 回あたりの得 30 s · 外れたときの損 0 s — 後続計測: #4897 (closed) — 結果: 届いた',
		)
	})

	it('tallies each verdict', () => {
		const rows = effect_audit.rows([issue(ORIGIN, ORIGIN_BODY)], [])

		expect(effect_audit.summary(rows, '2026-09-26')).toBe(
			'effect:audit — closed since 2026-09-26: 1 issues · 届いた 0 · 届かなかった 0 · 未計測 1',
		)
	})
})

describe('effect_audit.draft_body — the retirement candidate', () => {
	it('cites the origin and the measurement that fell short, leaving the filer placeholders', () => {
		const [row] = effect_audit.rows(
			[issue(ORIGIN, ORIGIN_BODY)],
			[follow_up([MEASURED_LABEL, MEASURED_UNMET_LABEL])],
		)
		const body = row === undefined ? '' : effect_audit.draft_body(row)

		expect(body).toContain('- 出どころ: #4897 の計測（`measured:unmet`）')
		expect(body).toContain('- [ ] #4896 で足した機構を撤去するか縮小し')
		expect(body).toContain('- 規模見積もり: 約 <N> ファイル / <M> 行（テスト除く）')
		expect(row === undefined ? '' : effect_audit.draft_title(row)).toContain('#4896')
	})
})
