import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { report_format_reference } from './report-format-reference'
import { report_labels } from './report-labels'
import { report_lint_child_summary } from './report-lint-child-summary'

// The labels are passed explicitly, so `JOSH_SESSION_LANG` never decides a result.
const JA = report_labels.JAPANESE_LABELS
const EN = report_labels.ENGLISH_LABELS
const MAX = report_labels.CHILD_SUMMARY_MAX_LINES
const MISSING_RESULT = '✖ missing label: 結果'

function lint(summary: string): ReadonlyArray<string> {
	return report_lint_child_summary.lint_child_summary(summary, JA)
}

const CONFORMING_SUMMARY = [
	'- **原因**: the lint read stdin only as a work summary',
	'- **対応**: a child-summary mode beside it',
	'- **結果**: merged; the gate was green',
	'- observation: `scripts/report/report-lint.ts` is near its file limit',
].join('\n')

function padded_to(count: number): string {
	const filler = Array.from({ length: count - 3 }, (_, index) => `- note ${String(index)}`)

	return [...CONFORMING_SUMMARY.split('\n').slice(0, 3), ...filler].join('\n')
}

describe('report_lint_child_summary.lint_child_summary — a conforming summary', () => {
	it('passes a summary with the three labels and no file list', () => {
		expect(lint(CONFORMING_SUMMARY)).toEqual([])
	})

	it('passes exactly the line bound', () => {
		expect(lint(padded_to(MAX))).toEqual([])
	})

	it('does not count blank lines toward the bound', () => {
		expect(lint(padded_to(MAX).replaceAll('\n', '\n\n'))).toEqual([])
	})

	it('passes one path-only bullet on its own', () => {
		expect(lint(`${CONFORMING_SUMMARY}\n- \`scripts/report/report-lint.ts\``)).toEqual([])
	})

	it('reads the English labels when they are passed', () => {
		const english = CONFORMING_SUMMARY.replace('原因', 'Cause')
			.replace('対応', 'Fix')
			.replace('結果', 'Result')

		expect(report_lint_child_summary.lint_child_summary(english, EN)).toEqual([])
	})
})

describe('report_lint_child_summary.lint_child_summary — violations', () => {
	it('flags a summary one line over the bound', () => {
		expect(lint(padded_to(MAX + 1))).toEqual([
			`✖ ${String(MAX + 1)} lines — the summary holds at most ${String(MAX)}`,
		])
	})

	it('flags each missing label', () => {
		expect(lint('- nothing labelled here')).toEqual([
			'✖ missing label: 原因',
			'✖ missing label: 対応',
			MISSING_RESULT,
		])
	})

	it('does not count a label found inside a longer word', () => {
		const violations = report_lint_child_summary.lint_child_summary(
			'- **Causes**: x\n- **Fix**: y\n- **Result**: z',
			EN,
		)

		expect(violations).toEqual(['✖ missing label: Cause'])
	})

	it('does not count a label found mid-line', () => {
		const violations = lint(
			'- **原因**: x\n- **対応**: y\n- テスト結果: green\n- this Result is not a label',
		)

		expect(violations).toEqual([MISSING_RESULT])
	})
})

describe('report_lint_child_summary.lint_child_summary — a changed-file list', () => {
	it('flags two path-only bullets in a row', () => {
		expect(lint(`${CONFORMING_SUMMARY}\n1. a/b.ts\n2. c.md`)).toEqual([
			'✖ changed-file list (2 path-only items) — GitHub carries it: 1. a/b.ts',
		])
	})

	it('flags a run of path-only bullets as a changed-file list', () => {
		const with_list = `${CONFORMING_SUMMARY}\n- \`scripts/a.ts\`\n- scripts/b.ts\n* c.md`

		expect(lint(with_list)).toEqual([
			'✖ changed-file list (3 path-only items) — GitHub carries it: - `scripts/a.ts`',
		])
	})

	it('does not flag bullets that carry prose beside a path', () => {
		const prose = `${CONFORMING_SUMMARY}\n- \`scripts/a.ts\` grew past its limit\n- \`scripts/b.ts\` too`

		expect(lint(prose)).toEqual([])
	})
})

describe('report_labels.CHILD_SUMMARY_MAX_LINES', () => {
	it('is the bound the backlogrun child document states', () => {
		const document = readFileSync(report_format_reference.CHILD_SUMMARY_PATH, 'utf8')

		expect(document).toContain(`in at most ${String(MAX)} lines`)
	})
})

describe('report_lint_child_summary.with_reference', () => {
	it('leaves a clean summary empty', () => {
		expect(report_lint_child_summary.with_reference([])).toEqual([])
	})

	it('ends the violations with the pointer to the summary section', () => {
		expect(report_lint_child_summary.with_reference(['✖ x'])).toEqual([
			'✖ x',
			`→ the shape: ${report_format_reference.child_summary_pointer()}`,
		])
	})
})
