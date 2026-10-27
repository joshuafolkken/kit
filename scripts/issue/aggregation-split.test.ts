import { describe, expect, it } from 'vitest'
import { aggregation_split } from './aggregation-split'

const AGGREGATION = '- [ ] トランスクリプトからフィルタの形を集計し Issue にコメントで記録する'
const IMPLEMENTATION = '- [ ] `issue:lint` が拒否する'

function body(files: number, criterion: string): string {
	return [
		'## 背景',
		'',
		`- 規模見積もり: 約 ${String(files)} ファイル / 80 行（テスト除く）`,
		'',
		'## 受け入れ条件',
		'',
		criterion,
		'',
	].join('\n')
}

describe('aggregation_split.problems', () => {
	it('refuses an aggregation-comment criterion beside an implementation estimate', () => {
		const [problem] = aggregation_split.problems(
			body(aggregation_split.IMPLEMENTATION_FILES, AGGREGATION),
		)

		expect(problem).toContain('--route split')
		expect(problem).toContain('prior Issue')
	})

	it.each([
		{ name: 'an aggregation alone', files: 1, criterion: AGGREGATION },
		{ name: 'an implementation alone', files: 6, criterion: IMPLEMENTATION },
		{
			name: 'an implementation citing the prior aggregation',
			files: 6,
			criterion: '- [ ] #5200 のコメントに記録した Issue の集計に沿って実装する',
		},
		{
			name: 'a feature posting an aggregate as a PR comment',
			files: 6,
			criterion: '- [ ] `josh metrics` が失敗を集計し PR コメントに投稿する',
		},
	])('passes $name', ({ files, criterion }) => {
		expect(aggregation_split.problems(body(files, criterion))).toStrictEqual([])
	})

	it('ignores an aggregation mentioned outside the acceptance criteria', () => {
		const text = `## 背景\n\n${AGGREGATION}\n${body(6, IMPLEMENTATION)}`

		expect(aggregation_split.problems(text)).toStrictEqual([])
	})

	it('ignores an aggregation criterion inside a code fence', () => {
		expect(aggregation_split.problems(body(6, `\`\`\`md\n${AGGREGATION}\n\`\`\``))).toStrictEqual(
			[],
		)
	})
})
