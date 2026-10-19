import { describe, expect, it } from 'vitest'
import { report_labels } from './report-labels'
import { report_lint } from './report-lint'
import { report_template, type ChangeInput } from './report-template'

// joshuafolkken/kit#4157: the skeletons come from the label table `report:lint` checks, so a printed
// summary passes the lint in either language, and the path-derived lines are filled in.

const JA = report_labels.JAPANESE_LABELS
const EN = report_labels.ENGLISH_LABELS
const NETWORK_CASES = ['接続失敗', 'タイムアウト', '不正な応答', '再試行']
const CHANGES: ReadonlyArray<ChangeInput> = [
	{ path: 'scripts/a.ts', abnormal_cases: [] },
	{ path: 'scripts/b.ts', abnormal_cases: NETWORK_CASES },
]

describe('report_template.build — the summary passes report:lint', () => {
	it.each([
		['ja', JA],
		['en', EN],
	])('in %s with no path', (_lang, labels) => {
		expect(report_lint.lint_report(report_template.build('summary', [], labels), labels)).toEqual(
			[],
		)
	})

	it.each([
		['ja', JA],
		['en', EN],
	])('in %s with several paths', (_lang, labels) => {
		const summary = report_template.build('summary', CHANGES, labels)

		expect(report_lint.lint_report(summary, labels)).toEqual([])
	})
})

describe('report_template.build — the filled lines', () => {
	it('lists every path as a target and gives each its own change block', () => {
		const summary = report_template.build('summary', CHANGES, EN)

		expect(summary).toContain(`- ${EN.target}: \`scripts/a.ts\`, \`scripts/b.ts\``)
		expect(summary).toContain('1. `scripts/a.ts`: ')
		expect(summary).toContain('2. `scripts/b.ts`: ')
	})

	it('opens the break tier with the owed abnormal cases, with no padding past three', () => {
		const summary = report_template.build('summary', CHANGES, JA)

		expect(summary).toContain(
			NETWORK_CASES.map((text, index) => `${String(index + 1)}. ${text}`).join('\n     '),
		)
		expect(summary).not.toContain(`${String(NETWORK_CASES.length + 1)}. <…>`)
	})

	it('lists the changed files in the completion report', () => {
		expect(report_template.build('done', CHANGES, JA)).toContain(
			`- ${JA.changed_files}: \`scripts/a.ts\`, \`scripts/b.ts\``,
		)
	})
})

describe('report_template.build — the skeleton shapes', () => {
	it.each([
		['summary', 'ja', JA],
		['summary', 'en', EN],
		['done', 'ja', JA],
		['done', 'en', EN],
	] as const)('%s in %s', (kind, _lang, labels) => {
		expect(report_template.build(kind, [], labels)).toMatchSnapshot()
	})
})

describe('report_template.is_kind', () => {
	it.each(['summary', 'done'])('accepts %s', (kind) => {
		expect(report_template.is_kind(kind)).toBe(true)
	})

	it.each(['', 'handoff', 'Summary'])('refuses %s', (kind) => {
		expect(report_template.is_kind(kind)).toBe(false)
	})
})
