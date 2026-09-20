import { describe, expect, it } from 'vitest'
import { issue_lint } from './issue-lint'

const CONFORMING_BODY = [
	'## 背景',
	'',
	'なぜ必要か',
	'',
	'## 現象',
	'',
	'現在の問題',
	'',
	'## 期待結果',
	'',
	'どうなれば完了か',
	'',
	'## 受け入れ条件',
	'',
	'- [ ] 条件1',
].join('\n')

describe('issue_lint.missing_headings', () => {
	it('accepts a body with every required heading', () => {
		expect(issue_lint.missing_headings(CONFORMING_BODY)).toEqual([])
	})

	it('names the heading a body is missing', () => {
		const without_phenomenon = CONFORMING_BODY.replace('## 現象', '## その他')

		expect(issue_lint.missing_headings(without_phenomenon)).toEqual(['## 現象'])
	})

	it('does not accept a heading mentioned inside a sentence', () => {
		const inline = CONFORMING_BODY.replace('## 背景\n', 'この Issue の ## 背景 について\n')

		expect(issue_lint.missing_headings(inline)).toContain('## 背景')
	})
})
