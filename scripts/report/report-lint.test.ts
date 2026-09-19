import { describe, expect, it } from 'vitest'
import { report_lint } from './report-lint'

const PATH_VIOLATION = 'file path or CLI flag'
const NOW_SENTENCE = '利用者から見て何が起きているかを一文で書く。'
const FIX_SENTENCE = '直した後どうなるかを一文で書く。'
const CHECK_SENTENCE = 'どう確認するかを一文で書く。'

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
	'**変更とテスト**',
	'',
	'1. change — Test: Unit — `scripts/foo/bar.ts` — it works',
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
