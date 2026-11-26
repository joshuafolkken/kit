import { describe, expect, it } from 'vitest'
import { escape_reason_lint } from './escape-reason-lint'

const BUG = '## 背景\n\n- 種別: 不具合\n- 原因: #1\n'
const NON_BUG = '## 背景\n\n- 種別: 非不具合\n'

describe('escape_reason_lint.problem (joshuafolkken/kit#8941)', () => {
	it('refuses a bug body with no escape reason line', () => {
		expect(escape_reason_lint.problem(BUG)).toMatch(/^missing escape reason: /u)
	})

	it.each(['', ' <既存のテストが見逃した理由>'])(
		'refuses a bug body whose escape reason is empty or a placeholder (%j)',
		(reason) => {
			expect(escape_reason_lint.problem(`${BUG}- 検出漏れの理由:${reason}\n`)).toBeDefined()
		},
	)

	it('refuses an escape reason written only inside a fenced block', () => {
		expect(
			escape_reason_lint.problem(`${BUG}\n\`\`\`\n- 検出漏れの理由: 一覧に無かった\n\`\`\`\n`),
		).toBeDefined()
	})

	it.each(['テストが手書きの一覧だけを回した', '<details> の中を読むテストが無かった'])(
		'admits a bug body that names its escape reason (%j)',
		(reason) => {
			expect(escape_reason_lint.problem(`${BUG}- 検出漏れの理由: ${reason}\n`)).toBeUndefined()
		},
	)

	it('admits a bug body written in the English column', () => {
		const body = '## Background\n\n- Type: defect\n- Origin: #1\n- Escape reason: no test ran it\n'

		expect(escape_reason_lint.problem(body)).toBeUndefined()
	})

	it('leaves a non-bug body out', () => {
		expect(escape_reason_lint.problem(NON_BUG)).toBeUndefined()
	})
})
