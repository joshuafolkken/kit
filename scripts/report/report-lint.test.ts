import { describe, expect, it } from 'vitest'
import { report_lint } from './report-lint'

const PATH_VIOLATION = 'file path or CLI flag'
const CHANGES_HEADER = '**変更とテスト**'
const NOW_SENTENCE = '利用者から見て何が起きているかを一文で書く。'
const FIX_SENTENCE = '直した後どうなるかを一文で書く。'
const CHECK_SENTENCE = 'どう確認するかを一文で書く。'

const CHANGE_LINE = '1. change — Test: Unit — `scripts/foo/bar.ts` — it works'
const CASE_TIER_LINE = '   - ケース: 正常 / 境界 / 重複: 該当なし — 入力は集合なので重複しない'
const BREAK_TIER_LABEL = '   - 壊れるとしたら:'
const THIRD_CONDITION = '     3. null 入力で例外を投げる'
const BREAK_TIER = [
	BREAK_TIER_LABEL,
	'     1. 空配列で落ちる',
	'     2. 並行呼び出しで競合する',
	THIRD_CONDITION,
]

const CONFORMING_SUMMARY = [
	'**■ 概要**',
	'',
	`- **今こうなっている**: ${NOW_SENTENCE}`,
	`- **こう直す**: ${FIX_SENTENCE}`,
	`- **確かめ方**: ${CHECK_SENTENCE}`,
	'',
	'**技術詳細**',
	'',
	'- 対象: some module',
	'',
	CHANGES_HEADER,
	'',
	CHANGE_LINE,
	CASE_TIER_LINE,
	...BREAK_TIER,
].join('\n')

function replace_once(summary: string, target: string, replacement: string): string {
	return summary.replace(target, () => replacement)
}

describe('report_lint.lint_report — a conforming summary', () => {
	it('accepts a summary that follows the shape', () => {
		expect(report_lint.lint_report(CONFORMING_SUMMARY)).toEqual([])
	})

	it('leaves file paths in the changes section alone', () => {
		expect(report_lint.lint_report(CONFORMING_SUMMARY)).toEqual([])
	})
})

describe('report_lint.lint_report — violations', () => {
	it('flags a summary wrapped in a code fence', () => {
		const fenced = ['```md', CONFORMING_SUMMARY, '```'].join('\n')

		expect(report_lint.lint_report(fenced).some((line) => line.includes('code fence'))).toBe(true)
	})

	it('flags a missing label', () => {
		const without_details = replace_once(CONFORMING_SUMMARY, '**技術詳細**', '**something else**')

		expect(
			report_lint
				.lint_report(without_details)
				.some((line) => line.includes('missing label: 技術詳細')),
		).toBe(true)
	})

	it('flags an overview line over the character ceiling', () => {
		const long_sentence = 'あ'.repeat(report_lint.MAX_OVERVIEW_CHARS + 1)
		const over = replace_once(CONFORMING_SUMMARY, NOW_SENTENCE, long_sentence)

		expect(report_lint.lint_report(over).some((line) => line.includes('over'))).toBe(true)
	})

	it('flags a file path in the overview', () => {
		const with_path = replace_once(CONFORMING_SUMMARY, FIX_SENTENCE, 'scripts/foo/bar.ts を直す。')

		expect(report_lint.lint_report(with_path).some((line) => line.includes(PATH_VIOLATION))).toBe(
			true,
		)
	})

	it('flags a CLI flag in the overview', () => {
		const with_flag = replace_once(
			CONFORMING_SUMMARY,
			CHECK_SENTENCE,
			'--notify-message で確認する。',
		)

		expect(report_lint.lint_report(with_flag).some((line) => line.includes(PATH_VIOLATION))).toBe(
			true,
		)
	})
})

const ONE_LINE_CHANGES = [CHANGES_HEADER, '', CHANGE_LINE].join('\n')
const CASE_TIER_WITHOUT_REASON = '   - ケース: 正常 / 重複: 該当なし'

describe('report_lint.lint_report — case-based test declaration', () => {
	it('accepts the two-tier case declaration', () => {
		expect(report_lint.lint_report(CONFORMING_SUMMARY)).toEqual([])
	})

	it('flags the old one-line declaration that lists no cases', () => {
		const old_format = replace_once(
			CONFORMING_SUMMARY,
			CONFORMING_SUMMARY.slice(CONFORMING_SUMMARY.indexOf(CHANGES_HEADER)),
			ONE_LINE_CHANGES,
		)

		expect(report_lint.lint_report(old_format).length).toBeGreaterThan(0)
	})

	it('flags an N/A cross-out with no reason after it', () => {
		const no_reason = replace_once(CONFORMING_SUMMARY, CASE_TIER_LINE, CASE_TIER_WITHOUT_REASON)
		const report = report_lint.lint_report(no_reason)

		expect(report.some((line) => line.includes(report_lint.NA_LABEL))).toBe(true)
	})

	it('flags a second tier with fewer than the required conditions', () => {
		const two_conditions = replace_once(CONFORMING_SUMMARY, `\n${THIRD_CONDITION}`, '')
		const report = report_lint.lint_report(two_conditions)

		expect(report.some((line) => line.includes(report_lint.BREAK_LABEL))).toBe(true)
	})

	it('accepts the never-breaks escape in place of three conditions', () => {
		const escaped = replace_once(
			CONFORMING_SUMMARY,
			BREAK_TIER.join('\n'),
			`${BREAK_TIER_LABEL} ${report_lint.NO_BREAK_ESCAPE}`,
		)

		expect(report_lint.lint_report(escaped)).toEqual([])
	})
})

describe('report_lint.lint_report — N/A per segment', () => {
	it('flags a reasonless N/A that follows one that carries a reason on the same line', () => {
		const trailing_na = `${CASE_TIER_LINE} / 順序: 該当なし`
		const mixed = replace_once(CONFORMING_SUMMARY, CASE_TIER_LINE, trailing_na)
		const report = report_lint.lint_report(mixed)

		expect(report.some((line) => line.includes(report_lint.NA_LABEL))).toBe(true)
	})
})

describe('report_lint.lint_report — inline emphasis', () => {
	it('checks the whole sentence even when it carries inline bold emphasis', () => {
		const with_emphasis = replace_once(
			CONFORMING_SUMMARY,
			FIX_SENTENCE,
			'この scripts/foo/bar.ts を **強調** して直す。',
		)

		expect(
			report_lint.lint_report(with_emphasis).some((line) => line.includes(PATH_VIOLATION)),
		).toBe(true)
	})
})
