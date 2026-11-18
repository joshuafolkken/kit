import { describe, expect, it } from 'vitest'
import { issue_declaration_line } from './issue-declaration-line'

const KIND = issue_declaration_line.declaration_lines(['kind', 'purpose'])
const LINES = ['- 種別: 不具合', '- 原因: #12']

describe('issue_declaration_line.with_declaration_lines', () => {
	it('drops the declarations in either language and closes the declaration block', () => {
		const body = '## 背景\n\n- Type: non-defect\n- 目的: 機能追加\n- 優先度: 通常\n\n本文\n'

		expect(issue_declaration_line.with_declaration_lines(body, KIND, LINES)).toBe(
			'## 背景\n\n- 優先度: 通常\n- 種別: 不具合\n- 原因: #12\n\n本文\n',
		)
	})

	it('appends the lines to a body with no background section', () => {
		expect(issue_declaration_line.with_declaration_lines('本文', KIND, LINES)).toBe(
			'本文\n- 種別: 不具合\n- 原因: #12\n',
		)
	})

	it('puts the lines first in a background section with no bullets', () => {
		expect(issue_declaration_line.with_declaration_lines('## 背景', KIND, LINES)).toBe(
			'## 背景\n- 種別: 不具合\n- 原因: #12\n',
		)
	})
})

describe('issue_declaration_line.declared', () => {
	it('lists the matched lines trimmed and in order', () => {
		const body = '## 背景\n\n- 種別: 非不具合\n- 優先度: 通常\n- 目的: 機能追加\n'

		expect(issue_declaration_line.declared(body, KIND)).toStrictEqual([
			'- 種別: 非不具合',
			'- 目的: 機能追加',
		])
	})
})
